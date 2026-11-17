# Reddit - Hide Dead Video Links

A Tampermonkey userscript by Camofl that hides Reddit posts linking to discontinued video hosts or confirmed missing media.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. [Open the userscript](https://raw.githubusercontent.com/Camofl/reddit-hide-dead-video-links/main/reddit-hide-dead-video-links.user.js) and confirm installation in Tampermonkey.
3. Reload Reddit. If the install prompt does not appear, create a new script in Tampermonkey, paste the file contents, and save.

## Features

- Immediately hides submissions linking to Gfycat and Vidme.
- Checks supported media URLs on Streamable, RedGIFs, Imgur, Giphy, and Tenor for HTTP 404/410 responses.
- Recognizes selected missing-media messages on Streamable and RedGIFs.
- Leaves posts visible after timeouts, access-denied responses, rate limits, or other inconclusive failures.
- Includes a bottom-right button to reveal filtered posts.
- Designed for current Reddit and old Reddit, including dynamically loaded posts. Compatibility may change when Reddit changes its layout.
- Skips comments pages by default.

## Configuration

Edit the `SETTINGS` object near the top of the script to change host lists, request concurrency, cache duration, or comments-page filtering. Adding a checked host also requires a corresponding `@connect` permission and URL matching logic.

## Privacy and limitations

Checks send anonymous requests directly to supported hosting providers, which can see your IP address. No third-party checking service is used. Results are cached in memory for the page session. This script hides posts locally; it does not delete posts or use Reddit's account-level Hide action.

Not all deleted media can be detected, especially when a website returns a normal HTML page and loads its error state through JavaScript. Only supported submission URLs are checked, not links inside comments or text posts. The script does not recover missing videos.

## License

[MIT](LICENSE) - Copyright (c) 2026 Camofl.
