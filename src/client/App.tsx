import { useEffect, useMemo, useState } from 'react';
import type { AppSnapshot, HistoryPoint, PlatformSnapshot, StreamAnalytics } from '../shared/domain';

const numberFormatter = new Intl.NumberFormat('ru-RU');

interface SessionInfo {
  id: string;
  streamStartedAt: string;
  observedAt: string;
  endedAt: string | null;
}

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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDelta(value: number | null): string {
  if (value == null) return '—';
  if (value > 0) return `+${numberFormatter.format(value)}`;
  return numberFormatter.format(value);
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

function PlatformCard({
  platform,
  now,
  sharePercent
}: {
  platform: PlatformSnapshot;
  now: string;
  sharePercent: number | null;
}) {
  return (
    <article className="platform-card">
      <div className="platform-card__top">
        <div>
          <p className="platform-name">{platform.platformName}</p>
          <div className="platform-online">
            <strong>{formatNumber(platform.viewers)}</strong>
            <div><span>Зрители Online</span>{sharePercent != null && <small>{sharePercent}% общего онлайна</small>}</div>
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

function chartPath(history: HistoryPoint[], selector: (point: HistoryPoint) => number): string {
  if (!history.length) return '';
  const width = 1000;
  const height = 142;
  const maxValue = Math.max(1, ...history.flatMap((point) => [
    point.totalViewers,
    ...Object.values(point.viewersByPlatform)
  ]));

  return history.map((point, index) => {
    const x = history.length === 1 ? width / 2 : (index / (history.length - 1)) * width;
    const y = height - (selector(point) / maxValue) * (height - 10) + 5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function ViewerChart({ history, emptyText = 'Собираем первые точки графика…' }: { history: HistoryPoint[]; emptyText?: string }) {
  const totalPath = chartPath(history, (point) => point.totalViewers);
  const vkPath = chartPath(history, (point) => point.viewersByPlatform['vk-live'] ?? 0);
  const twitchPath = chartPath(history, (point) => point.viewersByPlatform.twitch ?? 0);
  const firstTime = history[0]?.capturedAt;
  const lastTime = history.at(-1)?.capturedAt;

  if (history.length < 2) return <div className="chart-empty">{emptyText}</div>;

  return (
    <>
      <svg className="viewer-chart" viewBox="0 0 1000 142" preserveAspectRatio="none" role="img" aria-label="График зрителей стрима">
        <line x1="0" y1="35.5" x2="1000" y2="35.5" className="chart-grid" />
        <line x1="0" y1="71" x2="1000" y2="71" className="chart-grid" />
        <line x1="0" y1="106.5" x2="1000" y2="106.5" className="chart-grid" />
        <polyline points={vkPath} className="chart-line chart-line--vk" />
        <polyline points={twitchPath} className="chart-line chart-line--twitch" />
        <polyline points={totalPath} className="chart-line chart-line--total" />
      </svg>
      <div className="chart-time"><span>{firstTime ? formatUpdatedAt(firstTime) : '—'}</span><span>{lastTime ? formatUpdatedAt(lastTime) : '—'}</span></div>
    </>
  );
}

function ChartLegend() {
  return (
    <div className="chart-legend">
      <span className="legend-total"><i />Всего</span>
      <span className="legend-vk"><i />VK</span>
      <span className="legend-twitch"><i />Twitch</span>
    </div>
  );
}

function AnalyticsPanel({ snapshot }: { snapshot: AppSnapshot }) {
  const { analytics } = snapshot;
  const deltaItems = [
    ['1 мин', analytics.deltas.oneMinute],
    ['5 мин', analytics.deltas.fiveMinutes],
    ['15 мин', analytics.deltas.fifteenMinutes],
    ['30 мин', analytics.deltas.thirtyMinutes]
  ] as const;

  return (
    <section className="analytics-panel">
      <div className="analytics-summary">
        <div className="analytics-title"><p className="eyebrow">Динамика стрима</p><ChartLegend /></div>
        <div className="analytics-kpis">
          <div><span>Средний за наблюдение</span><strong>{formatNumber(analytics.averageViewers)}</strong></div>
          <div><span>Пик</span><strong>{formatNumber(analytics.peakViewers)}</strong><small>{analytics.peakAt ? formatUpdatedAt(analytics.peakAt) : '—'}</small></div>
          <div><span>Лучший рост</span><strong>{analytics.bestGrowth ? formatDelta(analytics.bestGrowth.delta) : '—'}</strong><small>{analytics.bestGrowth ? `за ${analytics.bestGrowth.minutes} мин` : 'собираем данные'}</small></div>
        </div>
        <div className="delta-strip">
          {deltaItems.map(([label, value]) => (
            <div key={label} className={value == null ? '' : value > 0 ? 'delta-up' : value < 0 ? 'delta-down' : ''}>
              <span>{label}</span><strong>{formatDelta(value)}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-wrap"><ViewerChart history={analytics.history} /></div>
    </section>
  );
}

function Dashboard({ snapshot, connected }: { snapshot: AppSnapshot; connected: boolean }) {
  const shareByPlatform = new Map(snapshot.analytics.audienceShare.map((share) => [share.platformId, share.percent]));

  return (
    <main className="shell">
      <header className="header">
        <div className="brand"><BrandMark /><div><strong>StreamToolByShwedsky</strong><small>Панель мультистрима</small></div></div>
        <div className="header-actions"><a href="/reports">Отчёты</a><div className="header-status"><i className={connected ? 'status-dot' : 'status-dot status-dot--down'} />{connected ? 'данные подключены' : 'переподключение'}<span>DEMO</span></div></div>
      </header>

      <section className="hero">
        <p className="eyebrow">Суммарный онлайн</p>
        <div className="hero-number"><span className="eye">◉</span>{formatNumber(snapshot.totalViewers)}</div>
        <div className="hero-meta">
          <div><span>Макс. зрителей</span><strong>{formatNumber(snapshot.analytics.peakViewers)}</strong></div>
          <div><span>Средний онлайн</span><strong>{formatNumber(snapshot.analytics.averageViewers)}</strong></div>
          <div><span>Последнее обновление</span><strong>{formatUpdatedAt(snapshot.generatedAt)}</strong></div>
        </div>
      </section>

      <section className="platforms">
        {snapshot.platforms.map((platform) => (
          <PlatformCard key={platform.platformId} platform={platform} now={snapshot.generatedAt} sharePercent={shareByPlatform.get(platform.platformId) ?? null} />
        ))}
      </section>

      <AnalyticsPanel snapshot={snapshot} />
    </main>
  );
}

function Compact({ snapshot, connected }: { snapshot: AppSnapshot; connected: boolean }) {
  const live = snapshot.platforms.filter((platform) => platform.live);
  return (
    <main className="compact">
      <div className="compact-brand"><BrandMark /><strong>StreamToolByShwedsky</strong></div>
      <div className="compact-top"><span><i className={connected ? 'status-dot' : 'status-dot status-dot--down'} /> LIVE</span><strong>{live[0] ? formatDuration(live[0].startedAt, snapshot.generatedAt) : '—'}</strong></div>
      <div className="compact-total"><small>СУММАРНЫЙ ОНЛАЙН</small><strong>◉ {formatNumber(snapshot.totalViewers)}</strong><span>Макс. {formatNumber(snapshot.analytics.peakViewers)} · Средний {formatNumber(snapshot.analytics.averageViewers)}</span></div>
      <div className="compact-platforms">
        {snapshot.platforms.map((platform) => <div key={platform.platformId}><span>{platform.platformName}</span><strong>{formatNumber(platform.viewers)}</strong><small>Зрители Online</small></div>)}
      </div>
      <div className="compact-deltas"><span>Δ 5 мин</span><strong>{formatDelta(snapshot.analytics.deltas.fiveMinutes)}</strong><span>Δ 15 мин</span><strong>{formatDelta(snapshot.analytics.deltas.fifteenMinutes)}</strong></div>
      <div className="compact-foot">Обновлено {formatUpdatedAt(snapshot.generatedAt)} · demo</div>
    </main>
  );
}

function Reports() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<StreamAnalytics | null>(null);

  useEffect(() => {
    fetch('/api/sessions', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ sessions: SessionInfo[] }>)
      .then(({ sessions: values }) => {
        setSessions(values);
        setSelectedId((current) => current ?? values[0]?.id ?? null);
      })
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setAnalytics(null);
      return;
    }
    fetch(`/api/sessions/${encodeURIComponent(selectedId)}`, { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ analytics: StreamAnalytics }>)
      .then((value) => setAnalytics(value.analytics))
      .catch(() => setAnalytics(null));
  }, [selectedId]);

  const selected = sessions.find((session) => session.id === selectedId) ?? null;

  return (
    <main className="reports-shell">
      <header className="reports-header">
        <div className="brand"><BrandMark /><div><strong>StreamToolByShwedsky</strong><small>Отчёты по стримам</small></div></div>
        <a href="/">← Онлайн-панель</a>
      </header>
      <div className="reports-layout">
        <aside className="session-list">
          <h1>Сессии</h1>
          {sessions.length === 0 && <p className="reports-muted">Сессий пока нет.</p>}
          {sessions.map((session) => (
            <button key={session.id} type="button" className={session.id === selectedId ? 'session-item session-item--active' : 'session-item'} onClick={() => setSelectedId(session.id)}>
              <strong>{formatDateTime(session.observedAt)}</strong>
              <span>{session.endedAt ? 'Завершён' : 'Сейчас идёт'}</span>
            </button>
          ))}
        </aside>
        <section className="report-card">
          {!selected || !analytics ? (
            <div className="report-empty">Выберите сессию для просмотра отчёта.</div>
          ) : (
            <>
              <div className="report-top">
                <div><p className="eyebrow">{selected.endedAt ? 'Завершённый стрим' : 'Текущий стрим'}</p><h2>{formatDateTime(selected.streamStartedAt)}</h2><p className="reports-muted">Наблюдение с {formatDateTime(selected.observedAt)}{selected.endedAt ? ` до ${formatDateTime(selected.endedAt)}` : ''}</p></div>
                <ChartLegend />
              </div>
              <div className="report-kpis">
                <div><span>Средний онлайн</span><strong>{formatNumber(analytics.averageViewers)}</strong></div>
                <div><span>Макс. зрителей</span><strong>{formatNumber(analytics.peakViewers)}</strong><small>{analytics.peakAt ? formatUpdatedAt(analytics.peakAt) : '—'}</small></div>
                <div><span>Лучший рост</span><strong>{analytics.bestGrowth ? formatDelta(analytics.bestGrowth.delta) : '—'}</strong><small>{analytics.bestGrowth ? `за ${analytics.bestGrowth.minutes} мин` : '—'}</small></div>
                <div><span>Точек данных</span><strong>{formatNumber(analytics.sampleCount)}</strong></div>
              </div>
              <div className="report-chart"><ViewerChart history={analytics.history} emptyText="Недостаточно точек для графика." /></div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export function App() {
  const { snapshot, connected } = useLiveSnapshot();
  const path = useMemo(() => window.location.pathname, []);
  const compact = path === '/compact';
  const reports = path === '/reports';

  useEffect(() => {
    document.title = reports
      ? 'StreamToolByShwedsky · Отчёты'
      : compact
        ? 'StreamToolByShwedsky · Compact'
        : 'StreamToolByShwedsky';
  }, [compact, reports]);

  if (reports) return <Reports />;

  if (!snapshot) {
    return <main className="loading"><BrandMark /><p>Подключаем StreamToolByShwedsky…</p></main>;
  }

  return compact
    ? <Compact snapshot={snapshot} connected={connected} />
    : <Dashboard snapshot={snapshot} connected={connected} />;
}
