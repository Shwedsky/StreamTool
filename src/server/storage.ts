import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AppSnapshot, PlatformSnapshot } from '../shared/domain.js';

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
        captured_at, platform_id, live, viewers, followers,
        paid_subscribers, chatters, reactions, views
      ) VALUES (
        @capturedAt, @platformId, @live, @viewers, @followers,
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
  }

  save(snapshot: AppSnapshot): void {
    const writeAll = this.database.transaction((platforms: PlatformSnapshot[]) => {
      for (const platform of platforms) {
        this.insertSnapshot.run({
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

  close(): void {
    this.database.close();
  }
}
