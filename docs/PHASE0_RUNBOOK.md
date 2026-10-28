# Phase 0 — Runbook

## Purpose

Phase 0 proves the StreamTool application shell and end-to-end local data path before any real streaming platform credentials are introduced.

## Prerequisites

- Node.js 22+
- npm

## Build and start

```bash
npm install
npm run typecheck
npm run build
npm start
```

Expected startup behavior:

1. StreamTool creates/opens its local SQLite database.
2. Demo Twitch and VK Video Live adapters produce normalized snapshots.
3. The polling coordinator stores the first snapshot.
4. Fastify binds to `127.0.0.1` with `port: 0`.
5. The operating system selects an available port.
6. StreamTool logs the actual URL and opens it in the default browser.

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

Default database location:

- Windows: `%LOCALAPPDATA%/StreamTool/streamtool.db`
- Linux/macOS fallback: user data directory under `.local/share/StreamTool/streamtool.db`

For tests or development, the location can be overridden:

```bash
STREAMTOOL_DB_PATH=/custom/path/streamtool.db npm start
```

SQLite runs in WAL mode with `synchronous=NORMAL` to keep writes lightweight.

## Headless mode

To prevent automatic browser launch:

```bash
STREAMTOOL_NO_OPEN=1 npm start
```

This is what CI uses.

## Verification checklist

- application binds only to `127.0.0.1`
- port differs safely when the preferred/common ports are occupied because no fixed port is requested
- dashboard loads from the same backend origin
- `/compact` loads successfully
- `/api/health` returns `status: ok`
- `/api/snapshot` returns both demo platforms and combined viewer count
- browser data updates through SSE without page reload
- SQLite file receives platform snapshots
- opening multiple browser tabs does not create extra platform polling loops

## CI

`.github/workflows/ci.yml` runs on pull requests and main pushes with Node.js 22.

It verifies:

1. dependency installation
2. TypeScript typecheck
3. production build
4. actual runtime startup on an OS-assigned localhost port
5. HTTP responses from `/api/health`, `/api/snapshot`, `/` and `/compact`

## Security boundary

Phase 0 contains no real platform credentials.

The architectural boundary is already enforced: browser code communicates only with the local StreamTool backend. Real Twitch/VK secrets and refresh tokens will be introduced later only on the backend side and will never be bundled into frontend JavaScript.
