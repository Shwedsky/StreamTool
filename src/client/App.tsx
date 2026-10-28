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

function PlatformCard({ platform, now }: { platform: PlatformSnapshot; now: string }) {
  const isTwitch = platform.platformId === 'twitch';
  return (
    <article className="platform-card">
      <div className="platform-card__top">
        <div>
          <p className="eyebrow">{platform.platformName}</p>
          <h2>{formatNumber(platform.viewers)} <span>сейчас</span></h2>
        </div>
        <div className={`live-pill ${platform.health === 'error' ? 'live-pill--error' : ''}`}>
          <i /> {platform.health === 'error' ? 'ERROR' : platform.live ? 'LIVE' : 'OFFLINE'}
        </div>
      </div>

      <div className="metric-grid">
        <div><span>Зрители</span><strong>{formatNumber(platform.viewers)}</strong></div>
        <div><span>{isTwitch ? 'Followers' : 'Подписчики'}</span><strong>{formatNumber(platform.followers)}</strong></div>
        {platform.paidSubscribers != null && <div><span>Paid subs</span><strong>{formatNumber(platform.paidSubscribers)}</strong></div>}
        {platform.chatters != null && <div><span>В чате</span><strong>{formatNumber(platform.chatters)}</strong></div>}
        {platform.reactions != null && <div><span>Реакции</span><strong>{formatNumber(platform.reactions)}</strong></div>}
        {platform.views != null && <div><span>Просмотры</span><strong>{formatNumber(platform.views)}</strong></div>}
      </div>

      <div className="stream-meta">
        <span>{platform.category ?? 'Без категории'}</span>
        <span>{formatDuration(platform.startedAt, now)}</span>
      </div>
      {platform.error && <p className="error-text">Последние данные сохранены · {platform.error}</p>}
    </article>
  );
}

function Dashboard({ snapshot, connected }: { snapshot: AppSnapshot; connected: boolean }) {
  return (
    <main className="shell">
      <header className="header">
        <div className="brand"><span className="brand-mark">S</span><div><strong>StreamTool</strong><small>Multistream cockpit</small></div></div>
        <div className="header-status"><i className={connected ? 'status-dot' : 'status-dot status-dot--down'} />{connected ? 'live data' : 'reconnecting'}<span>DEMO</span></div>
      </header>

      <section className="hero">
        <p className="eyebrow">Суммарный онлайн</p>
        <div className="hero-number"><span className="eye">◉</span>{formatNumber(snapshot.totalViewers)}</div>
        <div className="hero-meta">
          <div><span>Peak с запуска</span><strong>{formatNumber(snapshot.peakViewers)}</strong></div>
          <div><span>Площадки</span><strong>{snapshot.platforms.filter((p) => p.live).length} live</strong></div>
          <div><span>Обновление</span><strong>15 сек</strong></div>
        </div>
      </section>

      <section className="platforms">
        {snapshot.platforms.map((platform) => <PlatformCard key={platform.platformId} platform={platform} now={snapshot.generatedAt} />)}
      </section>

      <section className="analytics-preview">
        <div>
          <p className="eyebrow">Analytics pipeline</p>
          <h3>История уже сохраняется в SQLite</h3>
          <p>В Phase 1 здесь появятся Total / VK / Twitch графики, средний онлайн, Δ 1/5/15/30 мин, маркеры роста и полноценный отчёт по стриму.</p>
        </div>
        <div className="pulse-bars" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>
      </section>

      <footer>Данные demo-адаптеров · {new Date(snapshot.generatedAt).toLocaleTimeString('ru-RU')}</footer>
    </main>
  );
}

function Compact({ snapshot, connected }: { snapshot: AppSnapshot; connected: boolean }) {
  const live = snapshot.platforms.filter((platform) => platform.live);
  return (
    <main className="compact">
      <div className="compact-top"><span><i className={connected ? 'status-dot' : 'status-dot status-dot--down'} /> LIVE</span><strong>{live[0] ? formatDuration(live[0].startedAt, snapshot.generatedAt) : '—'}</strong></div>
      <div className="compact-total"><small>СУММАРНЫЙ ОНЛАЙН</small><strong>◉ {formatNumber(snapshot.totalViewers)}</strong><span>Peak {formatNumber(snapshot.peakViewers)}</span></div>
      <div className="compact-platforms">
        {snapshot.platforms.map((platform) => <div key={platform.platformId}><span>{platform.platformName}</span><strong>{formatNumber(platform.viewers)}</strong></div>)}
      </div>
      <div className="compact-foot">обновление 15 сек · demo</div>
    </main>
  );
}

export function App() {
  const { snapshot, connected } = useLiveSnapshot();
  const compact = useMemo(() => window.location.pathname === '/compact', []);

  useEffect(() => {
    document.title = compact ? 'StreamTool · Compact' : 'StreamTool';
  }, [compact]);

  if (!snapshot) {
    return <main className="loading"><span className="brand-mark">S</span><p>Подключаем StreamTool…</p></main>;
  }

  return compact
    ? <Compact snapshot={snapshot} connected={connected} />
    : <Dashboard snapshot={snapshot} connected={connected} />;
}
