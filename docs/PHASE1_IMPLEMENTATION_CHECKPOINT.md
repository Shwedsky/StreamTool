# Phase 1 — Analytics & stream history

Status: **in progress**

Branch: `feature/phase1-analytics`

## Goal

Turn the Phase 0 live counter shell into a real stream analytics dashboard while keeping the owner experience simple: download portable Windows ZIP, unzip, double-click, review in browser.

## Scope

Phase 1 works on demo VK Video Live + Twitch data. Real OAuth/API integrations remain Phase 2 and Phase 3.

Deliver:

- explicit stream-session lifecycle
- history queries backed by SQLite
- current/average/maximum viewers for the active session
- Total / VK / Twitch timeline chart
- viewer deltas over 1 / 5 / 15 / 30 minutes
- platform audience share
- peak time and best growth window
- automatic session report when a demo stream ends
- one-screen live dashboard remains the primary UX
- `/compact` remains low-noise and stream-friendly
- Windows portable artifact remains the owner test path

## UX rules carried forward from owner review

- no vertical scrolling during a live stream on a normal desktop viewport
- total viewers are the primary number
- Twitch and VK online viewers are the secondary dominant numbers
- channel totals such as followers/subscribers must be visually separated from live-stream metrics
- use Russian metric labels
- show exact last-update time instead of polling cadence
- category/game metadata is secondary and must not compete with live metrics
- working product name: `StreamToolByShwedsky`

## Delivery process

- commit/push in checkpoints
- Draft PR to `main`
- CI + Windows portable smoke test required
- do not merge before owner review
