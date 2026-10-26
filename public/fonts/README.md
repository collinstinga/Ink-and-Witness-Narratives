# Ink & Witness self-hosted fonts

The WOFF2 files are unmodified assets returned by the existing Google Fonts
CSS2 request on 2026-10-26, using a modern Chromium user agent. No fonts were
replaced, converted, subsetted further, or renamed internally. The filename's
12-digit suffix is the first 12 hexadecimal characters of its SHA-256 content
digest. Keep immutable URLs: change the filename if the bytes ever change.

Original request (preserved styles, weights and optical-size axes):

```
https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap
```

The CSS in `src/index.css` retains every supplied Unicode range. Variable
weight declarations replace duplicate declarations that referenced the same
binary. All four font families retain `font-display: swap` and their original
fallback stacks. In particular, Newsreader retains its optical sizing.

Only Cinzel Latin (25,904 bytes) and Plus Jakarta Sans Latin (27,348 bytes) are
preloaded for visible headings and UI. Newsreader, JetBrains Mono and other
language subsets load when actual text needs them. Do not preload all 18 files.
This removes the external stylesheet/DNS dependency without hiding text while
fonts load or leaving the entire visit in a fallback font.

Google Fonts asset versions: Cinzel v26, Newsreader v26, JetBrains Mono v24,
Plus Jakarta Sans v12. Their sources are `fonts.gstatic.com/s/{family}/{version}`.

All four families use the SIL Open Font License 1.1. See the accompanying
`OFL.txt`, which includes the four upstream copyright notices. Upstream copies:

- https://github.com/google/fonts/blob/main/ofl/cinzel/OFL.txt
- https://github.com/google/fonts/blob/main/ofl/jetbrainsmono/OFL.txt
- https://github.com/google/fonts/blob/main/ofl/newsreader/OFL.txt
- https://github.com/google/fonts/blob/main/ofl/plusjakartasans/OFL.txt

No production data, authentication, financial logic or payment settings are
involved in font delivery.
