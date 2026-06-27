# GI Event Map Widget

Static widget for GI events. No build step, no npm dependencies.

## Files

- `index.html`: self-contained widget, inline Germany SVG, no external JS.
- `scrape.js`: Node.js scraper, writes `events.json`.
- `.github/workflows/update-events.yml`: daily GitHub Actions update.

## Run

```bash
node scrape.js
```

Then serve the directory statically, for example:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/index.html`.
