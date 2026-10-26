# Website media optimization — October 26, 2026

419 referenced English/shared and translated image assets have compressed WebP exports, with 720px alternatives for large images and larger variants retained for high-density screens. The originals remain untouched. The English page's unique image assets fall from 15,375,067 to 2,961,826 bytes at the larger variant; this is not a claim that all assets load immediately. The village PNG changes from 1,388,278 to 264,982 bytes, and the combat poster from 1,924,713 to 174,988 bytes.

Translated images have no initial English `src`, preventing the browser preload scanner from fetching the wrong language first. A noscript fallback retains English images. Localization adds only the selected locale's source/srcset; switching language swaps those together. Failure restores default artwork. Each captioned video has only one selected-language subtitle track. Shared gameplay images are not translated. The trailer uses preload=none. Fingerprinted WebP files have one-year immutable caching.

All 18 languages were checked with actual browser request logs: exactly one locale JSON, zero foreign-locale artwork requests, zero original PNG/GIF requests, and 720px mobile selections. Images decode successfully and mobile layout has no horizontal overflow. Newsletter validation covers 18 languages with provider success/error simulations, and 13 destination/attribution scenarios verify the user-supplied form IDs.

Main-site gameplay GIFs are replaced by silent H.264 loops loaded/played near the viewport, paused offscreen, with posters and reduced-motion support. Combined size: 6,192,611 to 690,458 bytes. Public copies of older A/B designs receive the same form and media fixes without modifying archived source designs.

FFmpeg verification: sentences 14.50s, 400x226; vocabulary 17.00s, 480x270; H.264/yuv420p, no audio. Sentence source has a one-pixel bottom pad for codec compatibility. Source timing is preserved to container rounding (source 14.51s). Generic YouTube checks warn about small resolution, absent audio/subtitles; these are intentional for silent inline website loops. Contact sheets and browser renders were inspected.

Reusable pack: Project1/output/beyond-kickstarter-webp-20261026, with en plus 17 translated-language folders, original-game WebP previews, English/all-language ZIPs, and a manifest. Source/build/QA scripts and detailed reports remain in Project1/work/beyondmockup/localization. This is a reusable WebP export, not a claim that Kickstarter accepts every animated WebP upload.
