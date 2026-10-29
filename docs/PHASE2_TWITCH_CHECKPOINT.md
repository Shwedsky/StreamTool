# Phase 2 — Twitch real integration

Status: implementation in progress

Branch: `feature/phase2-twitch`

## Goal

Replace the Twitch demo adapter with a real Twitch integration while preserving the approved local-first / portable Windows UX and leaving VK on the demo adapter until Phase 3.

The owner experience remains: download ZIP, unzip, double-click, use the browser UI. No Git, Node.js, npm, fixed port, or manual command line setup.

## Authentication decision

Use Twitch OAuth **Device Code Grant Flow** with a **public client**.

This is intentional:

- StreamTool runs locally on Windows.
- The application intentionally binds to an OS-assigned free localhost port.
- Device Code Flow does not require an OAuth redirect URI tied to that runtime port.
- A public device client does not require a client secret in the portable package.
- Twitch currently recommends public clients for more open platforms such as Windows.
- Access and refresh tokens stay local and never enter browser URLs or Git.

Do not switch to Authorization Code Flow unless a later packaging/security decision gives a strong reason.

## Twitch API facts locked for implementation

### Live state and current viewers

Use `GET /helix/streams?user_id=<broadcaster>`.

The Twitch response provides:

- live/offline state (empty stream result means offline)
- `viewer_count`
- `title`
- `game_name`
- `started_at`
- stream id

This endpoint accepts a user access token, so the same authenticated broadcaster token can be used.

### Channel followers

Use `GET /helix/channels/followers?broadcaster_id=<id>&first=1` and read `total`.

Twitch currently returns the total follower count even when detailed follower data is unavailable due to missing `moderator:read:followers`; therefore V1 should not request that scope merely to obtain the total.

### Paid subscriptions

Use `GET /helix/subscriptions?broadcaster_id=<id>&first=1` and read `total`.

Requires user scope:

- `channel:read:subscriptions`

This metric is optional. If unavailable for the broadcaster/account/API response, expose `null`, not zero, and do not fail the whole Twitch snapshot.

### Chatters

Use `GET /helix/chat/chatters?broadcaster_id=<id>&moderator_id=<id>&first=1` and read `total`.

Requires:

- `moderator:read:chatters`

This metric is optional and may lag Twitch reality. Failure must degrade only this field.

## Initial requested scopes

Request only scopes needed for optional broadcaster metrics:

- `channel:read:subscriptions`
- `moderator:read:chatters`

Do **not** request `moderator:read:followers` just for follower total.

If Twitch rejects an optional metric because the broadcaster is ineligible or permissions differ, retain the connected state and return that metric as unavailable.

## Token lifecycle

Twitch requires third-party applications maintaining OAuth sessions to validate access tokens on startup and at least hourly.

Implement:

- `/oauth2/validate` on app startup after stored credentials are loaded
- validation at least hourly while connected
- immediate handling of API 401
- safe refresh-token rotation
- public-device refresh without client secret
- persist the newly returned refresh token atomically before discarding the prior one
- if refresh/validation becomes unrecoverable, mark Twitch as `reconnect_required` without breaking VK or historical data

For a public client, Twitch refresh tokens are one-time use and currently expire 30 days after generation. Rotation and reconnect are therefore normal lifecycle states, not application failures.

## Credential storage

Phase 2 baseline:

- tokens stored only in the local runtime data directory
- never committed to Git
- never returned by normal frontend API state
- never logged
- Authorization headers redacted
- no access/refresh token in browser URLs

Before first wider distribution, evaluate moving Windows token storage behind DPAPI / Credential Manager. The adapter boundary must allow that replacement without changing Twitch logic.

The Twitch **client ID is not a secret** and may be supplied through local product configuration / packaged app configuration. No client secret is required for the chosen public Device Code Flow.

## Product flow

Disconnected Twitch card/settings state:

1. `Подключить Twitch`
2. backend starts Device Code Flow
3. UI shows activation URL and user code, plus an `Открыть Twitch` action
4. backend polls Twitch token endpoint only at the interval required by the device flow
5. after authorization, resolve broadcaster identity and transition to connected
6. polling coordinator begins real Twitch snapshots

Connected state:

- channel display name
- live/offline
- current viewers
- followers total
- paid subscriptions when available
- chatters when available
- title/category/start time internally available; category remains secondary in live UX

Disconnect:

- stop Twitch usage
- clear local Twitch tokens/identity
- retain historical stream sessions already recorded

## Failure isolation

Twitch failures must never blank the whole dashboard.

Examples:

- network timeout -> Twitch stale/error state; VK continues
- token expired -> refresh once and retry
- token revoked -> reconnect required
- paid-sub endpoint unavailable -> only `paidSubscribers = null`
- chatters unavailable -> only `chatters = null`
- Twitch offline -> valid healthy snapshot with `live=false`, `viewers=0`

## Testing required before owner build

Unit / mocked integration:

- Device Flow start response
- authorization pending
- successful token exchange
- expired device code
- token validation
- refresh rotation
- 401 -> refresh -> retry
- unrecoverable refresh -> reconnect required
- stream live mapping
- stream offline mapping
- followers total mapping
- optional paid subscribers failure isolation
- optional chatters failure isolation
- Twitch failure does not block VK demo data

Runtime / portable smoke:

- application still starts on a free localhost port
- dashboard works without Twitch credentials
- disconnected Twitch UI is usable
- no token appears in `/api/state`/snapshot/log output
- Windows portable ZIP still starts without Node/Git installed

## Owner-test dependency

A real Twitch developer application Client ID will be required for the final real-account test. Because Device Code Flow is a public-client flow, **do not request or store a client secret** for the owner test.

## Delivery process

- checkpoint commits + pushes
- Draft PR to `main`
- no merge before owner test
- portable Windows ZIP remains the primary owner-review artifact
