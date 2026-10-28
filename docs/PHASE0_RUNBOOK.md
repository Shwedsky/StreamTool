# Phase 0 — Runbook

## Purpose

Phase 0 proves the StreamTool application shell and end-to-end local data path before any real streaming platform credentials are introduced.

## Owner / non-developer test path (Windows)

No Git, Node.js, npm, VS Code or terminal setup is required.

1. Open PR #2 on GitHub.
2. Open the latest successful **Windows Portable** workflow run.
3. Download the `StreamTool-Windows-x64` artifact.
4. Extract the ZIP to any normal folder.
5. Double-click `START_STREAMTOOL.cmd`.
6. Keep the console window open while testing; the default browser opens automatically.
7. Closing the console window stops the local StreamTool backend.

The portable artifact bundles its own Node.js runtime and all production dependencies. Nothing is installed system-wide.

Expected startup behavior:

1. StreamTool creates/opens its local SQLite database.
2. Demo Twitch and VK Video Live adapters produce normalized snapshots.
3. The polling coordinator stores the first snapshot.
4. Fastify binds to `127.0.0.1` with `port: 0`.
5. The operating system selects an available port.
6. StreamTool opens that actual URL in the default browser.

No fixed application port is required.

## Routes

- `/` — full dashboard
- `/dashboard` — full dashboard alias
- `/compact` — compact second-monitor / future OBS Dock view
- `/api/health` — runtime health information
- `/api/snapshot` — latest normalized aggregate snapshot
- `/api/events` — SSE stream

## Demo behavior

Both demo adapters report an active stream. Viewer counts change gradually so SSE updates and UI refreshes can be observed without external accounts.

The main dashboard shows:

- combined current viewers
- peak combined viewers since application start
- live platform count
- per-platform viewer counts
- followers/subscribers where applicable
- Twitch paid subscribers and chatters
- VK reactions and views
- category and stream duration

Phase 1 will add historical graph queries, average viewers, deltas over 1/5/15/30 minutes, event markers and post-stream reports.

## Persistence

Default database location on Windows:

`%LOCALAPPDATA%\StreamTool\streamtool.db`

SQLite runs in WAL mode with `synchronous=NORMAL` to keep writes lightweight.

## Developer path

Developers can run the source tree with Node.js 22+:

```bash
npm install
npm run typecheck
npm run build
npm start
```

For CI/headless use:

```bash
STREAMTOOL_NO_OPEN=1 npm start
```

## Verification checklist

- portable package starts on Windows without separately installed Git/Node/npm
- packaged app binds only to `127.0.0.1`
- port is selected automatically by the operating system
- dashboard loads from the same backend origin
- `/compact` loads successfully
- `/api/health` returns `status: ok`
- `/api/snapshot` returns both demo platforms and combined viewer count
- browser data updates through SSE without page reload
- SQLite file receives platform snapshots
- opening multiple browser tabs does not create extra platform polling loops

## CI and packaging

`.github/workflows/ci.yml` verifies the source build on Linux.

`.github/workflows/windows-portable.yml` verifies the exact Windows portable delivery path. It:

1. installs/builds dependencies on a Windows runner
2. runs TypeScript typecheck and production build
3. removes development-only dependencies
4. bundles the Node runtime, production dependencies and built application
5. smoke-tests the packaged application itself
6. verifies `/api/health`, `/api/snapshot`, `/` and `/compact`
7. uploads `StreamTool-Windows-x64` as a downloadable artifact

## Security boundary

Phase 0 contains no real platform credentials.

The architectural boundary is already enforced: browser code communicates only with the local StreamTool backend. Real Twitch/VK secrets and refresh tokens will be introduced later only on the backend side and will never be bundled into frontend JavaScript.
