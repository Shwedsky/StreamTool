# Phase 0 — Foundation implementation checkpoint

Status: in progress

Branch: `feature/phase0-foundation`

This branch implements the first runnable vertical slice of StreamTool.

## Required outcome

- local Fastify backend bound to `127.0.0.1`
- operating system selects an available port (`port: 0`)
- browser opens the actual bound URL
- React/Vite dashboard served by the backend after build
- normalized `PlatformAdapter` contract
- deterministic demo adapters for VK Video Live and Twitch
- centralized polling coordinator
- SSE stream from backend to every open dashboard tab
- SQLite persistence and initial migration
- `/api/health` and `/api/snapshot` endpoints
- dashboard and compact views
- no platform credentials in browser code

## Scope boundary

Real Twitch/VK authentication and API calls are Phase 2/3. Phase 0 must prove the application shell, data flow, storage, local delivery model, and UI using demo data first.
