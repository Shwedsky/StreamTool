import type { AppSnapshot, PlatformAdapter, PlatformSnapshot } from '../shared/domain.js';
import type { SnapshotStore } from './storage.js';
import type { SseBroker } from './sse-broker.js';

const LIVE_INTERVAL_MS = 15_000;
const OFFLINE_INTERVAL_MS = 60_000;

export class PollingCoordinator {
  private timer: NodeJS.Timeout | null = null;
  private peakViewers = 0;
  private readonly lastGoodByPlatform = new Map<string, PlatformSnapshot>();
  private latest: AppSnapshot = {
    generatedAt: new Date(0).toISOString(),
    totalViewers: 0,
    peakViewers: 0,
    platforms: []
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

  private async tick(): Promise<void> {
    const platforms = await Promise.all(this.adapters.map((adapter) => this.readAdapter(adapter)));
    const totalViewers = platforms.reduce(
      (sum, platform) => sum + (platform.live ? platform.viewers ?? 0 : 0),
      0
    );

    this.peakViewers = Math.max(this.peakViewers, totalViewers);
    this.latest = {
      generatedAt: new Date().toISOString(),
      totalViewers,
      peakViewers: this.peakViewers,
      platforms
    };

    this.store.save(this.latest);
    this.broker.broadcast(this.latest);

    const anyLive = platforms.some((platform) => platform.live);
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
