import type { PlatformAdapter, PlatformSnapshot } from '../shared/domain.js';
import { TwitchStateStore, type TwitchCredentials } from './twitch-state-store.js';

const TWITCH_DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const TWITCH_API = 'https://api.twitch.tv/helix';
const REQUEST_TIMEOUT_MS = 8_000;
const VALIDATE_INTERVAL_MS = 60 * 60_000;
const METRIC_CACHE_MS = 60_000;
const REQUESTED_SCOPES = ['channel:read:subscriptions', 'moderator:read:chatters'] as const;

export type TwitchAuthState = 'not_configured' | 'disconnected' | 'authorizing' | 'connected' | 'reconnect_required';

export interface TwitchAuthStatus {
  state: TwitchAuthState;
  configured: boolean;
  connected: boolean;
  broadcaster: { userId: string; login: string; displayName: string } | null;
  activation: { verificationUri: string; userCode: string; expiresAt: string } | null;
  error: string | null;
}

interface PendingDeviceFlow {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAtMs: number;
  intervalMs: number;
}

interface DeviceStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string[] | string;
  scopes?: string[] | string;
  token_type: string;
}

interface ValidateResponse {
  client_id: string;
  login?: string;
  scopes?: string[];
  user_id?: string;
  expires_in: number;
}

interface TwitchUserResponse {
  data: Array<{ id: string; login: string; display_name: string }>;
}

interface TwitchStreamResponse {
  data: Array<{
    id: string;
    viewer_count: number;
    title: string;
    game_name: string;
    started_at: string;
  }>;
}

interface TotalResponse {
  total: number;
}

interface CachedChannelMetrics {
  fetchedAtMs: number;
  followers: number | null;
  paidSubscribers: number | null;
  chatters: number | null;
}

class TwitchHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function normalizeScopes(response: TokenResponse, fallback: string[] = []): string[] {
  const raw = response.scope ?? response.scopes ?? fallback;
  if (Array.isArray(raw)) return raw.filter((scope): scope is string => typeof scope === 'string');
  return typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : fallback;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown; error?: unknown; error_description?: unknown };
    for (const candidate of [body.message, body.error_description, body.error]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  } catch {
    // Ignore malformed/non-JSON provider errors.
  }
  return `Twitch HTTP ${response.status}`;
}

export class TwitchPlatformAdapter implements PlatformAdapter {
  readonly id = 'twitch' as const;
  readonly displayName = 'Twitch';

  private pending: PendingDeviceFlow | null = null;
  private authTimer: NodeJS.Timeout | null = null;
  private reconnectRequired = false;
  private authError: string | null = null;
  private lastValidatedAtMs = 0;
  private metricCache: CachedChannelMetrics | null = null;

  constructor(
    private readonly stateStore = new TwitchStateStore(),
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async initialize(): Promise<void> {
    if (!this.stateStore.getCredentials()) return;
    try {
      await this.ensureAuthorized(true);
    } catch (error) {
      this.requireReconnect(error instanceof Error ? error.message : 'Не удалось проверить Twitch авторизацию');
    }
  }

  getAuthStatus(): TwitchAuthStatus {
    const clientId = this.stateStore.getClientId();
    const credentials = this.stateStore.getCredentials();
    const activation = this.pending
      ? {
          verificationUri: this.pending.verificationUri,
          userCode: this.pending.userCode,
          expiresAt: new Date(this.pending.expiresAtMs).toISOString()
        }
      : null;

    let state: TwitchAuthState;
    if (!clientId) state = 'not_configured';
    else if (this.pending) state = 'authorizing';
    else if (this.reconnectRequired) state = 'reconnect_required';
    else if (credentials) state = 'connected';
    else state = 'disconnected';

    return {
      state,
      configured: Boolean(clientId),
      connected: state === 'connected',
      broadcaster: credentials
        ? { userId: credentials.userId, login: credentials.login, displayName: credentials.displayName }
        : null,
      activation,
      error: this.authError
    };
  }

  configureClientId(clientId: string): TwitchAuthStatus {
    const normalized = clientId.trim();
    if (!/^[a-z0-9]{10,80}$/i.test(normalized)) {
      throw new Error('Client ID Twitch выглядит некорректно');
    }

    const previous = this.stateStore.getClientId();
    if (previous && previous !== normalized) this.stateStore.clearCredentials();
    this.stateStore.setClientId(normalized);
    this.reconnectRequired = false;
    this.authError = null;
    this.stopDevicePolling();
    return this.getAuthStatus();
  }

  async beginDeviceFlow(): Promise<TwitchAuthStatus> {
    const clientId = this.requireClientId();
    this.stopDevicePolling();
    this.reconnectRequired = false;
    this.authError = null;

    const body = new URLSearchParams({
      client_id: clientId,
      scopes: REQUESTED_SCOPES.join(' ')
    });
    const response = await this.fetchFn(TWITCH_DEVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new TwitchHttpError(response.status, await responseMessage(response));

    const payload = await response.json() as DeviceStartResponse;
    if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
      throw new Error('Twitch вернул неполный Device Code ответ');
    }

    this.pending = {
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      expiresAtMs: Date.now() + Math.max(1, payload.expires_in) * 1000,
      intervalMs: Math.max(1, payload.interval) * 1000
    };
    this.scheduleDevicePoll(this.pending.intervalMs);
    return this.getAuthStatus();
  }

  disconnect(): TwitchAuthStatus {
    this.stopDevicePolling();
    this.stateStore.clearCredentials();
    this.reconnectRequired = false;
    this.authError = null;
    this.metricCache = null;
    this.lastValidatedAtMs = 0;
    return this.getAuthStatus();
  }

  async getSnapshot(): Promise<PlatformSnapshot> {
    const now = new Date().toISOString();
    const credentials = this.stateStore.getCredentials();
    if (!credentials || this.reconnectRequired) {
      return this.disconnectedSnapshot(now);
    }

    const token = await this.ensureAuthorized(false);
    const [stream, metrics] = await Promise.all([
      this.getStream(token, credentials.userId),
      this.getChannelMetrics(token, credentials.userId)
    ]);

    return {
      platformId: this.id,
      platformName: this.displayName,
      connected: true,
      health: 'ok',
      error: null,
      live: Boolean(stream),
      viewers: stream?.viewer_count ?? 0,
      followers: metrics.followers,
      paidSubscribers: metrics.paidSubscribers,
      chatters: metrics.chatters,
      reactions: null,
      views: null,
      streamTitle: stream?.title || null,
      category: stream?.game_name || null,
      startedAt: stream?.started_at || null,
      updatedAt: now
    };
  }

  private disconnectedSnapshot(now: string): PlatformSnapshot {
    return {
      platformId: this.id,
      platformName: this.displayName,
      connected: false,
      health: this.reconnectRequired ? 'error' : 'ok',
      error: this.reconnectRequired ? (this.authError ?? 'Требуется повторное подключение Twitch') : null,
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

  private async ensureAuthorized(forceValidation: boolean): Promise<string> {
    let credentials = this.stateStore.getCredentials();
    if (!credentials) throw new Error('Twitch не подключён');

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
    const response = await this.fetchFn(TWITCH_VALIDATE_URL, {
      headers: { Authorization: `OAuth ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (response.status === 401) return false;
    if (!response.ok) throw new TwitchHttpError(response.status, await responseMessage(response));
    const payload = await response.json() as ValidateResponse;
    const configuredClient = this.requireClientId();
    return payload.client_id === configuredClient && Boolean(payload.user_id);
  }

  private async refresh(previous: TwitchCredentials): Promise<TwitchCredentials> {
    const clientId = this.requireClientId();
    const response = await this.fetchFn(TWITCH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: previous.refreshToken,
        client_id: clientId
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
      const message = await responseMessage(response);
      this.requireReconnect(message);
      throw new TwitchHttpError(response.status, message);
    }

    const token = await response.json() as TokenResponse;
    const rotated: TwitchCredentials = {
      ...previous,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + Math.max(1, token.expires_in) * 1000).toISOString(),
      scopes: normalizeScopes(token, previous.scopes),
      updatedAt: new Date().toISOString()
    };
    this.stateStore.saveCredentials(rotated);
    this.lastValidatedAtMs = Date.now();
    return rotated;
  }

  private async helix<T>(path: string, accessToken: string, retry = true): Promise<T> {
    const clientId = this.requireClientId();
    const response = await this.fetchFn(`${TWITCH_API}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': clientId
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (response.status === 401 && retry) {
      const current = this.stateStore.getCredentials();
      if (!current) throw new TwitchHttpError(401, 'Twitch authorization missing');
      const refreshed = await this.refresh(current);
      return this.helix<T>(path, refreshed.accessToken, false);
    }
    if (!response.ok) throw new TwitchHttpError(response.status, await responseMessage(response));
    return response.json() as Promise<T>;
  }

  private async getStream(accessToken: string, userId: string) {
    const response = await this.helix<TwitchStreamResponse>(`/streams?user_id=${encodeURIComponent(userId)}`, accessToken);
    return response.data[0] ?? null;
  }

  private async getChannelMetrics(accessToken: string, userId: string): Promise<CachedChannelMetrics> {
    if (this.metricCache && Date.now() - this.metricCache.fetchedAtMs < METRIC_CACHE_MS) return this.metricCache;

    const [followers, paidSubscribers, chatters] = await Promise.all([
      this.optionalTotal(`/channels/followers?broadcaster_id=${encodeURIComponent(userId)}&first=1`, accessToken),
      this.optionalTotal(`/subscriptions?broadcaster_id=${encodeURIComponent(userId)}&first=1`, accessToken),
      this.optionalTotal(`/chat/chatters?broadcaster_id=${encodeURIComponent(userId)}&moderator_id=${encodeURIComponent(userId)}&first=1`, accessToken)
    ]);

    this.metricCache = { fetchedAtMs: Date.now(), followers, paidSubscribers, chatters };
    return this.metricCache;
  }

  private async optionalTotal(path: string, accessToken: string): Promise<number | null> {
    try {
      const response = await this.helix<TotalResponse>(path, accessToken);
      return Number.isFinite(response.total) ? response.total : null;
    } catch (error) {
      if (error instanceof TwitchHttpError && [400, 401, 403, 404].includes(error.status)) return null;
      throw error;
    }
  }

  private scheduleDevicePoll(delayMs: number): void {
    this.authTimer = setTimeout(() => void this.pollDeviceFlow(), delayMs);
    this.authTimer.unref();
  }

  private async pollDeviceFlow(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    if (Date.now() >= pending.expiresAtMs) {
      this.authError = 'Код подключения Twitch истёк. Запустите подключение ещё раз.';
      this.stopDevicePolling();
      return;
    }

    try {
      const response = await this.fetchFn(TWITCH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.requireClientId(),
          scopes: REQUESTED_SCOPES.join(' '),
          device_code: pending.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (!response.ok) {
        const message = await responseMessage(response);
        if (response.status === 400 && message.toLowerCase().includes('authorization_pending')) {
          this.scheduleDevicePoll(pending.intervalMs);
          return;
        }
        this.authError = message;
        this.stopDevicePolling();
        return;
      }

      const token = await response.json() as TokenResponse;
      await this.completeAuthorization(token);
      this.stopDevicePolling();
    } catch (error) {
      this.authError = error instanceof Error ? error.message : 'Ошибка подключения Twitch';
      this.scheduleDevicePoll(pending.intervalMs);
    }
  }

  private async completeAuthorization(token: TokenResponse): Promise<void> {
    const validation = await this.fetchFn(TWITCH_VALIDATE_URL, {
      headers: { Authorization: `OAuth ${token.access_token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!validation.ok) throw new TwitchHttpError(validation.status, await responseMessage(validation));
    const validated = await validation.json() as ValidateResponse;
    if (!validated.user_id || !validated.login) throw new Error('Twitch не вернул идентификатор пользователя');

    const userResponse = await this.fetchFn(`${TWITCH_API}/users?id=${encodeURIComponent(validated.user_id)}`, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Client-Id': this.requireClientId()
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!userResponse.ok) throw new TwitchHttpError(userResponse.status, await responseMessage(userResponse));
    const users = await userResponse.json() as TwitchUserResponse;
    const user = users.data[0];

    const credentials: TwitchCredentials = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + Math.max(1, token.expires_in) * 1000).toISOString(),
      userId: validated.user_id,
      login: validated.login,
      displayName: user?.display_name || validated.login,
      scopes: normalizeScopes(token, validated.scopes ?? []),
      updatedAt: new Date().toISOString()
    };

    this.stateStore.saveCredentials(credentials);
    this.reconnectRequired = false;
    this.authError = null;
    this.lastValidatedAtMs = Date.now();
    this.metricCache = null;
  }

  private requireReconnect(message: string): void {
    this.stateStore.clearCredentials();
    this.reconnectRequired = true;
    this.authError = message;
    this.metricCache = null;
    this.lastValidatedAtMs = 0;
  }

  private stopDevicePolling(): void {
    if (this.authTimer) clearTimeout(this.authTimer);
    this.authTimer = null;
    this.pending = null;
  }

  private requireClientId(): string {
    const clientId = this.stateStore.getClientId();
    if (!clientId) throw new Error('Сначала укажите Twitch Client ID');
    return clientId;
  }
}
