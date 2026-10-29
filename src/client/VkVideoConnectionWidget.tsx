import { useEffect, useState } from 'react';

interface VkVideoAuthStatus {
  state: 'not_configured' | 'disconnected' | 'authorizing' | 'connected' | 'reconnect_required';
  configured: boolean;
  connected: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  redirectUri: string;
  broadcaster: { displayName: string | null; channelUrl: string | null } | null;
  authorizationUrl: string | null;
  error: string | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    cache: 'no-store'
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function stateLabel(status: VkVideoAuthStatus | null): string {
  if (!status) return 'VK…';
  if (status.state === 'connected') return `VK · ${status.broadcaster?.displayName ?? 'подключён'}`;
  if (status.state === 'authorizing') return 'VK · ждём подтверждение';
  if (status.state === 'reconnect_required') return 'VK · переподключить';
  if (status.state === 'not_configured') return 'Настроить VK';
  return 'Подключить VK';
}

export function VkVideoConnectionWidget() {
  const [status, setStatus] = useState<VkVideoAuthStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      setStatus(await api<VkVideoAuthStatus>('/api/platforms/vk-live/auth'));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось получить состояние VK Video Live');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!status) return;
    const interval = window.setInterval(() => void refresh(), status.state === 'authorizing' ? 1500 : 10_000);
    return () => window.clearInterval(interval);
  }, [status?.state]);

  async function saveConfig(): Promise<void> {
    setBusy(true);
    setLocalError(null);
    try {
      const next = await api<VkVideoAuthStatus>('/api/platforms/vk-live/config', {
        method: 'POST',
        body: JSON.stringify({ clientId, clientSecret })
      });
      setStatus(next);
      setClientId('');
      setClientSecret('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось сохранить настройки VK Video Live');
    } finally {
      setBusy(false);
    }
  }

  async function connect(): Promise<void> {
    setBusy(true);
    setLocalError(null);
    try {
      const next = await api<VkVideoAuthStatus>('/api/platforms/vk-live/connect', { method: 'POST', body: '{}' });
      setStatus(next);
      setExpanded(true);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось начать подключение VK Video Live');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true);
    setLocalError(null);
    try {
      const next = await api<VkVideoAuthStatus>('/api/platforms/vk-live/disconnect', { method: 'POST', body: '{}' });
      setStatus(next);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось отключить VK Video Live');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <aside className={`twitch-connect vk-connect ${expanded ? 'twitch-connect--open' : ''}`}>
      <button type="button" className="twitch-connect__toggle" onClick={() => setExpanded((value) => !value)}>
        <span className={`twitch-connect__dot twitch-connect__dot--${status.state}`} />
        {stateLabel(status)}
      </button>

      {expanded && (
        <div className="twitch-connect__panel">
          <div className="twitch-connect__heading">
            <div><strong>VK Видео Live</strong><small>Реальные данные канала</small></div>
            <button type="button" aria-label="Закрыть" onClick={() => setExpanded(false)}>×</button>
          </div>

          {status.state === 'not_configured' && (
            <div className="twitch-connect__section">
              <p>Создайте приложение в кабинете разработчика VK Video Live и добавьте этот Redirect URI:</p>
              <code className="vk-connect__redirect">{status.redirectUri}</code>
              <p>После этого введите <b>Client ID</b> и <b>Client Secret</b>. Secret сохраняется только локально на этом компьютере и не отправляется в браузер после сохранения.</p>
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="VK Video Live Client ID"
                autoComplete="off"
                spellCheck={false}
              />
              <input
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder="VK Video Live Client Secret"
                autoComplete="new-password"
                spellCheck={false}
              />
              <button type="button" className="twitch-connect__primary" disabled={busy || clientId.trim().length < 3 || clientSecret.trim().length < 8} onClick={() => void saveConfig()}>
                Сохранить настройки VK
              </button>
              <small className="twitch-connect__hint">Client Secret не присылайте в чат и не коммитьте в Git.</small>
            </div>
          )}

          {(status.state === 'disconnected' || status.state === 'reconnect_required') && (
            <div className="twitch-connect__section">
              {status.state === 'reconnect_required' && <p className="twitch-connect__warning">Авторизация VK устарела или была отозвана. Подключите аккаунт заново.</p>}
              <button type="button" className="twitch-connect__primary" disabled={busy} onClick={() => void connect()}>
                Подключить VK
              </button>
              <small className="twitch-connect__hint">StreamTool запустит локальный OAuth callback на адресе, указанном при регистрации приложения.</small>
            </div>
          )}

          {status.state === 'authorizing' && status.authorizationUrl && (
            <div className="twitch-connect__section twitch-connect__activation">
              <p>Откройте официальную страницу VK Video Live и разрешите доступ. После подтверждения вкладка вернётся в StreamTool автоматически.</p>
              <button type="button" className="twitch-connect__primary" onClick={() => window.open(status.authorizationUrl!, '_blank', 'noopener,noreferrer')}>
                Открыть VK
              </button>
            </div>
          )}

          {status.state === 'connected' && (
            <div className="twitch-connect__section">
              <p className="twitch-connect__connected">Подключён канал <b>{status.broadcaster?.displayName ?? status.broadcaster?.channelUrl ?? 'VK Video Live'}</b>.</p>
              <p>Online, подписчики, просмотры и реакции VK теперь берутся из реального API.</p>
              <button type="button" className="twitch-connect__secondary" disabled={busy} onClick={() => void disconnect()}>
                Отключить VK
              </button>
            </div>
          )}

          {(localError || status.error) && <p className="twitch-connect__error">{localError ?? status.error}</p>}
        </div>
      )}
    </aside>
  );
}
