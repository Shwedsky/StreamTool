import type { PlatformAdapter, PlatformId, PlatformSnapshot } from '../shared/domain.js';

export interface DemoAdapterConfig {
  id: PlatformId;
  displayName: string;
  baseViewers: number;
  baseFollowers: number;
  paidSubscribers?: number | null;
  baseChatters?: number | null;
  baseReactions?: number | null;
  baseViews?: number | null;
  phase: number;
  title: string;
  category: string;
}

export class DemoPlatformAdapter implements PlatformAdapter {
  readonly id: PlatformId;
  readonly displayName: string;
  private readonly startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  private readonly createdAt = Date.now();

  constructor(private readonly config: DemoAdapterConfig) {
    this.id = config.id;
    this.displayName = config.displayName;
  }

  async getSnapshot(): Promise<PlatformSnapshot> {
    const elapsedSeconds = (Date.now() - this.createdAt) / 1000;
    const wave = Math.sin(elapsedSeconds / 23 + this.config.phase) * 7;
    const secondaryWave = Math.sin(elapsedSeconds / 8 + this.config.phase * 2) * 3;
    const viewers = Math.max(0, Math.round(this.config.baseViewers + wave + secondaryWave));
    const growth = Math.floor(elapsedSeconds / 90);

    return {
      platformId: this.id,
      platformName: this.displayName,
      connected: true,
      health: 'ok',
      error: null,
      live: true,
      viewers,
      followers: this.config.baseFollowers + growth,
      paidSubscribers: this.config.paidSubscribers ?? null,
      chatters: this.config.baseChatters == null
        ? null
        : Math.max(0, Math.round(this.config.baseChatters + wave / 2)),
      reactions: this.config.baseReactions == null
        ? null
        : this.config.baseReactions + Math.floor(elapsedSeconds / 45),
      views: this.config.baseViews == null
        ? null
        : this.config.baseViews + Math.floor(elapsedSeconds / 12),
      streamTitle: this.config.title,
      category: this.config.category,
      startedAt: this.startedAt.toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
}
