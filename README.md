# TiCash Website — Embedded Logo Build

This build embeds the TiCash logo directly into the HTML as a PNG data URI.
The website no longer depends on Render/GitHub image paths for the visible logo.

## Upload to GitHub
Replace the current website files with ALL files from this ZIP at the repository root.

## Render
- Type: Static Site
- Branch: main
- Root Directory: blank
- Build Command: blank
- Publish Directory: ./

The included `ticash-logo.png` and `assets/ticash-logo.png` are retained as source assets,
but the HTML-rendered logos are embedded and will display even if those asset paths fail.
