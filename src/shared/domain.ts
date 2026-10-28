export type PlatformId = 'twitch' | 'vk-live' | string;

export type PlatformHealth = 'ok' | 'error';

export interface PlatformSnapshot {
  platformId: PlatformId;
  platformName: string;
  connected: boolean;
  health: PlatformHealth;
  error: string | null;
  live: boolean;
  viewers: number | null;
  followers: number | null;
  paidSubscribers: number | null;
  chatters: number | null;
  reactions: number | null;
  views: number | null;
  streamTitle: string | null;
  category: string | null;
  startedAt: string | null;
  updatedAt: string;
}

export interface AppSnapshot {
  generatedAt: string;
  totalViewers: number;
  peakViewers: number;
  platforms: PlatformSnapshot[];
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly displayName: string;
  getSnapshot(): Promise<PlatformSnapshot>;
}
