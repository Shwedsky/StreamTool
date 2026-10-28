# StreamTool

Local-first multistream dashboard for streamers.

StreamTool aggregates live metrics from multiple streaming platforms into one lightweight localhost dashboard with history, trends and post-stream analytics.

Initial target platforms:

- Twitch
- VK Video Live

The product runs locally on the streamer's PC, binds automatically to a free localhost port, keeps platform credentials on the backend, refreshes live metrics on a lightweight cadence, stores session history in SQLite, and exposes both a full dashboard and compact view.

## Project documents

- [Product Concept](docs/PRODUCT_CONCEPT.md) — product scope, UX, metrics, security and extensibility principles.
- [Development Brief](docs/DEVELOPMENT_BRIEF.md) — implementation handoff with architecture, data model, API boundaries, phases, testing and definition of done.

## Repository

https://github.com/Shwedsky/StreamTool

## Initial delivery sequence

1. Foundation: local backend, dynamic port, React UI, SQLite, SSE and demo adapter.
2. Core analytics on simulated data.
3. Twitch integration.
4. VK Video Live integration.
5. Hardening and easy Windows launch/distribution.

Implementation work should be done in dedicated branches with Draft PRs and owner review before merge.
