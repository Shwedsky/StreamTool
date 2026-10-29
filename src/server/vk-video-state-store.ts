import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_VK_REDIRECT_URI = 'http://127.0.0.1:43187/api/platforms/vk-live/oauth/callback';

export interface VkVideoCredentials {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  userNick: string | null;
  channelUrl: string | null;
  displayName: string | null;
  updatedAt: string;
}

interface VkVideoLocalState {
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string;
  credentials: VkVideoCredentials | null;
}

function defaultStatePath(): string {
  const base = process.env.LOCALAPPDATA
    ?? process.env.XDG_DATA_HOME
    ?? join(homedir(), '.local', 'share');
  return join(base, 'StreamTool', 'vk-video-auth.json');
}

function emptyState(): VkVideoLocalState {
  return {
    clientId: null,
    clientSecret: null,
    redirectUri: process.env.STREAMTOOL_VK_REDIRECT_URI?.trim() || DEFAULT_VK_REDIRECT_URI,
    credentials: null
  };
}

export class VkVideoStateStore {
  private state: VkVideoLocalState;

  constructor(private readonly path = process.env.STREAMTOOL_VK_STATE_PATH ?? defaultStatePath()) {
    this.state = this.read();

    const envClientId = process.env.STREAMTOOL_VK_CLIENT_ID?.trim();
    const envClientSecret = process.env.STREAMTOOL_VK_CLIENT_SECRET?.trim();
    const envRedirectUri = process.env.STREAMTOOL_VK_REDIRECT_URI?.trim();
    if (envClientId) this.state.clientId = envClientId;
    if (envClientSecret) this.state.clientSecret = envClientSecret;
    if (envRedirectUri) this.state.redirectUri = envRedirectUri;
  }

  getClientId(): string | null {
    return this.state.clientId;
  }

  hasClientSecret(): boolean {
    return Boolean(this.state.clientSecret);
  }

  getClientSecret(): string | null {
    return this.state.clientSecret;
  }

  getRedirectUri(): string {
    return this.state.redirectUri;
  }

  configure(clientId: string, clientSecret: string): void {
    const normalizedId = clientId.trim();
    const normalizedSecret = clientSecret.trim();
    const changed = this.state.clientId !== normalizedId || this.state.clientSecret !== normalizedSecret;

    this.state.clientId = normalizedId;
    this.state.clientSecret = normalizedSecret;
    if (changed) this.state.credentials = null;
    this.write();
  }

  getCredentials(): VkVideoCredentials | null {
    return this.state.credentials ? { ...this.state.credentials } : null;
  }

  saveCredentials(credentials: VkVideoCredentials): void {
    this.state.credentials = { ...credentials };
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

  private read(): VkVideoLocalState {
    if (!existsSync(this.path)) return emptyState();

    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<VkVideoLocalState>;
      return {
        clientId: typeof parsed.clientId === 'string' && parsed.clientId.trim() ? parsed.clientId.trim() : null,
        clientSecret: typeof parsed.clientSecret === 'string' && parsed.clientSecret.trim() ? parsed.clientSecret.trim() : null,
        redirectUri: typeof parsed.redirectUri === 'string' && parsed.redirectUri.trim()
          ? parsed.redirectUri.trim()
          : DEFAULT_VK_REDIRECT_URI,
        credentials: this.isCredentials(parsed.credentials) ? parsed.credentials : null
      };
    } catch {
      return emptyState();
    }
  }

  private isCredentials(value: unknown): value is VkVideoCredentials {
    if (!value || typeof value !== 'object') return false;
    const row = value as Record<string, unknown>;
    return typeof row.accessToken === 'string'
      && (typeof row.refreshToken === 'string' || row.refreshToken === null)
      && typeof row.expiresAt === 'string'
      && (typeof row.userNick === 'string' || row.userNick === null)
      && (typeof row.channelUrl === 'string' || row.channelUrl === null)
      && (typeof row.displayName === 'string' || row.displayName === null)
      && typeof row.updatedAt === 'string';
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(temp, 0o600); } catch { /* Windows profile ACLs protect the app-data directory. */ }
    renameSync(temp, this.path);
  }
}
