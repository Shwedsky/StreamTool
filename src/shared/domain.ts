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

export interface ViewerDeltaWindows {
  oneMinute: number | null;
  fiveMinutes: number | null;
  fifteenMinutes: number | null;
  thirtyMinutes: number | null;
}

export interface PlatformAudienceShare {
  platformId: PlatformId;
  viewers: number;
  percent: number;
}

export interface HistoryPoint {
  capturedAt: string;
  totalViewers: number;
  viewersByPlatform: Record<string, number>;
}

export interface GrowthWindow {
  minutes: 1 | 5 | 15 | 30;
  delta: number;
  fromAt: string;
  toAt: string;
}

export interface StreamAnalytics {
  sessionId: string | null;
  streamStartedAt: string | null;
  observedSince: string | null;
  sampleCount: number;
  averageViewers: number | null;
  peakViewers: number;
  peakAt: string | null;
  deltas: ViewerDeltaWindows;
  audienceShare: PlatformAudienceShare[];
  bestGrowth: GrowthWindow | null;
  history: HistoryPoint[];
}

export interface AppSnapshot {
  generatedAt: string;
  totalViewers: number;
  peakViewers: number;
  platforms: PlatformSnapshot[];
  analytics: StreamAnalytics;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly displayName: string;
  getSnapshot(): Promise<PlatformSnapshot>;
}
