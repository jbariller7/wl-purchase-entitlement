# WonderLang Beyond: selected Steam player reviews (30 October 2026)

The Adventure section now introduces reviews of the original WonderLang after its opening paragraph. Selected shortlist numbers: 1, 2, 3, 4, 5, 7, 12 and 15.

The web carousel displays the original Steam screenshots at full width, without a duplicate quote or introductory text inside the slide. The introduction is ordinary page text above it. Slides remain visible for 30–75 seconds, with longer holds for longer reviews. It provides previous/next/dot navigation, a pause/play control, keyboard navigation, reduced-motion support, and pauses while offscreen or the page is hidden. Clicking a screenshot opens its complete image. Only the current/next screenshots are loaded as needed. Existing introduction and controls remain in all 18 enabled page languages; reviews and screenshot pixels are not translated.

Review 12 was recaptured directly from its original Steam page, including its author and complete text, without the bad left crop or moderator sidebar. Its source capture is 610 × 435.

Local source: Project1/work/beyondmockup/player-reviews.js, player-reviews.css, player-reviews-locales.json, integrate-player-reviews.py and build-player-reviews.py. The localized frozen templates and catalogs include the section. Run the integration script then localization/build.py when rebuilding. The integration retains the independently published countdown markup and all its existing localized fields.

Public outputs: eight compressed screenshot WebPs under assets/player-reviews/, content-hashed carousel JavaScript/CSS, updated index and language catalogs. There are no backend, checkout, newsletter routing or tracking changes.

Kickstarter draft, revision 2: the introduction remains page text, followed by an 800 × 923 screenshot-only animated WebP slideshow, eight frames, a 400-second loop and 810 KB upload. Kickstarter's delivered response is a 1.96 MB animated GIF. Its eight frame delays were verified as 30, 75, 45, 45, 60, 60, 45 and 40 seconds. Eight source links remain in its caption. Campaign launch was not activated.

QA: all eight exact excerpts and selected order checked through the browser; review 12's natural dimensions verified; 18 localized headings and next-control labels checked; existing public Story text, images, videos, links and countdown preserved; Kickstarter editor's existing 42 images and four video embeds preserved. Original captures, slideshow exports and evidence remain in Project1/output/wonderlang-player-reviews-20261030/.

