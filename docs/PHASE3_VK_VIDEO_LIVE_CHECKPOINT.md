# Phase 3 — VK Video Live real integration

Status: implementation started as a stacked change on top of `feature/phase2-twitch`.

Branch: `feature/phase3-vk-video-live`
Base while Twitch owner test is pending: `feature/phase2-twitch`

## Goal

Replace the VK demo adapter with a real VK Video Live integration while preserving the approved portable Windows UX:

- download ZIP
- unzip
- double-click `START_STREAMTOOL.cmd`
- configure/connect platforms in the browser UI
- no Git, Node.js, npm, manual command line or fixed localhost port for the owner

After Phase 3, one portable build should be structurally ready for both Twitch + VK Video Live real accounts. Twitch owner verification can happen later without blocking VK implementation.

## Current VK Video Live API findings

Official developer portal: `https://dev.live.vkvideo.ru/`.

A current production implementation using VK Video Live DevAPI confirms the following OAuth/API contract.

### OAuth

VK Video Live uses Authorization Code flow for the server API.

- authorize URL: `https://auth.live.vkvideo.ru/app/oauth2/authorize`
- token URL: `https://api.live.vkvideo.ru/oauth/server/token`
- revoke URL: `https://api.live.vkvideo.ru/oauth/server/revoke`
- client authentication: HTTP Basic using `client_id:client_secret`
- PKCE: not currently used by the documented/current server flow
- `redirect_uri` is required for authorization-code exchange and again on refresh
- scopes are comma-separated if any are requested

For StreamTool V1 analytics we should request **no write scopes** unless a read endpoint proves otherwise. Another current implementation notes that reading channel/stream data needs no additional scopes; `channel:stream:settings` is only needed to edit stream settings, which StreamTool does not need.

### Identity and channel resolution

Use:

- `GET https://api.live.vkvideo.ru/v1/current_user`

Expected useful fields include:

- `data.user.nick`
- `data.channel.url`

A VK account that has never streamed may legitimately have no channel URL. Treat that as connected but no channel, not as an application crash.

### Current channel / stream

Use:

- `GET https://api.live.vkvideo.ru/v1/channel?channel_url=<channel_url>`

Confirmed useful fields from current integrations:

- `data.channel.nick`
- `data.stream.title`
- `data.stream.status` (`started` means live)
- `data.stream.category`
- `data.stream.counters.viewers` — current viewers
- `data.stream.counters.views` — stream views

Historically/currently the platform schema may also expose additional counters/reactions/subscriber-related values. Do not hard-code unsupported assumptions: parse defensively and expose optional metrics only when a confirmed numeric field is present. `null` means unavailable; never convert missing metrics to zero.

### Events / WebSocket

The VK developer portal exposes a separate event-subscription section, and current ecosystem tools use official real-time functionality for chat/viewer events. StreamTool V1 analytics does **not** need to depend on it. REST polling on the existing backend cadence is sufficient for current viewer analytics. Event/PubSub integration is a later enhancement for chat/rewards/raids-like events if needed.

## Important product/security difference from Twitch

Twitch Phase 2 can use a public Device Code client with no client secret.

VK Video Live's current server OAuth requires a client secret. Shipping one shared VK client secret inside a public portable ZIP would not be a real secret.

For the current private/local StreamTool use case, use **owner-supplied VK application credentials**:

1. owner/broadcaster creates an application in the VK Video Live developer cabinet;
2. owner enters Client ID + Client Secret locally in StreamTool;
3. credentials are stored only in the local StreamTool data directory;
4. Client Secret and tokens are never returned to browser state, logs or Git;
5. StreamTool opens the official VK authorization page;
6. callback returns to the dynamically running localhost application.

For broader public distribution later, revisit this architecture. Options include a tiny auth broker/service or an officially supported public-client flow if VK adds one.

## Redirect URI strategy

Unlike Twitch Device Flow, VK Authorization Code needs a redirect URI. StreamTool uses a dynamic localhost port, so V1 should support one of these in priority order:

1. if VK allows loopback redirect URIs with varying port, register `http://127.0.0.1` / loopback and use the runtime callback port;
2. if VK requires an exact redirect URI including port, let the user configure a fixed OAuth callback port separate from the dashboard port;
3. if neither is accepted conveniently, use a small external redirect/auth broker later.

Do not silently assume dynamic-port callbacks are accepted until real developer-console registration confirms it.

## StreamTool adapter mapping

Normalized snapshot target:

- `platformId = vk-live`
- `platformName = VK Видео Live`
- `connected`
- `live`
- `viewers` <- confirmed `stream.counters.viewers`
- `followers` <- optional/null until exact subscriber/follower semantic is confirmed
- `paidSubscribers = null` unless VK exposes an equivalent we intentionally map
- `chatters = null` in polling baseline
- `reactions` <- optional if confirmed by actual API response
- `views` <- confirmed `stream.counters.views`
- `streamTitle` <- `stream.title`
- `category` <- `stream.category.title` where available
- `startedAt` <- optional if confirmed in actual response

## UI flow

Disconnected VK:

1. `Настроить VK`
2. enter Client ID
3. enter Client Secret locally
4. `Сохранить`
5. `Подключить VK`
6. browser opens VK Video Live authorization
7. callback returns to StreamTool
8. VK card switches to connected/real data

Connected VK:

- display account/channel name
- LIVE/OFFLINE
- real current viewers
- stream views when available
- channel subscriber/follower metric only after semantic confirmation
- title/category kept secondary
- disconnect clears VK tokens but retains historical sessions

## Credential handling baseline

Local files only under the StreamTool app-data directory.

Must never expose through browser-facing state/API:

- VK client secret
- VK access token
- VK refresh token

Must never log them.

Before wider distribution, both Twitch and VK credentials should move behind Windows DPAPI/Credential Manager abstraction.

## Reliability

- VK timeout must not block Twitch
- VK auth failure becomes reconnect-required state
- refresh-token rotation persisted safely
- missing channel is valid disconnected-from-stream state, not a crash
- malformed/partial VK payload only degrades VK card
- missing optional metric = `null`

## Tests required

- authorize URL construction
- callback state validation
- code exchange uses Basic client auth
- refresh includes redirect URI
- token/secret leak guards
- `current_user` mapping
- no-channel state
- live `channel` response mapping
- offline response mapping
- viewers/views mapping
- missing optional fields become null
- VK failure does not block Twitch adapter
- portable build starts with VK unconfigured

## Owner setup dependency

To perform real VK testing, create an application in the VK Video Live developer cabinet at `https://dev.live.vkvideo.ru/` while signed in through VK ID.

Do not paste the VK Client Secret into chat. Enter it only into the local StreamTool UI once the Phase 3 build is ready.

## Delivery process

- stacked Draft PR while Phase 2 Twitch is pending
- checkpoint commits + pushes
- CI + Windows portable smoke
- no merge before real VK owner test
- after Phase 2 merges, retarget/rebase Phase 3 to `main`
