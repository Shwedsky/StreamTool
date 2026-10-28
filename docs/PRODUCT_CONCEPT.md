# StreamTool — Product Concept V1

Repository: https://github.com/Shwedsky/StreamTool

## 1. Product goal

StreamTool is a local-first multistream dashboard for streamers broadcasting to several platforms simultaneously.

The primary problem is simple: during a stream it is difficult to understand total audience size, how viewers are distributed between platforms, whether the audience is growing or falling, and what happened over the course of the stream.

The first target platforms are:

- Twitch
- VK Video Live

The product must be designed so that YouTube, Kick and other platforms can later be added through adapters without redesigning the dashboard, storage or reporting model.

## 2. Core UX

The streamer launches StreamTool locally. The backend binds to an OS-assigned free port, starts the local web UI and opens the browser automatically.

Example:

`http://127.0.0.1:<free-port>`

The user does not select or configure the port manually.

The main dashboard is built around the most important metric:

- total concurrent viewers across all connected live platforms

This is a summed platform count, not a deduplicated count of unique people. If the same person watches on two platforms, both platform counts are included.

## 3. Main dashboard metrics

### Global

- current total viewers
- change over 1 / 5 / 15 / 30 minutes
- current stream duration
- total peak viewers
- total average viewers
- platform audience share
- live/offline state
- timestamp of last successful refresh

### Twitch

- current viewers
- peak viewers during the session
- average viewers during the session
- followers
- follower gain during the session
- paid subscribers where authorized and available
- paid subscriber gain during the session where available
- chatters where available
- stream title
- category/game
- stream start time
- live/offline state

### VK Video Live

- current viewers
- peak viewers during the session
- average viewers during the session
- channel subscribers/followers according to platform terminology
- subscriber gain during the session
- stream views where available
- reactions where available
- stream title
- category
- stream start time
- live/offline state

Unsupported metrics must be `null` in the normalized model and must not produce empty or misleading UI rows.

## 4. Refresh model

Target polling cadence:

- while at least one connected platform is live: every 15 seconds
- while all platforms are offline: every 60 seconds

The architecture should allow configuration of this cadence later, but V1 should use sensible defaults with no required user configuration.

Push/event APIs may be used for event-type information where they provide real value, but live viewer counts do not need sub-second updates.

## 5. Dashboard modes

### Full dashboard

Main working screen with:

- large total current viewers value
- per-platform cards
- total / platform trend chart
- peak and average values
- changes over time windows
- session event markers
- session metadata

### Compact dashboard

A small layout suitable for a second monitor or OBS dock.

Minimum information:

- live duration
- total current viewers
- change over 5 minutes
- current viewers by platform
- total peak viewers

### Future overlay

A browser-source-friendly minimal endpoint may later be used for overlays, but it is not required for the first implementation milestone.

## 6. Session analytics

Every live broadcast is represented as a `StreamSession`.

For each session StreamTool should retain metric snapshots and derive:

- duration
- total peak
- total average
- ending viewer count
- per-platform peak
- per-platform average
- follower/subscriber gain where available
- best growth interval
- largest decline interval
- time of peak
- platform share over time

Potential event markers:

- new peak
- rapid growth
- rapid decline
- Twitch raid
- follow
- paid subscription
- VK platform events where supported

Initial implementation can begin with purely calculated markers and later enrich them with platform events.

## 7. Reporting

After a stream ends, the user should be able to open a session report containing:

- date/time
- duration
- total peak and average
- ending viewer count
- per-platform statistics
- follower/subscriber deltas
- full session chart
- detected important moments

Report data must come from stored normalized snapshots rather than external platform history APIs, so the report remains available after the stream.

## 8. Security principles

The frontend must never contain platform client secrets or refresh tokens.

The browser UI must not call Twitch/VK APIs directly with privileged credentials.

Credentials and refresh tokens are owned by the local backend.

Requirements:

- no secrets committed to Git
- `.env*` / local secret storage excluded from Git
- tokens must never be placed in URLs
- logs must redact tokens and authorization headers
- request only minimum OAuth scopes required by enabled features
- bind local HTTP server to loopback only by default (`127.0.0.1` / `::1` as appropriate)
- do not expose the dashboard to the LAN by default

A later Windows-packaged release may use OS credential storage. Development can use a safe local secret mechanism as long as it is isolated from source control.

## 9. Performance principles

StreamTool runs on the same machine as OBS and a game, so overhead must be minimal.

V1 target behavior:

- one lightweight local backend process
- one local web UI
- polling only at the configured cadence
- SQLite for local persistence
- no Electron runtime
- bounded in-memory caches
- no high-frequency render loops for metrics
- chart rendering based on stored samples, with sensible downsampling only when session history becomes large

## 10. Extensibility

Platform integrations must implement a normalized adapter contract rather than leaking platform-specific fields through the product.

Conceptual contract:

```ts
interface PlatformAdapter {
  id: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getConnectionState(): Promise<PlatformConnectionState>;
  getSnapshot(): Promise<PlatformSnapshot>;
  startEvents?(sink: PlatformEventSink): Promise<void>;
  stopEvents?(): Promise<void>;
}
```

Conceptual normalized snapshot:

```ts
interface PlatformSnapshot {
  platform: string;
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

The exact implementation may evolve, but the separation between platform adapters, normalized domain model and UI is mandatory.

## 11. Preferred technology direction

Initial preference:

- TypeScript end-to-end
- Node.js local backend
- Fastify or similarly lightweight HTTP framework
- React + Vite frontend
- SQLite local database
- SSE for backend-to-browser live updates in V1

WebSocket is not required for the first version because the main live data flow is server-to-browser. It may be added later when bidirectional realtime control becomes useful.

## 12. Explicit non-goals for the first version

Do not turn V1 into a general streaming suite.

Not required initially:

- unified chat
- moderation tools
- donation aggregation
- OBS scene automation
- cloud accounts
- cloud sync
- public internet access
- multi-user SaaS
- mobile app
- deduplication of viewers between platforms

These can be considered only after the core dashboard and session analytics are proven useful.
