import { useEffect, useMemo, useState } from 'react';
import type { AppSnapshot, PlatformSnapshot } from '../shared/domain';

const numberFormatter = new Intl.NumberFormat('ru-RU');

function formatNumber(value: number | null): string {
  return value == null ? '—' : numberFormatter.format(value);
}

function formatDuration(startedAt: string | null, now: string): string {
  if (!startedAt) return '—';
  const seconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const rest = (seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${rest}`;
}

function formatUpdatedAt(value: string): string {
  return new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function useLiveSnapshot() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/snapshot', { cache: 'no-store' })
      .then((response) => response.json() as Promise<AppSnapshot>)
      .then((value) => {
        if (!cancelled) setSnapshot(value);
      })
      .catch(() => undefined);

    const events = new EventSource('/api/events');
    events.addEventListener('snapshot', (event) => {
      setSnapshot(JSON.parse((event as MessageEvent<string>).data) as AppSnapshot);
      setConnected(true);
    });
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);

    return () => {
      cancelled = true;
      events.close();
    };
  }, []);

  return { snapshot, connected };
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

function PlatformCard({ platform, now }: { platform: PlatformSnapshot; now: string }) {
  return (
    <article className="platform-card">
      <div className="platform-card__top">
        <div>
          <p className="platform-name">{platform.platformName}</p>
          <div className="platform-online">
            <strong>{formatNumber(platform.viewers)}</strong>
            <span>Зрители Online</span>
          </div>
        </div>
        <div className={`live-pill ${platform.health === 'error' ? 'live-pill--error' : ''}`}>
          <i /> {platform.health === 'error' ? 'ERROR' : platform.live ? 'LIVE' : 'OFFLINE'}
        </div>
      </div>

      <div className="metric-sections">
        {(platform.followers != null || platform.paidSubscribers != null) && (
          <section className="metric-section">
            <p>Канал</p>
            <div className="metric-row">
              {platform.followers != null && <div><span>Подписчики</span><strong>{formatNumber(platform.followers)}</strong></div>}
              {platform.paidSubscribers != null && <div><span>Платные подписки</span><strong>{formatNumber(platform.paidSubscribers)}</strong></div>}
            </div>
          </section>
        )}

        {(platform.chatters != null || platform.reactions != null || platform.views != null) && (
          <section className="metric-section">
            <p>Текущий стрим</p>
            <div className="metric-row metric-row--three">
              {platform.chatters != null && <div><span>В чате</span><strong>{formatNumber(platform.chatters)}</strong></div>}
              {platform.reactions != null && <div><span>Реакции</span><strong>{formatNumber(platform.reactions)}</strong></div>}
              {platform.views != null && <div><span>Просмотры</span><strong>{formatNumber(platform.views)}</strong></div>}
            </div>
          </section>
        )}
      </div>

      <div className="stream-meta">
        <span>Длительность стрима</span>
        <strong>{formatDuration(platform.startedAt, now)}</strong>
      </div>
      {platform.error && <p className="error-text">Последние данные сохранены · {platform.error}</p>}
    </article>
  );
}

function Dashboard({ snapshot, connected }: { snapshot: AppSnapshot; connected: boolean }) {
  return (
    <main className="shell">
      <header className="header">
        <div className="brand"><BrandMark /><div><strong>StreamToolByShwedsky</strong><small>Панель мультистрима</small></div></div>
        <div className="header-status"><i className={connected ? 'status-dot' : 'status-dot status-dot--down'} />{connected ? 'данные подключены' : 'переподключение'}<span>DEMO</span></div>
      </header>

      <section className="hero">
        <p className="eyebrow">Суммарный онлайн</p>
        <div className="hero-number"><span className="eye">◉</span>{formatNumber(snapshot.totalViewers)}</div>
        <div className="hero-meta">
          <div><span>Макс. зрителей</span><strong>{formatNumber(snapshot.peakViewers)}</strong></div>
          <div><span>Площадки</span><strong>{snapshot.platforms.filter((p) => p.live).length} LIVE</strong></div>
          <div><span>Последнее обновление</span><strong>{formatUpdatedAt(snapshot.generatedAt)}</strong></div>
        </div>
      </section>

      <section className="platforms">
        {snapshot.platforms.map((platform) => <PlatformCard key={platform.platformId} platform={platform} now={snapshot.generatedAt} />)}
      </section>

      <section className="analytics-preview">
        <div>
          <p className="eyebrow">Аналитика</p>
          <h3>История стрима сохраняется</h3>
          <p>Следующий этап: график Total / VK / Twitch, средний онлайн, изменения за 1 / 5 / 15 / 30 минут и итоговый отчёт.</p>
        </div>
        <div className="pulse-bars" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>
      </section>
    </main>
  );
}

function Compact({ snapshot, connected }: { snapshot: AppSnapshot; connected: boolean }) {
  const live = snapshot.platforms.filter((platform) => platform.live);
  return (
    <main className="compact">
      <div className="compact-brand"><BrandMark /><strong>StreamToolByShwedsky</strong></div>
      <div className="compact-top"><span><i className={connected ? 'status-dot' : 'status-dot status-dot--down'} /> LIVE</span><strong>{live[0] ? formatDuration(live[0].startedAt, snapshot.generatedAt) : '—'}</strong></div>
      <div className="compact-total"><small>СУММАРНЫЙ ОНЛАЙН</small><strong>◉ {formatNumber(snapshot.totalViewers)}</strong><span>Макс. зрителей {formatNumber(snapshot.peakViewers)}</span></div>
      <div className="compact-platforms">
        {snapshot.platforms.map((platform) => <div key={platform.platformId}><span>{platform.platformName}</span><strong>{formatNumber(platform.viewers)}</strong><small>Зрители Online</small></div>)}
      </div>
      <div className="compact-foot">Обновлено {formatUpdatedAt(snapshot.generatedAt)} · demo</div>
    </main>
  );
}

export function App() {
  const { snapshot, connected } = useLiveSnapshot();
  const compact = useMemo(() => window.location.pathname === '/compact', []);

  useEffect(() => {
    document.title = compact ? 'StreamToolByShwedsky · Compact' : 'StreamToolByShwedsky';
  }, [compact]);

  if (!snapshot) {
    return <main className="loading"><BrandMark /><p>Подключаем StreamToolByShwedsky…</p></main>;
  }

  return compact
    ? <Compact snapshot={snapshot} connected={connected} />
    : <Dashboard snapshot={snapshot} connected={connected} />;
}
