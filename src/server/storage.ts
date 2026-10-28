import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AppSnapshot, PlatformSnapshot } from '../shared/domain.js';

export interface StoredViewerRow {
  capturedAt: string;
  platformId: string;
  live: number;
  viewers: number | null;
}

export interface StoredSession {
  id: string;
  streamStartedAt: string;
  observedAt: string;
  endedAt: string | null;
}

function defaultDatabasePath(): string {
  const base = process.env.LOCALAPPDATA
    ?? process.env.XDG_DATA_HOME
    ?? join(homedir(), '.local', 'share');
  return join(base, 'StreamTool', 'streamtool.db');
}

export class SnapshotStore {
  private readonly database: Database.Database;
  private readonly insertSnapshot: Database.Statement;

  constructor(path = process.env.STREAMTOOL_DB_PATH ?? defaultDatabasePath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = NORMAL');
    this.migrate();
    this.insertSnapshot = this.database.prepare(`
      INSERT INTO platform_snapshots (
        session_id, captured_at, platform_id, live, viewers, followers,
        paid_subscribers, chatters, reactions, views
      ) VALUES (
        @sessionId, @capturedAt, @platformId, @live, @viewers, @followers,
        @paidSubscribers, @chatters, @reactions, @views
      )
    `);
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS platform_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at TEXT NOT NULL,
        platform_id TEXT NOT NULL,
        live INTEGER NOT NULL,
        viewers INTEGER,
        followers INTEGER,
        paid_subscribers INTEGER,
        chatters INTEGER,
        reactions INTEGER,
        views INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_platform_snapshots_time
      ON platform_snapshots(captured_at);

      CREATE INDEX IF NOT EXISTS idx_platform_snapshots_platform_time
      ON platform_snapshots(platform_id, captured_at);

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (1, datetime('now'));
    `);

    const snapshotColumns = this.database.prepare('PRAGMA table_info(platform_snapshots)').all() as Array<{ name: string }>;
    if (!snapshotColumns.some((column) => column.name === 'session_id')) {
      this.database.exec('ALTER TABLE platform_snapshots ADD COLUMN session_id TEXT');
    }

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS stream_sessions (
        id TEXT PRIMARY KEY,
        stream_started_at TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        ended_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_stream_sessions_started
      ON stream_sessions(stream_started_at);

      CREATE INDEX IF NOT EXISTS idx_platform_snapshots_session_time
      ON platform_snapshots(session_id, captured_at);

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (2, datetime('now'));
    `);
  }

  findOpenSession(streamStartedAt: string): StoredSession | null {
    const row = this.database.prepare(`
      SELECT
        id,
        stream_started_at AS streamStartedAt,
        observed_at AS observedAt,
        ended_at AS endedAt
      FROM stream_sessions
      WHERE stream_started_at = ? AND ended_at IS NULL
      ORDER BY observed_at DESC
      LIMIT 1
    `).get(streamStartedAt) as StoredSession | undefined;

    return row ?? null;
  }

  getSession(id: string): StoredSession | null {
    const row = this.database.prepare(`
      SELECT
        id,
        stream_started_at AS streamStartedAt,
        observed_at AS observedAt,
        ended_at AS endedAt
      FROM stream_sessions
      WHERE id = ?
      LIMIT 1
    `).get(id) as StoredSession | undefined;

    return row ?? null;
  }

  ensureSession(id: string, streamStartedAt: string, observedAt: string): void {
    this.database.prepare(`
      INSERT OR IGNORE INTO stream_sessions(id, stream_started_at, observed_at, ended_at)
      VALUES (?, ?, ?, NULL)
    `).run(id, streamStartedAt, observedAt);
  }

  closeSession(id: string, endedAt: string): void {
    this.database.prepare(`
      UPDATE stream_sessions
      SET ended_at = COALESCE(ended_at, ?)
      WHERE id = ?
    `).run(endedAt, id);
  }

  save(snapshot: AppSnapshot, sessionId: string | null): void {
    const writeAll = this.database.transaction((platforms: PlatformSnapshot[]) => {
      for (const platform of platforms) {
        this.insertSnapshot.run({
          sessionId,
          capturedAt: snapshot.generatedAt,
          platformId: platform.platformId,
          live: platform.live ? 1 : 0,
          viewers: platform.viewers,
          followers: platform.followers,
          paidSubscribers: platform.paidSubscribers,
          chatters: platform.chatters,
          reactions: platform.reactions,
          views: platform.views
        });
      }
    });

    writeAll(snapshot.platforms);
  }

  loadSessionViewerRows(sessionId: string): StoredViewerRow[] {
    return this.database.prepare(`
      SELECT
        captured_at AS capturedAt,
        platform_id AS platformId,
        live,
        viewers
      FROM platform_snapshots
      WHERE session_id = ?
      ORDER BY captured_at ASC, platform_id ASC
    `).all(sessionId) as StoredViewerRow[];
  }

  listRecentSessions(limit = 10): StoredSession[] {
    return this.database.prepare(`
      SELECT
        id,
        stream_started_at AS streamStartedAt,
        observed_at AS observedAt,
        ended_at AS endedAt
      FROM stream_sessions
      ORDER BY observed_at DESC
      LIMIT ?
    `).all(limit) as StoredSession[];
  }

  close(): void {
    this.database.close();
  }
}
