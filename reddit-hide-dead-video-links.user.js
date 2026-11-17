// ==UserScript==
// @name         Reddit - Hide Dead Video Links
// @namespace    Camofl.RedditHideDeadVideoLinks
// @version      1.0.3
// @description  Hide Reddit posts linking to discontinued video hosts or confirmed missing media, with a toggle to reveal filtered posts.
// @author       Camofl
// @license      MIT
// @match        https://www.reddit.com/*
// @match        https://old.reddit.com/*
// @match        https://sh.reddit.com/*
// @match        https://new.reddit.com/*
// @match        https://reddit.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      streamable.com
// @connect      redgifs.com
// @connect      imgur.com
// @connect      giphy.com
// @connect      tenor.com
// ==/UserScript==

(() => {
    "use strict";

    const SETTINGS = {
        discontinuedHosts: ["gfycat.com", "vid.me"],
        checkedHosts: ["streamable.com", "redgifs.com", "imgur.com", "giphy.com", "tenor.com"],
        maximumConcurrentRequests: 2,
        requestTimeoutMilliseconds: 12_000,
        checkAheadDistance: "900px",
        cacheDurationMilliseconds: 30 * 60 * 1000,
        filterCommentsPages: false,
    };

    const POST_SELECTOR = 'shreddit-post, .thing.link, [data-testid="post-container"]';
    const HIDDEN_ATTRIBUTE = "data-camofl-dead-video-hidden";
    const LOG_PREFIX = "[Reddit Dead Video Filter]";
    const cachedResults = new Map();
    const pendingRequests = new Map();
    const observedPosts = new WeakSet();
    const previousPostURLs = new WeakMap();
    const filteredPosts = new Map();
    const requestQueue = [];
    let activeRequestCount = 0;
    let filteredPostsVisible = false;
    let scheduledScan;
    let previousPageURL = location.href;

    const stylesheet = document.createElement("style");
    stylesheet.textContent = `
        [${HIDDEN_ATTRIBUTE}="true"] { display: none !important; }
        #camofl-dead-video-toggle {
            position: fixed; bottom: 14px; right: 14px;
            z-index: 2147483647; padding: 8px 12px;
            border: 1px solid #777; border-radius: 7px;
            background: #202020; color: #fff;
            font: 12px/1.4 system-ui, sans-serif; cursor: pointer;
        }
        #camofl-dead-video-toggle:focus-visible {
            outline: 2px solid #ff8b60; outline-offset: 3px;
        }
    `;
    document.documentElement.append(stylesheet);

    const visibilityButton = document.createElement("button");
    visibilityButton.id = "camofl-dead-video-toggle";
    visibilityButton.type = "button";
    visibilityButton.title = "Temporarily show or hide filtered Reddit posts";
    visibilityButton.addEventListener("click", toggleFilteredPostVisibility);
    document.documentElement.append(visibilityButton);

    function hostnameMatches(hostname, domain) {
        return hostname === domain || hostname.endsWith(`.${domain}`);
    }

    function hostnameMatchesAny(hostname, domains) {
        return domains.some(domain => hostnameMatches(hostname, domain));
    }

    function parseWebURL(value) {
        if (!value) return null;
        try {
            const url = new URL(value, location.href);
            return ["http:", "https:"].includes(url.protocol) ? url : null;
        } catch {
            return null;
        }
    }

    function filteringIsPaused() {
        return !SETTINGS.filterCommentsPages && /\/comments\//i.test(location.pathname);
    }

    function getSupportedPostURL(post) {
        const candidateURLs = [
            post.getAttribute("content-href"),
            post.getAttribute("data-url"),
            post.querySelector("a.title")?.getAttribute("href"),
            post.querySelector('a[data-testid="outbound-link"]')?.getAttribute("href"),
            post.querySelector('a[slot="outbound-link"]')?.getAttribute("href"),
        ];
        for (const candidate of candidateURLs) {
            const url = parseWebURL(candidate);
            if (!url) continue;
            if (hostnameMatchesAny(url.hostname, SETTINGS.discontinuedHosts) ||
                hostnameMatchesAny(url.hostname, SETTINGS.checkedHosts)) {
                url.hash = "";
                return url;
            }
        }
        return null;
    }

    function isSupportedMediaURL(url) {
        const { hostname, pathname } = url;
        if (hostnameMatchesAny(hostname, SETTINGS.discontinuedHosts)) return pathname !== "/";
        if (hostnameMatches(hostname, "streamable.com")) {
            return /^\/(?:e\/)?[a-z0-9]+\/?$/i.test(pathname) &&
                !/^\/(?:login|signup|pricing|explore|about)\/?$/i.test(pathname);
        }
        if (hostnameMatches(hostname, "redgifs.com")) return /^\/(?:watch|ifr)\/[a-z0-9-]+\/?$/i.test(pathname);
        if (hostnameMatches(hostname, "imgur.com")) return /\.(?:gif|gifv|mp4|webm)$/i.test(pathname);
        if (hostnameMatches(hostname, "giphy.com")) return /^\/(?:gifs|clips|embed|media)\//i.test(pathname);
        if (hostnameMatches(hostname, "tenor.com")) return /^\/view\//i.test(pathname);
        return false;
    }

    function updateVisibilityButton() {
        for (const post of filteredPosts.keys()) {
            if (!post.isConnected) filteredPosts.delete(post);
        }
        const action = filteredPostsVisible ? "Hide" : "Show";
        const label = `${action} filtered posts (${filteredPosts.size})`;
        if (visibilityButton.textContent !== label) visibilityButton.textContent = label;
        visibilityButton.setAttribute("aria-pressed", String(filteredPostsVisible));
    }

    function toggleFilteredPostVisibility() {
        filteredPostsVisible = !filteredPostsVisible;
        for (const post of filteredPosts.keys()) {
            if (filteredPostsVisible || filteringIsPaused()) post.removeAttribute(HIDDEN_ATTRIBUTE);
            else post.setAttribute(HIDDEN_ATTRIBUTE, "true");
        }
        updateVisibilityButton();
    }

    function filterPost(post, url, reason) {
        filteredPosts.set(post, { url, reason });
        if (!filteredPostsVisible) post.setAttribute(HIDDEN_ATTRIBUTE, "true");
        console.info(LOG_PREFIX, reason, url, post);
        updateVisibilityButton();
    }

    function getResponseContentType(response) {
        return response?.responseHeaders?.match(
            /^content-type:\s*([^\r\n]+)/im
        )?.[1]?.trim() || "";
    }

    function isSuccessfulVideoResponse(response) {
        return response?.status >= 200 && response.status < 300 &&
            /^video\//i.test(getResponseContentType(response));
    }

    function requestMediaPage(url) {
        return new Promise(resolve => {
            let requestHandle;
            let requestFinished = false;
            function finishRequest(response, abortDownload = false) {
                if (requestFinished) return;
                requestFinished = true;
                resolve(response);
                if (abortDownload) requestHandle?.abort();
            }
            requestHandle = GM_xmlhttpRequest({
                method: "GET",
                url,
                anonymous: true,
                timeout: SETTINGS.requestTimeoutMilliseconds,
                onreadystatechange(response) {
                    if (response.readyState !== 2) return;
                    if (/^(?:video|image|audio)\//i.test(getResponseContentType(response))) {
                        finishRequest({
                            status: response.status,
                            responseText: "",
                            responseHeaders: response.responseHeaders,
                            finalUrl: response.finalUrl,
                        }, true);
                    }
                },
                onload: response => finishRequest(response),
                onerror: () => finishRequest(null),
                ontimeout: () => finishRequest(null),
                onabort: () => finishRequest(null),
            });
        });
    }

    function getMissingMediaReason(response, url) {
        if (!response) return null;
        const finalURL = parseWebURL(response.finalUrl);
        if (hostnameMatches(url.hostname, "imgur.com") &&
            finalURL && hostnameMatches(finalURL.hostname, "imgur.com") &&
            /^\/removed\.(?:png|gif|jpe?g)\/?$/i.test(finalURL.pathname)) {
            return "Imgur redirected to its removed-media placeholder";
        }
        if ([404, 410].includes(response.status)) return `HTTP ${response.status}`;
        if (response.status !== 200) return null;
        const responseHTML = response.responseText || "";
        if (!responseHTML || responseHTML.length > 2_000_000) return null;
        const page = new DOMParser().parseFromString(responseHTML, "text/html");
        const prominentText = [
            page.title,
            ...Array.from(page.querySelectorAll("h1, h2"), heading => heading.textContent),
        ].join(" ").replace(/\s+/g, " ").trim();
        if (hostnameMatches(url.hostname, "imgur.com") &&
            /\b(?:the requested page could not be found|the image you are requesting does not exist or is no longer available)\b/i.test(prominentText)) {
            return "Imgur reports missing media";
        }
        if (hostnameMatches(url.hostname, "streamable.com") &&
            /\b(?:this video (?:has been (?:removed|deleted)|is no longer available)|video (?:not found|has been removed|has been deleted))\b/i.test(prominentText)) {
            return "Streamable reports missing video";
        }
        if (hostnameMatches(url.hostname, "redgifs.com") &&
            /\b(?:gif not found|video not found|this (?:gif|video) has been (?:deleted|removed))\b/i.test(prominentText)) {
            return "RedGIFs reports missing media";
        }
        return null;
    }

    async function checkPostMedia(url) {
        const imgurGifv = hostnameMatches(url.hostname, "imgur.com") &&
            /^\/[a-z0-9]+\.gifv$/i.test(url.pathname);
        if (!imgurGifv) {
            const response = await requestMediaPage(url.href);
            return getMissingMediaReason(response, url);
        }
        const directVideoURL = new URL(url.href);
        directVideoURL.hostname = "i.imgur.com";
        directVideoURL.pathname = directVideoURL.pathname.replace(/\.gifv$/i, ".mp4");
        const directResponse = await requestMediaPage(directVideoURL.href);
        if (isSuccessfulVideoResponse(directResponse)) return null;
        const directReason = getMissingMediaReason(directResponse, directVideoURL);
        const originalResponse = await requestMediaPage(url.href);
        if (isSuccessfulVideoResponse(originalResponse)) return null;
        const originalReason = getMissingMediaReason(originalResponse, url);
        const reason = originalReason || directReason;
        console.debug(LOG_PREFIX, "Imgur availability check", {
            originalURL: url.href,
            directURL: directVideoURL.href,
            directStatus: directResponse?.status,
            directFinalURL: directResponse?.finalUrl,
            directContentType: getResponseContentType(directResponse),
            originalStatus: originalResponse?.status,
            originalFinalURL: originalResponse?.finalUrl,
            reason,
        });
        return reason;
    }

    async function checkMediaAvailability(url) {
        const cacheKey = url.href;
        const cachedResult = cachedResults.get(cacheKey);
        if (cachedResult && Date.now() - cachedResult.checkedAt < SETTINGS.cacheDurationMilliseconds) {
            return cachedResult.reason;
        }
        if (pendingRequests.has(cacheKey)) return pendingRequests.get(cacheKey);
        const request = (async () => {
            const reason = await checkPostMedia(url);
            cachedResults.set(cacheKey, { checkedAt: Date.now(), reason });
            return reason;
        })();
        pendingRequests.set(cacheKey, request);
        try {
            return await request;
        } finally {
            pendingRequests.delete(cacheKey);
        }
    }

    function processRequestQueue() {
        while (activeRequestCount < SETTINGS.maximumConcurrentRequests && requestQueue.length > 0) {
            const { post, url } = requestQueue.shift();
            if (!post.isConnected || filteringIsPaused() || getSupportedPostURL(post)?.href !== url.href) continue;
            activeRequestCount++;
            checkMediaAvailability(url)
                .then(reason => {
                    if (!reason || !post.isConnected || filteringIsPaused() ||
                        getSupportedPostURL(post)?.href !== url.href) return;
                    filterPost(post, url.href, reason);
                })
                .catch(error => console.debug(LOG_PREFIX, error))
                .finally(() => {
                    activeRequestCount--;
                    processRequestQueue();
                });
        }
    }

    const viewportObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const post = entry.target;
            viewportObserver.unobserve(post);
            if (filteringIsPaused()) {
                observedPosts.delete(post);
                continue;
            }
            const url = getSupportedPostURL(post);
            if (!url || !isSupportedMediaURL(url)) continue;
            requestQueue.push({ post, url });
        }
        processRequestQueue();
    }, { rootMargin: SETTINGS.checkAheadDistance });

    function inspectPost(post) {
        const url = getSupportedPostURL(post);
        const currentURL = url?.href || "";
        if (previousPostURLs.get(post) !== currentURL) {
            viewportObserver.unobserve(post);
            observedPosts.delete(post);
            filteredPosts.delete(post);
            post.removeAttribute(HIDDEN_ATTRIBUTE);
            previousPostURLs.set(post, currentURL);
        }
        if (!url || !isSupportedMediaURL(url) || observedPosts.has(post)) return;
        observedPosts.add(post);
        if (hostnameMatchesAny(url.hostname, SETTINGS.discontinuedHosts)) {
            filterPost(post, url.href, "Discontinued hosting service");
            return;
        }
        viewportObserver.observe(post);
    }

    function scanPosts() {
        if (filteringIsPaused()) {
            requestQueue.length = 0;
            for (const post of document.querySelectorAll(POST_SELECTOR)) {
                viewportObserver.unobserve(post);
                observedPosts.delete(post);
                post.removeAttribute(HIDDEN_ATTRIBUTE);
            }
            filteredPosts.clear();
            updateVisibilityButton();
            return;
        }
        document.querySelectorAll(POST_SELECTOR).forEach(inspectPost);
        updateVisibilityButton();
    }

    function schedulePostScan() {
        clearTimeout(scheduledScan);
        scheduledScan = setTimeout(scanPosts, 200);
    }

    const pageObserver = new MutationObserver(schedulePostScan);
    pageObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["content-href", "data-url", "href"],
    });
    GM_registerMenuCommand("Show/hide filtered posts", toggleFilteredPostVisibility);
    setInterval(() => {
        if (location.href === previousPageURL) return;
        previousPageURL = location.href;
        schedulePostScan();
    }, 1000);
    scanPosts();
})();
