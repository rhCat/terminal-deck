# dev/ — developer verification artifacts

Headless UI verification for terminal-deck, run against the live server.

## Contents
- **`screenshots/`** — captured deck views from a real headless-Chromium run:
  - `01-deck-default.png` — default PowerPoint view (left sorter, center black main slide, bottom notes)
  - `02-grid-view.png` — grid / thumbnail view
  - `03-zoom-view.png` — zoomed main slide
  - `04-after-create.png` — after creating a new work/slide
- **`ui-test.mjs`** — the Playwright script that drives the deck and (re)generates these
  screenshots. It asserts the four-zone layout, live cards, focus-on-click, and new-work
  creation, saving PNGs into `dev/screenshots/`.

## How to re-run

```bash
# start the server (see README) — it must be on localhost:9000
node index.js &

# install playwright (isolated dir avoids polluting the app deps)
mkdir -p /opt/work/playwright-runner && cd /opt/work/playwright-runner
printf '{"name":"pw","private":true,"type":"module"}\n' > package.json
npm install playwright
PLAYWRIGHT_BROWSERS_PATH=/opt/hermes/.playwright \
  node /opt/data/terminal-deck/dev/ui-test.mjs
```

The script writes updated PNGs back into `dev/screenshots/`.

## Last run (verified)
- 2 live cards (`build`, `logs`) rendered from persistent tmux sessions ✅
- Click-to-focus + main xterm mount ✅
- New-work creation (3rd card) ✅
- Layout pixel-confirmed: dark toolbar/sorter/notes + black terminal stage ✅
- JS errors: none ✅
