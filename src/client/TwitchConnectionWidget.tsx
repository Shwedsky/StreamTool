import { useEffect, useState } from 'react';

interface TwitchAuthStatus {
  state: 'not_configured' | 'disconnected' | 'authorizing' | 'connected' | 'reconnect_required';
  configured: boolean;
  connected: boolean;
  broadcaster: { userId: string; login: string; displayName: string } | null;
  activation: { verificationUri: string; userCode: string; expiresAt: string } | null;
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

function stateLabel(status: TwitchAuthStatus | null): string {
  if (!status) return 'Twitch…';
  if (status.state === 'connected') return `Twitch · ${status.broadcaster?.displayName ?? 'подключён'}`;
  if (status.state === 'authorizing') return 'Twitch · ждём подтверждение';
  if (status.state === 'reconnect_required') return 'Twitch · переподключить';
  if (status.state === 'not_configured') return 'Настроить Twitch';
  return 'Подключить Twitch';
}

export function TwitchConnectionWidget() {
  const [status, setStatus] = useState<TwitchAuthStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      setStatus(await api<TwitchAuthStatus>('/api/platforms/twitch/auth'));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось получить состояние Twitch');
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

  async function saveClientId(): Promise<void> {
    setBusy(true);
    setLocalError(null);
    try {
      const next = await api<TwitchAuthStatus>('/api/platforms/twitch/config', {
        method: 'POST',
        body: JSON.stringify({ clientId })
      });
      setStatus(next);
      setClientId('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось сохранить Client ID');
    } finally {
      setBusy(false);
    }
  }

  async function connect(): Promise<void> {
    setBusy(true);
    setLocalError(null);
    try {
      const next = await api<TwitchAuthStatus>('/api/platforms/twitch/connect', { method: 'POST', body: '{}' });
      setStatus(next);
      setExpanded(true);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось подключить Twitch');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true);
    setLocalError(null);
    try {
      const next = await api<TwitchAuthStatus>('/api/platforms/twitch/disconnect', { method: 'POST', body: '{}' });
      setStatus(next);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось отключить Twitch');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <aside className={`twitch-connect ${expanded ? 'twitch-connect--open' : ''}`}>
      <button type="button" className="twitch-connect__toggle" onClick={() => setExpanded((value) => !value)}>
        <span className={`twitch-connect__dot twitch-connect__dot--${status.state}`} />
        {stateLabel(status)}
      </button>

      {expanded && (
        <div className="twitch-connect__panel">
          <div className="twitch-connect__heading">
            <div><strong>Twitch</strong><small>Реальные данные канала</small></div>
            <button type="button" aria-label="Закрыть" onClick={() => setExpanded(false)}>×</button>
          </div>

          {status.state === 'not_configured' && (
            <div className="twitch-connect__section">
              <p>Для первого подключения нужен <b>Client ID</b> приложения Twitch. Это не пароль и не секрет.</p>
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="Twitch Client ID"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="twitch-connect__primary" disabled={busy || clientId.trim().length < 10} onClick={() => void saveClientId()}>
                Сохранить Client ID
              </button>
              <small className="twitch-connect__hint">Client Secret сюда вводить не нужно и приложение его не запрашивает.</small>
            </div>
          )}

          {(status.state === 'disconnected' || status.state === 'reconnect_required') && (
            <div className="twitch-connect__section">
              {status.state === 'reconnect_required' && <p className="twitch-connect__warning">Авторизация Twitch устарела или была отозвана. Подключите аккаунт заново.</p>}
              <button type="button" className="twitch-connect__primary" disabled={busy} onClick={() => void connect()}>
                Подключить Twitch
              </button>
              <small className="twitch-connect__hint">Откроется стандартная страница Twitch. Пароль StreamTool не видит.</small>
            </div>
          )}

          {status.state === 'authorizing' && status.activation && (
            <div className="twitch-connect__section twitch-connect__activation">
              <span>Код подключения</span>
              <strong>{status.activation.userCode}</strong>
              <button type="button" className="twitch-connect__primary" onClick={() => window.open(status.activation!.verificationUri, '_blank', 'noopener,noreferrer')}>
                Открыть Twitch
              </button>
              <small className="twitch-connect__hint">Если Twitch попросит код — введите тот, что показан выше. После подтверждения окно можно закрыть.</small>
            </div>
          )}

          {status.state === 'connected' && (
            <div className="twitch-connect__section">
              <p className="twitch-connect__connected">Подключён канал <b>{status.broadcaster?.displayName ?? status.broadcaster?.login}</b>.</p>
              <p>Online и статистика Twitch теперь берутся из реального API.</p>
              <button type="button" className="twitch-connect__secondary" disabled={busy} onClick={() => void disconnect()}>
                Отключить Twitch
              </button>
            </div>
          )}

          {(localError || status.error) && <p className="twitch-connect__error">{localError ?? status.error}</p>}
        </div>
      )}
    </aside>
  );
}
