import type {
  GrowthWindow,
  HistoryPoint,
  PlatformAudienceShare,
  PlatformSnapshot,
  StreamAnalytics,
  ViewerDeltaWindows
} from '../shared/domain.js';
import type { StoredViewerRow } from './storage.js';

const DELTA_TOLERANCE_MS = 90_000;
const CHART_POINT_LIMIT = 480;
const WINDOW_MINUTES = [1, 5, 15, 30] as const;

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

export function rowsToHistory(rows: StoredViewerRow[]): HistoryPoint[] {
  const byTime = new Map<string, HistoryPoint>();

  for (const row of rows) {
    let point = byTime.get(row.capturedAt);
    if (!point) {
      point = {
        capturedAt: row.capturedAt,
        totalViewers: 0,
        viewersByPlatform: {}
      };
      byTime.set(row.capturedAt, point);
    }

    const viewers = row.live ? row.viewers ?? 0 : 0;
    point.viewersByPlatform[row.platformId] = viewers;
    point.totalViewers += viewers;
  }

  return [...byTime.values()].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

function historicalPoint(points: HistoryPoint[], targetMs: number): HistoryPoint | null {
  let best: HistoryPoint | null = null;

  for (const point of points) {
    const time = Date.parse(point.capturedAt);
    if (time > targetMs) break;
    best = point;
  }

  if (!best) return null;
  return targetMs - Date.parse(best.capturedAt) <= DELTA_TOLERANCE_MS ? best : null;
}

function calculateDelta(points: HistoryPoint[], minutes: number): number | null {
  const latest = points.at(-1);
  if (!latest) return null;
  const target = Date.parse(latest.capturedAt) - minutes * 60_000;
  const previous = historicalPoint(points, target);
  return previous ? latest.totalViewers - previous.totalViewers : null;
}

function calculateDeltas(points: HistoryPoint[]): ViewerDeltaWindows {
  return {
    oneMinute: calculateDelta(points, 1),
    fiveMinutes: calculateDelta(points, 5),
    fifteenMinutes: calculateDelta(points, 15),
    thirtyMinutes: calculateDelta(points, 30)
  };
}

function calculateBestGrowth(points: HistoryPoint[]): GrowthWindow | null {
  let best: GrowthWindow | null = null;

  for (const minutes of WINDOW_MINUTES) {
    for (let index = 1; index < points.length; index += 1) {
      const current = points[index];
      const target = Date.parse(current.capturedAt) - minutes * 60_000;
      const previous = historicalPoint(points.slice(0, index), target);
      if (!previous) continue;

      const candidate: GrowthWindow = {
        minutes,
        delta: current.totalViewers - previous.totalViewers,
        fromAt: previous.capturedAt,
        toAt: current.capturedAt
      };

      if (!best || candidate.delta > best.delta) best = candidate;
    }
  }

  return best;
}

function calculateAudienceShare(platforms: PlatformSnapshot[]): PlatformAudienceShare[] {
  const live = platforms
    .filter((platform) => platform.live)
    .map((platform) => ({ platformId: platform.platformId, viewers: platform.viewers ?? 0 }));
  const total = live.reduce((sum, platform) => sum + platform.viewers, 0);

  return live.map((platform) => ({
    ...platform,
    percent: total > 0 ? roundOne((platform.viewers / total) * 100) : 0
  }));
}

export function downsampleHistory(points: HistoryPoint[]): HistoryPoint[] {
  if (points.length <= CHART_POINT_LIMIT) return points;

  const platformIds = [...new Set(points.flatMap((point) => Object.keys(point.viewersByPlatform)))];
  const selectors: Array<(point: HistoryPoint) => number> = [
    (point) => point.totalViewers,
    ...platformIds.map((platformId) => (point: HistoryPoint) => point.viewersByPlatform[platformId] ?? 0)
  ];

  const extremaPerBucket = Math.max(2, selectors.length * 2);
  const bucketCount = Math.max(1, Math.floor((CHART_POINT_LIMIT - 2) / extremaPerBucket));
  const interior = points.slice(1, -1);
  const bucketSize = Math.max(1, Math.ceil(interior.length / bucketCount));
  const selected: HistoryPoint[] = [points[0]];

  for (let start = 0; start < interior.length; start += bucketSize) {
    const bucket = interior.slice(start, start + bucketSize);
    const chosen = new Set<number>();

    for (const selector of selectors) {
      let minIndex = 0;
      let maxIndex = 0;
      for (let index = 1; index < bucket.length; index += 1) {
        if (selector(bucket[index]) < selector(bucket[minIndex])) minIndex = index;
        if (selector(bucket[index]) > selector(bucket[maxIndex])) maxIndex = index;
      }
      chosen.add(minIndex);
      chosen.add(maxIndex);
    }

    for (const index of [...chosen].sort((a, b) => a - b)) {
      selected.push(bucket[index]);
    }
  }

  selected.push(points.at(-1)!);
  return selected;
}

export function calculateAnalytics(
  sessionId: string | null,
  streamStartedAt: string | null,
  platforms: PlatformSnapshot[],
  rows: StoredViewerRow[]
): StreamAnalytics {
  const history = rowsToHistory(rows);
  const peak = history.reduce<HistoryPoint | null>((best, point) => {
    if (!best || point.totalViewers > best.totalViewers) return point;
    return best;
  }, null);
  const totalSum = history.reduce((sum, point) => sum + point.totalViewers, 0);

  return {
    sessionId,
    streamStartedAt,
    observedSince: history[0]?.capturedAt ?? null,
    sampleCount: history.length,
    averageViewers: history.length ? roundOne(totalSum / history.length) : null,
    peakViewers: peak?.totalViewers ?? 0,
    peakAt: peak?.capturedAt ?? null,
    deltas: calculateDeltas(history),
    audienceShare: calculateAudienceShare(platforms),
    bestGrowth: calculateBestGrowth(history),
    history: downsampleHistory(history)
  };
}