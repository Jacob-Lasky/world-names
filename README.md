# world-names

Interactive world map: click any country to see what it calls itself in its dominant language, and watch the rest of the world recolor by how their exonym for that country clusters etymologically.

**Live:** [pietech.net/world-names](https://pietech.net/world-names/) *(pending deploy)*

## What's interesting

The clustering is **etymological-root**, not string-distance. Germany decomposes into ~5 global root families: *Germani* (English Germany), *Alemanni* (French Allemagne), *Deutsch* (German Deutschland, Tyskland), Slavic *Niemcy* ("the mute ones"), Saxons (Finnish Saksa). Coloring by which root each country uses is the visualization that pops — and it generalizes to any country, not just Germany.

## Stack

- **Render**: deck.gl WebGL (`GeoJsonLayer` over Natural Earth 1:50m polygons). No basemap — the polygons are the map. Recolor on click is a GPU attribute update, not an SVG reflow.
- **App**: Vite + React 19 + TypeScript.
- **State**: Zustand.
- **Data**: precomputed SQLite (`public/world-names.sqlite`), queried in-browser via [`@sqlite.org/sqlite-wasm`](https://github.com/sqlite/sqlite-wasm). Zero network round-trips after initial load.
- **ETL**: Python (uv) — Wikidata SPARQL for endonyms/exonyms, hand-curated etymology clusters, one-shot LLM calls per country for the blurb, packed into the sqlite file.
- **Tests**: Vitest (units), Playwright (E2E).
- **Deploy**: Cloudflare Pages, served at `pietech.net/world-names/` via a Cloudflare Worker route in front of [`pietech-net`](https://github.com/Jacob-Lasky/pietech-net).

## Run

```sh
npm install
npm run dev               # http://localhost:5173/world-names/
npm run test              # vitest
npm run test:e2e:install  # one-time: pull Playwright browsers
npm run test:e2e          # playwright
npm run build             # → dist/
```

ETL:

```sh
cd etl
uv sync
uv run python build_sqlite.py    # writes ../public/world-names.sqlite
```

## Layout

```
src/
  components/    WorldMap, DetailPanel
  store/         Zustand slices (selection, …)
  lib/           pure functions — similarity, clusterColor, palettes
  data/          sqlite-wasm load + query layer (TODO)
tests/
  setup.ts       vitest setup (jest-dom matchers, RTL cleanup)
  e2e/           playwright specs
etl/             build-time Python pipeline → public/world-names.sqlite
public/          static assets shipped with the app
```

## Why `base: '/world-names/'`

This app is one of several path-routed projects on `pietech.net`. A Cloudflare Worker in front of the domain dispatches `/world-names/*` to this Pages project. The Vite `base` prefix makes asset URLs and React Router (if added) work correctly behind the path.
