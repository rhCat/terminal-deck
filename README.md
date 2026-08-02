# terminal-deck

**PowerPoint-style live terminal manager** built on persistent tmux.

Instead of 6–7 scattered terminal windows, you get a deck:
- **Left** — a *slide sorter*: live thumbnail previews of every work/terminal (peek at what's flowing).
- **Center** — the *main slide*: a full interactive terminal for the focused work.
- **Bottom** — *notes*: per-work speaker-style notes.
- **Zoom** — blow the focused work to full screen.
- **Grid** — expand the sorter into a full grid of live thumbnails.

Everything is backed by **tmux**, so *the work persists*: closing the browser, reloading, or even restarting the server doesn't kill the sessions — they live in the tmux server and you re-attach.

## Why tmux (and not herdr)

You originally asked about herdr as a "terminal manager"; it turned out to be an *AI-agent* multiplexer, not a multi-terminal UI. What you actually wanted was a multi-terminal interface with live previews. This project is that — and it uses **tmux** specifically because the goal is *multiple works that persist*.

## Architecture

```
Browser (xterm.js × N)  ── WebSocket ──>  Node server
                                            │  node-pty
                                            ▼
                                   tmux server (persistent, detached)
                                            │
                                   pane A (work 1)  pane B (work 2) ...
```
- **tmux control + node-pty**: each focused "main slide" opens a real interactive PTY attached to a persistent tmux session. Snapshots are cheap `tmux capture-pane` polls for the thumbnails.
- **Persistence**: sessions live in the tmux *server*, so the page is just a viewer/controller. Reconnect re-attaches; the running work is untouched.

## Project layout
```
server.js      Node backend: HTTP (express) + WebSocket (ws) + node-pty + tmux
index.js       entry point (boots HTTP + WS on PORT, default 8787)
public/
  index.html   the deck UI (toolbar / sorter / stage / notes)
  style.css    PowerPoint layout + zoom + grid view
  app.js       browser logic (xterm, WebSocket, cards, notes)
  xterm.js     vendored xterm.js
  xterm.css    vendored xterm theme
  addon-fit.js vendored FitAddon
```

## Run

Requires **Node.js ≥ 18** and **tmux** on `PATH` (any normal Linux/macOS has it).

```bash
npm install          # compiles node-pty (needs build tools: python3, make, g++)
node index.js        # -> http://localhost:8787
```

Open the URL, click **＋ New work** to add slides/sessions, click a card to focus it, use **⊞ Grid** / **⛶ Zoom** to change the view. Sessions persist in tmux between reloads.

### Rootless tmux (this VPS quirk)
On this box there was no `sudo`, so tmux was installed from `apt` packages into a local prefix. If the system tmux isn't on `PATH`, point the server at the local one:

```bash
export TMUX_BIN=/opt/work/audit/tmux-local/pkg/usr/bin/tmux
export TMUX_LIB_DIR=/opt/work/audit/tmux-local/pkg/usr/lib/x86_64-linux-gnu
export TMUX_SOCK_DIR=/opt/data/terminal-deck/tmux-sock   # where the persistent server lives
node index.js
```
On a normal Mac, `brew install tmux` and skip all of that.

## API
- `GET  /api/sessions` — list persistent sessions
- `POST /api/session` — create one (`{name}`)
- `POST /api/kill` — kill one (`{name}`)
- `WS   /ws` — `{t:'main'|'input'|'resize'|'snapshot'|'unfollow'}` frames; server replies `data` / `snap` / `bye`.

## Notes on the build
- **node-pty** compiles a native addon — that's why build tools (`python3`, `make`, `g++`) are required.
- xterm.js / FitAddon are vendored into `public/` from `node_modules/@xterm/...` so the app works without a CDN.
- Notes are persisted client-side in `localStorage` (per-session, per-browser). A future step could move them server-side and associate them with the tmux session.

## Status
Working MVP, verified live on this box:
- main terminal attach + streaming ✅
- live snapshot thumbnails ✅
- input → tmux pane round-trip ✅
- persistent sessions across reload ✅
