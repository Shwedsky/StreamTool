import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TwitchCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userId: string;
  login: string;
  displayName: string;
  scopes: string[];
  updatedAt: string;
}

interface TwitchLocalState {
  clientId: string | null;
  credentials: TwitchCredentials | null;
}

function defaultStatePath(): string {
  const base = process.env.LOCALAPPDATA
    ?? process.env.XDG_DATA_HOME
    ?? join(homedir(), '.local', 'share');
  return join(base, 'StreamTool', 'twitch-auth.json');
}

function emptyState(): TwitchLocalState {
  return { clientId: null, credentials: null };
}

export class TwitchStateStore {
  private state: TwitchLocalState;

  constructor(private readonly path = process.env.STREAMTOOL_TWITCH_STATE_PATH ?? defaultStatePath()) {
    this.state = this.read();
    const envClientId = process.env.STREAMTOOL_TWITCH_CLIENT_ID?.trim();
    if (envClientId) this.state.clientId = envClientId;
  }

  getClientId(): string | null {
    return this.state.clientId;
  }

  setClientId(clientId: string): void {
    this.state.clientId = clientId.trim();
    this.write();
  }

  getCredentials(): TwitchCredentials | null {
    return this.state.credentials ? { ...this.state.credentials, scopes: [...this.state.credentials.scopes] } : null;
  }

  saveCredentials(credentials: TwitchCredentials): void {
    this.state.credentials = {
      ...credentials,
      scopes: [...credentials.scopes]
    };
    this.write();
  }

  clearCredentials(): void {
    this.state.credentials = null;
    this.write();
  }

  clearAll(): void {
    this.state = emptyState();
    if (existsSync(this.path)) rmSync(this.path, { force: true });
  }

  private read(): TwitchLocalState {
    if (!existsSync(this.path)) return emptyState();

    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<TwitchLocalState>;
      return {
        clientId: typeof parsed.clientId === 'string' && parsed.clientId.trim() ? parsed.clientId.trim() : null,
        credentials: this.isCredentials(parsed.credentials) ? parsed.credentials : null
      };
    } catch {
      return emptyState();
    }
  }

  private isCredentials(value: unknown): value is TwitchCredentials {
    if (!value || typeof value !== 'object') return false;
    const row = value as Record<string, unknown>;
    return typeof row.accessToken === 'string'
      && typeof row.refreshToken === 'string'
      && typeof row.expiresAt === 'string'
      && typeof row.userId === 'string'
      && typeof row.login === 'string'
      && typeof row.displayName === 'string'
      && Array.isArray(row.scopes)
      && row.scopes.every((scope) => typeof scope === 'string')
      && typeof row.updatedAt === 'string';
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(temp, 0o600); } catch { /* Windows ACLs are handled by the user profile directory. */ }
    renameSync(temp, this.path);
  }
}
