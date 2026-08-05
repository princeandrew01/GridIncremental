# Grid Incremental

A prototype browser incremental game, inspired by
[Gridle](https://parsakaali.itch.io/gridle). Currently **Alpha 0.1** — very
much a work in progress, built to explore whether a grid-adjacency take on
the genre is fun before investing further.

Place generators on a fixed grid; adjacency between them determines output.
Three generator types so far:

- **Basic** — produces currency. Leveling raises its own output, but the
  base value other generators read from it only grows linearly (keeps
  neighboring Leeches from scaling out of control off a single upgrade).
- **Leech** — steals from nearby non-Leech generators. Leveling widens its
  range: orthogonal neighbors → a full ring around it → the whole board.
- **Buff** — boosts exactly one neighboring Basic, chosen by facing and
  rotatable in place; produces no currency itself.

Progression, save/load (with offline progress calculated in closed form -
no simulating away-time tick by tick), stats, and a small achievement set
are all in. Prestige, Gems, and Upgrades tabs exist in the UI but are
intentionally placeholders for now.

## Playing it

Live version: not deployed yet - see [`PUBLISHING.md`](./PUBLISHING.md) for
the steps to put this on GitHub Pages.

## Running it locally

```sh
npm install
npm run dev
```

Other scripts: `npm run build` (production build to `dist/`), `npm test`
(the Vitest suite - `src/game/` is pure and fully covered independent of any
UI), `npm run preview` (serve the production build locally).

## Tech

TypeScript + Vite, vanilla DOM (no framework - the board is small enough
not to need one), [`break_infinity.js`](https://github.com/Patashu/break_infinity.js)
for numbers past `Number.MAX_VALUE`, Vitest.

## Credit

Inspired by and built as a personal take on
[**Gridle**](https://parsakaali.itch.io/gridle) by parsakaali - go play the
original.

Made by Asingh.
