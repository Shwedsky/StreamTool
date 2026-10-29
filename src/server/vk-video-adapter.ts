import { randomBytes } from 'node:crypto';
import type { PlatformAdapter, PlatformSnapshot } from '../shared/domain.js';
import { VkVideoStateStore, type VkVideoCredentials } from './vk-video-state-store.js';

const API = 'https://api.live.vkvideo.ru';
const AUTHORIZE_URL = 'https://auth.live.vkvideo.ru/app/oauth2/authorize';
const TOKEN_URL = `${API}/oauth/server/token`;
const REVOKE_URL = `${API}/oauth/server/revoke`;
const REQUEST_TIMEOUT_MS = 8_000;
const VALIDATE_INTERVAL_MS = 60 * 60_000;
const AUTH_STATE_TTL_MS = 10 * 60_000;

export type VkVideoAuthState = 'not_configured' | 'disconnected' | 'authorizing' | 'connected' | 'reconnect_required';

export interface VkVideoAuthStatus {
  state: VkVideoAuthState;
  configured: boolean;
  connected: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  redirectUri: string;
  broadcaster: { displayName: string | null; channelUrl: string | null } | null;
  authorizationUrl: string | null;
  error: string | null;
}

interface PendingAuthorization {
  state: string;
  expiresAtMs: number;
  authorizationUrl: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string | string[];
}

interface CurrentUserResponse {
  data?: {
    channel?: { url?: string | null } | null;
    user?: { nick?: string | null } | null;
  };
}

interface VkReaction {
  count?: number;
  type?: string;
}

interface ChannelResponse {
  data?: {
    channel?: {
      nick?: string | null;
      url?: string | null;
      counters?: { subscribers?: number | null } | null;
    } | null;
    stream?: {
      title?: string | null;
      status?: string | null;
      started_at?: number | string | null;
      category?: { title?: string | null } | null;
      counters?: {
        viewers?: number | null;
        views?: number | null;
      } | null;
      reactions?: VkReaction[] | null;
    } | null;
  };
}

class VkVideoHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

function responseErrorMessage(status: number): string {
  if (status === 401) return 'Авторизация VK Video Live недействительна';
  if (status === 403) return 'VK Video Live запретил доступ к данным';
  if (status === 429) return 'VK Video Live временно ограничил частоту запросов';
  return `VK Video Live HTTP ${status}`;
}

function toIsoTimestamp(value: number | string | null | undefined): string | null {
  if (value == null) return null;
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const milliseconds = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function sumReactions(reactions: VkReaction[] | null | undefined): number | null {
  if (!Array.isArray(reactions)) return null;
  return reactions.reduce((sum, reaction) => {
    const count = reaction?.count;
    return sum + (typeof count === 'number' && Number.isFinite(count) ? count : 0);
  }, 0);
}

export class VkVideoPlatformAdapter implements PlatformAdapter {
  readonly id = 'vk-live' as const;
  readonly displayName = 'VK Видео Live';

  private pending: PendingAuthorization | null = null;
  private reconnectRequired = false;
  private authError: string | null = null;
  private lastValidatedAtMs = 0;

  constructor(
    private readonly stateStore = new VkVideoStateStore(),
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async initialize(): Promise<void> {
    if (!this.stateStore.getCredentials()) return;
    try {
      await this.ensureAuthorized(true);
    } catch (error) {
      this.requireReconnect(error instanceof Error ? error.message : 'Не удалось проверить VK Video Live авторизацию');
    }
  }

  getRedirectUri(): string {
    return this.stateStore.getRedirectUri();
  }

  getAuthStatus(): VkVideoAuthStatus {
    this.expirePendingIfNeeded();
    const clientId = this.stateStore.getClientId();
    const hasSecret = this.stateStore.hasClientSecret();
    const credentials = this.stateStore.getCredentials();
    const configured = Boolean(clientId && hasSecret);

    let state: VkVideoAuthState;
    if (!configured) state = 'not_configured';
    else if (this.pending) state = 'authorizing';
    else if (this.reconnectRequired) state = 'reconnect_required';
    else if (credentials) state = 'connected';
    else state = 'disconnected';

    return {
      state,
      configured,
      connected: state === 'connected',
      clientIdConfigured: Boolean(clientId),
      clientSecretConfigured: hasSecret,
      redirectUri: this.stateStore.getRedirectUri(),
      broadcaster: credentials
        ? { displayName: credentials.displayName ?? credentials.userNick, channelUrl: credentials.channelUrl }
        : null,
      authorizationUrl: this.pending?.authorizationUrl ?? null,
      error: this.authError
    };
  }

  configure(clientId: string, clientSecret: string): VkVideoAuthStatus {
    const normalizedId = clientId.trim();
    const normalizedSecret = clientSecret.trim();
    if (!/^[a-z0-9_-]{3,120}$/i.test(normalizedId)) throw new Error('Client ID VK Video Live выглядит некорректно');
    if (normalizedSecret.length < 8 || normalizedSecret.length > 300) throw new Error('Client Secret VK Video Live выглядит некорректно');

    this.stateStore.configure(normalizedId, normalizedSecret);
    this.pending = null;
    this.reconnectRequired = false;
    this.authError = null;
    this.lastValidatedAtMs = 0;
    return this.getAuthStatus();
  }

  beginAuthorization(): VkVideoAuthStatus {
    const { clientId } = this.requireClientCredentials();
    const redirectUri = this.stateStore.getRedirectUri();
    const state = randomBytes(24).toString('hex');
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);

    this.pending = {
      state,
      expiresAtMs: Date.now() + AUTH_STATE_TTL_MS,
      authorizationUrl: url.toString()
    };
    this.reconnectRequired = false;
    this.authError = null;
    return this.getAuthStatus();
  }

  async completeAuthorization(code: string, state: string): Promise<VkVideoAuthStatus> {
    this.expirePendingIfNeeded();
    const pending = this.pending;
    if (!pending) throw new Error('Сессия подключения VK Video Live не найдена или истекла');
    if (!state || state !== pending.state) throw new Error('VK OAuth state не совпадает. Подключение отменено.');
    if (!code?.trim()) throw new Error('VK Video Live не вернул authorization code');

    const token = await this.exchangeCode(code.trim());
    const identity = await this.fetchCurrentUser(token.accessToken);
    const credentials: VkVideoCredentials = {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      userNick: identity.userNick,
      channelUrl: identity.channelUrl,
      displayName: identity.userNick,
      updatedAt: new Date().toISOString()
    };

    if (identity.channelUrl) {
      try {
        const channel = await this.fetchChannel(token.accessToken, identity.channelUrl);
        credentials.displayName = channel.data?.channel?.nick ?? identity.userNick;
      } catch {
        // Identity is enough to complete OAuth; polling can surface channel errors later.
      }
    }

    this.stateStore.saveCredentials(credentials);
    this.pending = null;
    this.reconnectRequired = false;
    this.authError = null;
    this.lastValidatedAtMs = Date.now();
    return this.getAuthStatus();
  }

  async disconnect(): Promise<VkVideoAuthStatus> {
    const credentials = this.stateStore.getCredentials();
    this.pending = null;
    if (credentials) {
      try { await this.revoke(credentials.accessToken); } catch { /* Best effort only. */ }
    }
    this.stateStore.clearCredentials();
    this.reconnectRequired = false;
    this.authError = null;
    this.lastValidatedAtMs = 0;
    return this.getAuthStatus();
  }

  async getSnapshot(): Promise<PlatformSnapshot> {
    const now = new Date().toISOString();
    let credentials = this.stateStore.getCredentials();
    if (!credentials || this.reconnectRequired) return this.disconnectedSnapshot(now);

    const accessToken = await this.ensureAuthorized(false);
    credentials = this.stateStore.getCredentials();
    if (!credentials) return this.disconnectedSnapshot(now);

    let channelUrl = credentials.channelUrl;
    if (!channelUrl) {
      const identity = await this.fetchCurrentUser(accessToken);
      channelUrl = identity.channelUrl;
      if (identity.userNick !== credentials.userNick || channelUrl !== credentials.channelUrl) {
        credentials = {
          ...credentials,
          userNick: identity.userNick,
          channelUrl,
          displayName: identity.userNick,
          updatedAt: now
        };
        this.stateStore.saveCredentials(credentials);
      }
    }

    if (!channelUrl) {
      return {
        platformId: this.id,
        platformName: this.displayName,
        connected: true,
        health: 'ok',
        error: null,
        live: false,
        viewers: 0,
        followers: null,
        paidSubscribers: null,
        chatters: null,
        reactions: null,
        views: null,
        streamTitle: null,
        category: null,
        startedAt: null,
        updatedAt: now
      };
    }

    const response = await this.apiGet<ChannelResponse>(
      `/v1/channel?channel_url=${encodeURIComponent(channelUrl)}`,
      accessToken
    );
    const channel = response.data?.channel ?? null;
    const stream = response.data?.stream ?? null;
    const live = stream?.status === 'started';
    const displayName = channel?.nick ?? credentials.displayName ?? credentials.userNick;

    if (displayName !== credentials.displayName) {
      this.stateStore.saveCredentials({ ...credentials, displayName, updatedAt: now });
    }

    return {
      platformId: this.id,
      platformName: this.displayName,
      connected: true,
      health: 'ok',
      error: null,
      live,
      viewers: live && typeof stream?.counters?.viewers === 'number' ? stream.counters.viewers : 0,
      followers: typeof channel?.counters?.subscribers === 'number' ? channel.counters.subscribers : null,
      paidSubscribers: null,
      chatters: null,
      reactions: stream ? sumReactions(stream.reactions) : null,
      views: typeof stream?.counters?.views === 'number' ? stream.counters.views : null,
      streamTitle: stream?.title || null,
      category: stream?.category?.title || null,
      startedAt: live ? toIsoTimestamp(stream?.started_at) : null,
      updatedAt: now
    };
  }

  private disconnectedSnapshot(now: string): PlatformSnapshot {
    return {
      platformId: this.id,
      platformName: this.displayName,
      connected: false,
      health: this.reconnectRequired ? 'error' : 'ok',
      error: this.reconnectRequired ? (this.authError ?? 'Требуется повторное подключение VK Video Live') : null,
      live: false,
      viewers: null,
      followers: null,
      paidSubscribers: null,
      chatters: null,
      reactions: null,
      views: null,
      streamTitle: null,
      category: null,
      startedAt: null,
      updatedAt: now
    };
  }

  private expirePendingIfNeeded(): void {
    if (this.pending && Date.now() >= this.pending.expiresAtMs) {
      this.pending = null;
      this.authError = 'Время подключения VK Video Live истекло. Нажмите «Подключить VK» ещё раз.';
    }
  }

  private async ensureAuthorized(forceValidation: boolean): Promise<string> {
    let credentials = this.stateStore.getCredentials();
    if (!credentials) throw new Error('VK Video Live не подключён');

    const expiresAtMs = Date.parse(credentials.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs - Date.now() < 60_000) {
      credentials = await this.refresh(credentials);
    }

    if (forceValidation || Date.now() - this.lastValidatedAtMs >= VALIDATE_INTERVAL_MS) {
      const valid = await this.validate(credentials.accessToken);
      if (!valid) credentials = await this.refresh(credentials);
      else this.lastValidatedAtMs = Date.now();
    }

    return credentials.accessToken;
  }

  private async validate(accessToken: string): Promise<boolean> {
    const response = await this.fetchFn(`${API}/v1/token`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (response.status === 401) return false;
    if (!response.ok) throw new VkVideoHttpError(response.status, responseErrorMessage(response.status));
    return true;
  }

  private async exchangeCode(code: string): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string }> {
    const { clientId, clientSecret } = this.requireClientCredentials();
    const response = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(clientId, clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.stateStore.getRedirectUri()
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new VkVideoHttpError(response.status, 'VK Video Live не принял authorization code');
    return this.parseToken(await response.json() as TokenResponse);
  }

  private async refresh(previous: VkVideoCredentials): Promise<VkVideoCredentials> {
    if (!previous.refreshToken) {
      this.requireReconnect('VK Video Live не вернул refresh token. Требуется повторное подключение.');
      throw new Error('VK Video Live требует повторное подключение');
    }

    const { clientId, clientSecret } = this.requireClientCredentials();
    const response = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(clientId, clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: previous.refreshToken,
        redirect_uri: this.stateStore.getRedirectUri()
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      this.requireReconnect('Не удалось обновить авторизацию VK Video Live');
      throw new VkVideoHttpError(response.status, responseErrorMessage(response.status));
    }

    const token = this.parseToken(await response.json() as TokenResponse, previous.refreshToken);
    const rotated: VkVideoCredentials = {
      ...previous,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      updatedAt: new Date().toISOString()
    };
    this.stateStore.saveCredentials(rotated);
    this.lastValidatedAtMs = Date.now();
    return rotated;
  }

  private parseToken(payload: TokenResponse, fallbackRefreshToken: string | null = null) {
    if (!payload?.access_token) throw new Error('VK Video Live не вернул access token');
    const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in > 0 ? payload.expires_in : 3600;
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? fallbackRefreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
    };
  }

  private async fetchCurrentUser(accessToken: string): Promise<{ userNick: string | null; channelUrl: string | null }> {
    const response = await this.apiGet<CurrentUserResponse>('/v1/current_user', accessToken);
    return {
      userNick: response.data?.user?.nick ?? null,
      channelUrl: response.data?.channel?.url ?? null
    };
  }

  private async fetchChannel(accessToken: string, channelUrl: string): Promise<ChannelResponse> {
    return this.apiGet<ChannelResponse>(`/v1/channel?channel_url=${encodeURIComponent(channelUrl)}`, accessToken);
  }

  private async apiGet<T>(path: string, accessToken: string, retry = true): Promise<T> {
    const response = await this.fetchFn(`${API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (response.status === 401 && retry) {
      const current = this.stateStore.getCredentials();
      if (!current) throw new VkVideoHttpError(401, 'VK Video Live authorization missing');
      const refreshed = await this.refresh(current);
      return this.apiGet<T>(path, refreshed.accessToken, false);
    }
    if (!response.ok) throw new VkVideoHttpError(response.status, responseErrorMessage(response.status));
    return response.json() as Promise<T>;
  }

  private async revoke(accessToken: string): Promise<void> {
    const { clientId, clientSecret } = this.requireClientCredentials();
    const response = await this.fetchFn(REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(clientId, clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ token: accessToken, token_type_hint: 'access_token' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok && response.status !== 401) {
      throw new VkVideoHttpError(response.status, responseErrorMessage(response.status));
    }
  }

  private requireReconnect(message: string): void {
    this.stateStore.clearCredentials();
    this.pending = null;
    this.reconnectRequired = true;
    this.authError = message;
    this.lastValidatedAtMs = 0;
  }

  private requireClientCredentials(): { clientId: string; clientSecret: string } {
    const clientId = this.stateStore.getClientId();
    const clientSecret = this.stateStore.getClientSecret();
    if (!clientId || !clientSecret) throw new Error('Сначала укажите VK Video Live Client ID и Client Secret');
    return { clientId, clientSecret };
  }
}
