# StreamTool

Local-first multistream dashboard for streamers.

StreamTool aggregates live metrics from multiple streaming platforms into one lightweight localhost dashboard with history, trends and post-stream analytics.

Initial target platforms:

- Twitch
- VK Video Live

The product runs locally on the streamer's PC, binds automatically to a free localhost port, keeps platform credentials on the backend, refreshes live metrics on a lightweight cadence, stores session history in SQLite, and exposes both a full dashboard and compact view.

## Current status

**Phase 0 — Foundation is implemented in PR #2 and awaiting owner review.**

The current runnable slice already includes:

- Fastify backend bound only to `127.0.0.1`
- OS-assigned free port (`port: 0`)
- automatic browser opening
- React/Vite dashboard
- `/compact` mode
- normalized `PlatformAdapter` contract
- demo Twitch and VK Video Live adapters
- centralized 15s live / 60s offline polling model
- SSE updates to browser tabs
- SQLite persistence with WAL + initial migration
- `/api/health` and `/api/snapshot`
- GitHub Actions typecheck, production build and runtime smoke test

Real Twitch/VK OAuth and API calls intentionally remain out of Phase 0.

## Run Phase 0

Requirements: Node.js 22+.

```bash
npm install
npm run build
npm start
```

StreamTool asks the operating system for a free localhost port and opens the resulting URL automatically. There is no fixed port to configure.

Compact mode is available at `/compact` on the same generated localhost address.

For CI/headless use:

```bash
STREAMTOOL_NO_OPEN=1 npm start
```

See [Phase 0 Runbook](docs/PHASE0_RUNBOOK.md) for expected behavior and verification steps.

## Project documents

- [Product Concept](docs/PRODUCT_CONCEPT.md) — product scope, UX, metrics, security and extensibility principles.
- [Development Brief](docs/DEVELOPMENT_BRIEF.md) — implementation handoff with architecture, data model, API boundaries, phases, testing and definition of done.
- [Phase 0 Runbook](docs/PHASE0_RUNBOOK.md) — how to run and verify the foundation slice.

## Repository

https://github.com/Shwedsky/StreamTool

## Delivery sequence

1. Foundation: local backend, dynamic port, React UI, SQLite, SSE and demo adapters.
2. Core analytics on simulated data: history queries, graphs, averages, delta windows and reports.
3. Twitch integration.
4. VK Video Live integration.
5. Hardening and easy Windows launch/distribution.

Implementation work is done in dedicated branches with Draft PRs and owner review before merge.
