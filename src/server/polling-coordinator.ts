import type { AppSnapshot, PlatformAdapter, PlatformSnapshot, StreamAnalytics } from '../shared/domain.js';
import { calculateAnalytics } from './analytics.js';
import type { SnapshotStore } from './storage.js';
import type { SseBroker } from './sse-broker.js';

const LIVE_INTERVAL_MS = 15_000;
const OFFLINE_INTERVAL_MS = 60_000;

function emptyAnalytics(): StreamAnalytics {
  return {
    sessionId: null,
    streamStartedAt: null,
    observedSince: null,
    sampleCount: 0,
    averageViewers: null,
    peakViewers: 0,
    peakAt: null,
    deltas: {
      oneMinute: null,
      fiveMinutes: null,
      fifteenMinutes: null,
      thirtyMinutes: null
    },
    audienceShare: [],
    bestGrowth: null,
    history: []
  };
}

function earliestLiveStart(platforms: PlatformSnapshot[], fallback: string): string {
  const starts = platforms
    .filter((platform) => platform.live && platform.startedAt)
    .map((platform) => platform.startedAt as string)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return starts[0] ?? fallback;
}

export class PollingCoordinator {
  private timer: NodeJS.Timeout | null = null;
  private currentSessionId: string | null = null;
  private currentStreamStartedAt: string | null = null;
  private readonly lastGoodByPlatform = new Map<string, PlatformSnapshot>();
  private latest: AppSnapshot = {
    generatedAt: new Date(0).toISOString(),
    totalViewers: 0,
    peakViewers: 0,
    platforms: [],
    analytics: emptyAnalytics()
  };

  constructor(
    private readonly adapters: PlatformAdapter[],
    private readonly store: SnapshotStore,
    private readonly broker: SseBroker
  ) {}

  async start(): Promise<void> {
    await this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getLatest(): AppSnapshot {
    return this.latest;
  }

  private resolveLiveSession(platforms: PlatformSnapshot[], now: string): void {
    const streamStartedAt = earliestLiveStart(platforms, now);
    if (this.currentSessionId && this.currentStreamStartedAt === streamStartedAt) return;

    if (this.currentSessionId) {
      this.store.closeSession(this.currentSessionId, now);
    }

    this.store.closeOpenSessionsExcept(streamStartedAt, now);
    const existing = this.store.findOpenSession(streamStartedAt);
    const sessionId = existing?.id ?? `session-${Date.parse(streamStartedAt)}-${Date.now()}`;
    this.store.ensureSession(sessionId, streamStartedAt, now);
    this.currentSessionId = sessionId;
    this.currentStreamStartedAt = streamStartedAt;
  }

  private async tick(): Promise<void> {
    const platforms = await Promise.all(this.adapters.map((adapter) => this.readAdapter(adapter)));
    const generatedAt = new Date().toISOString();
    const anyLive = platforms.some((platform) => platform.live);

    if (anyLive) this.resolveLiveSession(platforms, generatedAt);

    const sessionIdForSnapshot = this.currentSessionId;
    const streamStartedAtForSnapshot = this.currentStreamStartedAt;
    const totalViewers = platforms.reduce(
      (sum, platform) => sum + (platform.live ? platform.viewers ?? 0 : 0),
      0
    );

    const baseSnapshot: AppSnapshot = {
      generatedAt,
      totalViewers,
      peakViewers: this.latest.peakViewers,
      platforms,
      analytics: emptyAnalytics()
    };

    this.store.save(baseSnapshot, sessionIdForSnapshot);

    const rows = sessionIdForSnapshot
      ? this.store.loadSessionViewerRows(sessionIdForSnapshot)
      : [];
    const analytics = calculateAnalytics(
      sessionIdForSnapshot,
      streamStartedAtForSnapshot,
      platforms,
      rows
    );

    this.latest = {
      ...baseSnapshot,
      peakViewers: analytics.peakViewers,
      analytics
    };

    this.broker.broadcast(this.latest);

    if (!anyLive && this.currentSessionId) {
      this.store.closeSession(this.currentSessionId, generatedAt);
      this.currentSessionId = null;
      this.currentStreamStartedAt = null;
    }

    this.timer = setTimeout(
      () => void this.tick(),
      anyLive ? LIVE_INTERVAL_MS : OFFLINE_INTERVAL_MS
    );
    this.timer.unref();
  }

  private async readAdapter(adapter: PlatformAdapter): Promise<PlatformSnapshot> {
    try {
      const snapshot = await adapter.getSnapshot();
      this.lastGoodByPlatform.set(adapter.id, snapshot);
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown adapter error';
      const lastGood = this.lastGoodByPlatform.get(adapter.id);

      if (lastGood) {
        return {
          ...lastGood,
          health: 'error',
          error: message,
          updatedAt: new Date().toISOString()
        };
      }

      return {
        platformId: adapter.id,
        platformName: adapter.displayName,
        connected: true,
        health: 'error',
        error: message,
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
        updatedAt: new Date().toISOString()
      };
    }
  }
}
