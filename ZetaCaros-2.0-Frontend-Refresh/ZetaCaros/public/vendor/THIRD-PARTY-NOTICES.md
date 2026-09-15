# Vendored browser code

`zxing.js` is the unmodified `umd/zxing-browser.min.js` distributed in the npm package `@zxing/browser@0.2.1`, downloaded with `npm pack`.

- ZXing browser authors: David Werth and Luiz Barni. MIT license: `ZXING-BROWSER-LICENSE`.
- The bundle incorporates ZXing JavaScript library code derived from ZXing. Apache 2.0 license: `ZXING-LIBRARY-LICENSE`.
- The upstream source and contribution notices are retained in the unmodified bundle.

Source: https://github.com/zxing-js/browser and https://github.com/zxing-js/library

No changes were made to the bundled library. ZetaCaros loads it from its own server without runtime CDN calls. The sample barcode generator in inventory.js is application code, independent of the decoder.
