# Contributing

Thank you for helping. Bug reports, fixes, docs, and support for new robots are all welcome.

## Before you start

- **Small fixes:** open a pull request directly.
- **Anything larger** (a new mode, a new robot, a change to a driver): open an issue first, so it can be shaped before you spend time on it.
- **Show what you built** in [Show and tell](https://github.com/charansoma3001/twinstage/discussions/categories/show-and-tell), even if it is not a contribution.

## Setting up

```bash
npm install
npm run sim          # everything, simulated
npm start            # the Vite dev server on :5173 plus the bridge on :8787
```

With `npm start`, edit anything under `web/` and the page reloads. The bridge does not reload; restart it after changing `server/` or `drivers/`.

## The checks

CI runs these on every pull request. Run them first:

```bash
npm run lint
npm test
npm run build
cd drivers && uv run --group dev ruff check . && uv run --group dev pytest -q
```

`npm test` includes an end-to-end run of the real bridge with every driver in dry run, so it needs `python3` on your path.

## Changing what moves motors

Anything under `drivers/`, `server/`, or `web/src/stage/keepout.js` decides how real hardware moves. For those:

- **Keep limits in the driver.** The driver is the one place that enforces them, and it trusts nothing it is sent.
- **Add a test that fails without your change.** The existing tests sweep whole ranges rather than checking one case; do the same.
- **Say in the pull request how you tested it on hardware**, or that you have not. We will run it on real arms before merging.

## How the code is laid out

[Architecture](docs/architecture.md) covers it. In short:

- `web/` holds the pages.
- `server/` holds the bridge.
- `drivers/` holds the Python drivers.

Kinematics and geometry are measured off the URDF, not tuned by hand, and the tests check them against it.

## Style

- **Match the code around you.** Comments say why, not what.
- **Put UI state in attributes.** Use `is-on`, `aria-pressed` or `data-tone`, never JavaScript rewriting class strings. The shared styles are in `web/src/ui/theme.css`.
- **Write interface text plainly:** sentence case, and say what a button does.
- **Write commit messages that say what changed and why,** in the imperative: "Hold the arm when the stream stops".

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
