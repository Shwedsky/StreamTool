# StreamTool — Development Brief V1

Repository: https://github.com/Shwedsky/StreamTool

## Mission

Build a lightweight local-first multistream analytics dashboard for Twitch and VK Video Live.

The application must run on the streamer's PC, bind automatically to a free localhost port, open a browser dashboard, poll live platform metrics on a low-frequency cadence, persist normalized session snapshots in SQLite, and generate useful live and post-stream analytics without exposing platform secrets to the browser.

This document is the implementation handoff for the first production-capable milestone.

---

## 1. Required product behavior

### Startup

1. Start the local backend.
2. Bind HTTP only to loopback.
3. Ask the OS for an available port instead of hard-coding one.
4. Start serving the frontend on that port.
5. Open the user's default browser automatically.
6. If browser auto-open fails, print/log the local URL safely.

Example runtime URL:

`http://127.0.0.1:48731`

The exact port must not require user configuration.

### First-run platform setup

Provide a settings/connect page with at least:

- Twitch — Connect / Connected / Reconnect / Disconnect
- VK Video Live — Connect / Connected / Reconnect / Disconnect

The frontend must not receive platform client secrets or refresh tokens.

### Live refresh

Default cadence:

- 15 seconds while at least one connected platform is live
- 60 seconds while all connected platforms are offline

Polling must be centralized in the backend. Do not create one polling loop per browser tab.

### Live UI

Expose at least two routes/views:

- `/` or `/dashboard` — full dashboard
- `/compact` — small OBS/second-monitor-friendly dashboard

The main dashboard must show:

- total concurrent viewers across connected live platforms
- per-platform current viewers
- change over 1 / 5 / 15 / 30 minutes where enough history exists
- total peak for current session
- total average for current session
- current duration
- platform audience share
- current platform status
- last successful data refresh
- time-series graph for total + connected platforms

Platform cards must display supported metrics only. Do not render fake zeroes for unsupported values.

### Reports

When a stream session ends, persist enough data to reconstruct a report with:

- start/end timestamps
- duration
- total peak
- total average
- ending viewers
- per-platform peak/average
- per-platform follower/subscriber deltas when available
- time of peak
- strongest growth interval
- strongest decline interval
- time-series graph

---

## 2. Architecture

Use a local monorepo or clearly separated packages.

Suggested shape:

```text
StreamTool/
  apps/
    server/
    web/
  packages/
    domain/
    platform-core/
  docs/
  data/                 # runtime only; gitignored
```

Alternative directory layouts are acceptable if boundaries stay clear.

### Logical layers

```text
Twitch API ─────┐
                ├── Platform Adapters ── Normalized Domain ── Aggregator
VK Live API ────┘                                           │
                                                            ├── SQLite
                                                            ├── Analytics
                                                            └── SSE -> Browser
```

Required separation:

1. Platform-specific integration layer
2. Normalized domain model
3. Session/analytics layer
4. Persistence layer
5. HTTP/SSE transport
6. Frontend presentation

The UI must not know Twitch/VK response schemas directly.

---

## 3. Technology baseline

Preferred baseline:

- Node.js current LTS
- TypeScript
- Fastify
- React
- Vite
- SQLite
- SSE for live browser updates

Use a mature SQLite library suitable for a local desktop workload. Keep the persistence API behind a repository/service abstraction so the library can be replaced later.

Do not use Electron for V1.

Do not add Redis, PostgreSQL, Docker, message brokers, or cloud infrastructure to the runtime path.

---

## 4. Domain model

Define a platform-independent snapshot model.

Minimum shape:

```ts
type PlatformId = 'twitch' | 'vk-live';

interface PlatformSnapshot {
  platform: PlatformId;
  connected: boolean;
  live: boolean;
  viewers: number | null;
  followers: number | null;
  paidSubscribers: number | null;
  chatters: number | null;
  streamViews: number | null;
  reactions: number | null;
  title: string | null;
  category: string | null;
  startedAt: string | null;
  fetchedAt: string;
}
```

Use `null` for unavailable/not-supported metrics, not `0`.

### Aggregated snapshot

Create a backend-owned aggregate shape with at least:

```ts
interface AggregateSnapshot {
  timestamp: string;
  totalViewers: number;
  livePlatforms: number;
  platforms: PlatformSnapshot[];
}
```

Derived metrics should not be pushed down into platform adapters unless they are truly platform-native.

---

## 5. Platform adapter contract

Each platform must be isolated behind an adapter.

Minimum conceptual contract:

```ts
interface PlatformAdapter {
  readonly id: PlatformId;

  getConnectionState(): Promise<PlatformConnectionState>;
  getSnapshot(): Promise<PlatformSnapshot>;

  beginOAuth?(): Promise<OAuthStartResult>;
  completeOAuth?(input: OAuthCallbackInput): Promise<void>;
  disconnect(): Promise<void>;

  startEvents?(sink: PlatformEventSink): Promise<void>;
  stopEvents?(): Promise<void>;
}
```

Adapters must own:

- API base URLs
- platform request/response DTOs
- OAuth token refresh logic
- rate-limit handling
- platform-specific errors
- platform-specific event subscriptions

Adapters must not own:

- total viewer aggregation
- cross-platform trend calculations
- session report calculations
- UI state

---

## 6. Twitch integration requirements

Use official Twitch APIs.

Initial required capabilities:

- authenticate the broadcaster with the minimum scopes required
- determine current live/offline state
- obtain current viewer count
- obtain channel follower count when permitted
- obtain paid subscriber information only when the broadcaster authorization and Twitch scope/API support allow it
- obtain chatters only when permitted and useful
- obtain title/category/start time

Use Twitch EventSub later/where useful for discrete events such as follow/subscription/raid. Viewer count may be polled on the common 15-second cadence.

Never assume that follower and paid subscriber metrics mean the same thing.

Treat unavailable/unauthorized metrics as `null` with a typed reason internally rather than failing the whole platform snapshot.

---

## 7. VK Video Live integration requirements

Use the official VK Video Live developer API and OAuth flow where applicable.

Initial required capabilities:

- authenticate/connect the broadcaster
- determine current live/offline state
- obtain current viewers
- obtain channel subscriber/follower counter according to the platform's actual API semantics
- obtain stream views when available
- obtain reactions when available
- obtain title/category/start time where available

If VK's realtime/PubSub mechanisms provide useful discrete events, isolate them behind the adapter's optional event interface. Do not make initial dashboard correctness depend on a WebSocket connection if the REST snapshot API is sufficient.

---

## 8. Polling coordinator

Implement one backend polling coordinator.

Responsibilities:

- know which adapters are connected
- poll all connected adapters concurrently with bounded timeouts
- merge successful responses
- retain the last known valid value per metric with staleness metadata only if product behavior requires it
- never silently present stale data as current
- switch cadence between active-live and all-offline modes
- send aggregate updates to SSE clients
- write metric snapshots to SQLite only at the intended sampling cadence

One platform failing must not erase or block metrics from another platform.

A failed platform card should show a degraded/error state while healthy platforms continue updating.

---

## 9. Session lifecycle

Define deterministic rules for `StreamSession` creation and completion.

Suggested V1 behavior:

- create/open a session when any connected platform transitions to live
- keep the same session while at least one platform remains live
- close the session when all connected platforms have remained offline for a small grace window to avoid accidental session splitting during transient API failures/reconnects

Use a configurable internal grace period. A value around 2 minutes is a reasonable starting point, but make it a named constant/config value, not magic logic.

Record platform join/leave timestamps inside the session if platforms start or end at different times.

---

## 10. Persistence

Use SQLite.

Minimum logical entities:

### platform_connection

- platform
- connected state
- public account/channel identifiers
- display name
- timestamps
- non-secret metadata

Do not store raw client secrets in normal database tables unless encrypted by an explicit secret-storage layer.

### stream_session

- id
- started_at
- ended_at
- status
- created_at

### session_platform

- session_id
- platform
- platform_stream_id if available
- joined_at
- left_at
- start followers/subscribers counters where available
- end followers/subscribers counters where available

### metric_snapshot

- id
- session_id
- captured_at
- platform
- viewers
- followers
- paid_subscribers
- chatters
- stream_views
- reactions

### stream_event

- id
- session_id
- platform nullable for calculated global events
- type
- occurred_at
- payload_json / structured fields

Use schema migrations from the beginning.

---

## 11. Analytics calculations

All analytics should be deterministic from stored snapshots wherever possible.

Required V1 calculations:

### Current change

For 1 / 5 / 15 / 30 minute windows:

- find the nearest valid snapshot at or before the window boundary
- calculate absolute viewer delta
- optionally expose percentage delta if the baseline is non-zero

Do not imply precision finer than the 15-second sampling cadence.

### Peak

Maximum summed viewer count over aggregate snapshots in the session.

### Average

Use time-weighted average if snapshot intervals vary materially due to failed requests or pauses. Do not blindly average rows if gaps can distort the result.

### Platform share

`platform viewers / total viewers` at the selected time.

### Best growth / decline interval

For a defined default window (initially 5 minutes), calculate the largest positive and negative total-viewer delta during the session.

### Counter gain

For followers/subscribers where supported:

`last valid counter - first valid counter`

Do not sum per-snapshot differences.

---

## 12. SSE API

Provide one backend-to-browser event stream for current state.

Suggested endpoint:

`GET /api/live/events`

Events should support at least:

- initial full state
- aggregate snapshot update
- connection/platform state update
- session started
- session ended
- recoverable platform error

Browser reconnect must work without creating duplicate backend polling loops.

Provide normal HTTP endpoints for initial/history/report data rather than trying to push the entire database through SSE.

---

## 13. HTTP API surface

Exact routes may vary, but keep a clean separation.

Suggested V1 endpoints:

```text
GET  /api/health
GET  /api/state
GET  /api/live/events

GET  /api/platforms
POST /api/platforms/twitch/connect
GET  /api/platforms/twitch/oauth/callback
POST /api/platforms/twitch/disconnect
POST /api/platforms/vk-live/connect
GET  /api/platforms/vk-live/oauth/callback
POST /api/platforms/vk-live/disconnect

GET  /api/sessions
GET  /api/sessions/:id
GET  /api/sessions/:id/metrics
GET  /api/sessions/:id/events
```

OAuth callback details must follow each platform's actual flow rather than being forced into an identical implementation.

---

## 14. Frontend specification

### Full dashboard

Desktop-first responsive layout.

Header/status area:

- LIVE/OFFLINE
- duration
- last update
- settings button

Hero metric:

- very large total viewers
- 5-minute delta directly below
- secondary 15-minute delta

Summary row:

- peak
- average
- live platform count

Platform cards:

- logo/name
- connection/live state
- current viewers
- peak
- average
- follower/subscriber counters where available
- gain this stream
- optional extra metrics
- error/stale state

Chart:

- total line emphasized
- one line per active platform
- time range for current session
- no excessive animation
- tooltip with timestamp and platform values
- responsive and efficient

Events/insights area:

- new peak
- strong growth
- strong decline
- later platform-native events

### Compact dashboard

Keep it glanceable.

Required:

- LIVE duration
- total viewers
- 5-minute delta
- per-platform current viewers
- total peak

No chart required in compact mode V1.

---

## 15. Visual direction

The application should feel like a modern streaming/operations dashboard, not an admin CRUD table.

Preferred characteristics:

- dark UI by default
- high-contrast hero viewer count
- restrained animation
- platform identity visible but not visually noisy
- clear green/red/neutral trend language
- readable from a second monitor
- responsive at common OBS dock widths

Avoid:

- giant data tables on the main screen
- excessive gradients/effects
- tiny text
- decorative animation that uses GPU/CPU unnecessarily

---

## 16. Security requirements

Mandatory:

- bind backend to loopback only
- do not expose privileged CORS origins unnecessarily
- no platform secrets in frontend bundles
- no tokens in query strings unless a third-party OAuth protocol absolutely requires a short-lived authorization code callback; access/refresh tokens must not be placed in application URLs
- redact `Authorization`, access tokens, refresh tokens, client secrets from logs
- gitignore all local secret/config/runtime DB files
- provide `.env.example` with names only, never real values
- request minimum OAuth scopes
- validate OAuth state/CSRF protection
- use PKCE where supported/appropriate by the platform flow
- handle refresh-token rotation safely where applicable
- do not log full third-party API responses if they can contain credentials/private data

---

## 17. Reliability requirements

The dashboard must degrade gracefully.

Required cases:

- Twitch unavailable, VK continues
- VK unavailable, Twitch continues
- temporary network loss
- OAuth token expires
- refresh succeeds
- refresh fails and platform requires reconnect
- no stream currently live
- stream starts while dashboard is already open
- one platform starts later than the other
- one platform ends earlier than the other
- browser tab reconnects to SSE
- backend restarts with previous sessions preserved

Do not create duplicate sessions solely because the browser was refreshed.

---

## 18. Performance requirements

V1 is intended to coexist with OBS and a game.

Engineering constraints:

- no busy polling
- no high-frequency timers below the required metrics cadence unless necessary for local UI duration display
- one backend polling coordinator
- bounded API concurrency
- SQLite writes batched or transaction-safe where appropriate
- no unbounded in-memory event history
- frontend chart should not rerender the entire application unnecessarily
- use lightweight local assets; no background video or WebGL

Add simple runtime diagnostics so CPU/memory behavior can be checked during development.

---

## 19. Testing

Required automated coverage should include at least:

### Unit

- aggregation
- trend calculations
- time-weighted average
- peak
- counter gain
- session state transitions
- stale/error handling

### Adapter tests

Use mocked HTTP/event responses for Twitch and VK.

Test:

- live
- offline
- unauthorized optional metric
- expired token
- rate limit
- malformed/partial API response

### Integration

- server boots on dynamically assigned port
- health endpoint works
- SSE initial state/update/reconnect
- SQLite migration and session persistence
- browser reload does not create duplicate polling coordinator/session

### Frontend

At minimum verify:

- unsupported metrics hidden
- zero viewers displayed as zero when it is a valid live/offline metric
- null metric not confused with zero
- platform error state does not blank the whole dashboard
- compact view works at narrow widths

---

## 20. Development phases

### Phase 0 — Foundation

Deliver:

- project structure
- TypeScript config
- lint/format/test commands
- local server with dynamic port
- React frontend served locally
- health endpoint
- SQLite migrations
- normalized domain types
- adapter interface
- fake/demo adapter
- SSE transport

Acceptance:

- one command starts the product
- browser opens automatically
- app runs on an OS-assigned free localhost port
- fake metrics visibly update without full-page reload

### Phase 1 — Core analytics with simulated data

Deliver before third-party API complexity:

- session lifecycle
- metric persistence
- total/per-platform aggregation
- 1/5/15/30 minute deltas
- peak
- time-weighted average
- platform share
- chart
- compact view
- session report page

Acceptance:

- a simulated 1+ hour session can be replayed/generated and produces correct dashboard/report values

### Phase 2 — Twitch integration

Deliver:

- Twitch OAuth
- secure token storage abstraction
- Twitch adapter
- live/offline
- viewers
- title/category/start time
- followers where authorized
- paid subscribers/chatters as optional metrics based on scopes and API support
- robust error/refresh behavior

Acceptance:

- real Twitch account can connect and produce live normalized snapshots without secrets reaching the browser

### Phase 3 — VK Video Live integration

Deliver equivalent VK capabilities based on official API support.

Acceptance:

- real VK Video Live channel can connect
- current live metrics appear alongside Twitch
- total/analytics work unchanged without platform-specific hacks in the UI

### Phase 4 — Hardening and first distributable

Deliver:

- production build
- single easy Windows launch path
- runtime data directory
- safe secret/config handling
- logging/redaction
- graceful shutdown
- reconnect flows
- smoke tests
- user setup documentation

The final packaging mechanism may be chosen during this phase. It must keep the localhost-web architecture and should not introduce Electron unless there is a strong demonstrated reason.

---

## 21. Definition of done for V1

V1 is accepted when the streamer can:

1. launch StreamTool easily on Windows
2. have it automatically choose a free local port and open the dashboard
3. connect Twitch and VK Video Live
4. see current total viewers and each platform's viewers
5. see metrics refresh within the intended 15-second live cadence
6. see 1/5/15/30 minute changes as history becomes available
7. see peak and average values
8. see a clear session chart
9. use a compact view next to/in OBS
10. end a stream and open a persisted report later
11. restart StreamTool without losing previous reports
12. use the product without exposing platform secrets in frontend code, URLs, logs, or Git
13. continue seeing healthy platform data if another platform temporarily fails

---

## 22. Non-goals for V1

Do not implement unless explicitly moved into scope later:

- unified cross-platform chat
- moderation
- donation/payment aggregation
- cloud sync
- remote access
- SaaS accounts
- mobile app
- automatic VOD analysis
- viewer identity deduplication across platforms
- stream control/OBS scene automation
- elaborate alerts system

---

## 23. Delivery process for implementation work

For implementation tasks:

1. fetch current `origin/main`
2. create a dedicated feature branch
3. make a small real first commit early
4. push it
5. open a Draft PR early
6. implement in checkpoints
7. commit and push after each major checkpoint
8. keep PR description updated with implemented scope, tests and known limitations
9. do not merge without owner review

Source-of-truth documents:

- `docs/PRODUCT_CONCEPT.md`
- `docs/DEVELOPMENT_BRIEF.md`

When implementation reality conflicts with an assumption in this brief, do not silently redesign the product. Document the API/platform constraint in the PR and preserve the product intent with the smallest reasonable adjustment.
