# Reddit - Hide Dead Video Links

A Tampermonkey userscript by Camofl that hides Reddit posts linking to discontinued hosts or unavailable media. It also attempts to detect selected soft 404s.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. [Open the userscript](https://raw.githubusercontent.com/Camofl/reddit-hide-dead-video-links/main/reddit-hide-dead-video-links.user.js) and confirm installation or update in Tampermonkey.
3. Reload Reddit. If the install prompt does not appear, create a new script in Tampermonkey, paste the file contents, and save. When updating manually, replace the old script contents rather than running duplicate copies.

## Features

- Immediately hides submissions linking to Gfycat and Vidme.
- Checks supported media URLs on Streamable, RedGIFs, Imgur, Giphy, and Tenor for HTTP 404/410 responses.
- Detects Imgur redirects to removed-media placeholders and selected missing-media messages on Streamable and RedGIFs.
- Attempts to detect soft 404s when a supported media URL redirects to its hosting service's homepage and returns successful HTML instead of the requested media.
- Leaves posts visible after timeouts, HTTP access-denied responses, rate limits, or other inconclusive failures. Homepage redirects are filtered even when an access restriction, rather than deletion, may be responsible.
- Includes a bottom-right button to reveal filtered posts. Filter reasons are logged in the browser console.
- Designed for current Reddit and old Reddit, including dynamically loaded posts. Compatibility may change when Reddit changes its layout.
- Skips comments pages by default (`filterCommentsPages: false`).

## Soft 404 detection

Some unavailable media URLs return HTTP 200 with a generic homepage instead of HTTP 404. The script treats a supported media URL that ends at a configured homepage path on the same hosting service as unavailable, provided the response is successful HTML. For example, an `i.imgur.com` GIF/video URL ending at `https://imgur.com/` matches this rule. Subdomain changes within the configured service are allowed; redirects to unrelated domains are not classified by this rule.

This is a heuristic, not proof that the media was permanently deleted. Regional restrictions, anonymous-request behavior, or other access conditions may also cause redirects. The default intentionally favors filtering media that is inaccessible through the script's checks. Use the reveal button to inspect filtered posts, or set `hideMediaRedirectsToHomepage: false` to disable this rule.

## Configuration

Edit `SETTINGS` near the top of the script:

- `hideMediaRedirectsToHomepage`: enable or disable homepage soft-404 filtering; enabled by default.
- `homepagePathsByHost`: recognized homepage paths for each supported service; initially `/`.
- `filterCommentsPages`: enable filtering on individual discussions; disabled by default.
- Request concurrency, timeout, look-ahead distance, and cache duration can also be adjusted.

Adding a checked host also requires a corresponding `@connect` permission and URL matching logic. The homepage rule applies only to recognized media URL patterns, not every link. In particular, Imgur checks currently cover URLs ending in `.gif`, `.gifv`, `.mp4`, or `.webm`, not extensionless pages or albums.

## Privacy and limitations

Checks send anonymous requests directly to supported hosting providers, which can see your IP address. No third-party checking service is used. Results are cached in memory for the page session. This script hides posts locally; it does not delete posts or use Reddit's account-level Hide action.

Detection is best-effort. The script does not execute hosting-page JavaScript, detect every soft 404, or verify that returned media is playable. JavaScript-only redirects and error states may be missed. Only supported submission URLs are checked, not links inside comments or text posts. The script does not recover missing videos.

## License

[MIT](LICENSE) - Copyright (c) 2026 Camofl.
