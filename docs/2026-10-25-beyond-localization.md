# Beyond campaign localization release

18 page versions: en, fr, de, es, es-MX, pt-BR, pt-PT, it, nl, sv, pl, uk, ru, id, ko, ja, zh-CN, ar. Armenian and Traditional Chinese are excluded by request.

Includes manually authored story and reward text, 374 localized graphics, original gameplay screenshots with localized footers, 49-cue trailer tracks and 7-cue discovery tracks, reservation terms/confirmation/error messages, tier labels, browser detection and a language selector. Prices, checkout URLs and original screenshot files are preserved.

Build inputs and review evidence are maintained in the WonderLang Project1 workspace at `work/beyondmockup/localization`. Run `build_graphics.py`, `render_graphics.cjs`, `build_subtitles.py`, then `build.py` there after reviewed copy changes. The generated public artifacts are versioned here. The Netlify Node build bundles tracking/admin scripts but does not overwrite the localized campaign files. Do not replace these pages with the old English-only mockup generator output.

Verification: 18 languages at 390/1440px; 22 regional language defaults; 31 simulated reservation cases; 54 localized checkout errors; 18 trailer and discovery tracks; original artwork and screenshot hashes preserved. Actual payment and Meta calls are intercepted in browser tests. See the separate browser-tracking implementation note for event/deduplication behavior.

Review limits: captions and sampled playback frames were checked; this release does not claim a new complete real-time audiovisual review or new dubbing.
