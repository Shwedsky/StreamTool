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
const CHART_POINT_LIMIT = 180;
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

function closestPoint(points: HistoryPoint[], targetMs: number): HistoryPoint | null {
  if (!points.length || Date.parse(points[0].capturedAt) > targetMs) return null;

  let best: HistoryPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const point of points) {
    const time = Date.parse(point.capturedAt);
    const distance = Math.abs(time - targetMs);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
    if (time > targetMs && distance > bestDistance) break;
  }

  return bestDistance <= DELTA_TOLERANCE_MS ? best : null;
}

function calculateDelta(points: HistoryPoint[], minutes: number): number | null {
  const latest = points.at(-1);
  if (!latest) return null;
  const target = Date.parse(latest.capturedAt) - minutes * 60_000;
  const previous = closestPoint(points, target);
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
      const previous = closestPoint(points.slice(0, index), target);
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

function downsample(points: HistoryPoint[]): HistoryPoint[] {
  if (points.length <= CHART_POINT_LIMIT) return points;

  const stride = Math.ceil(points.length / CHART_POINT_LIMIT);
  const result = points.filter((_point, index) => index % stride === 0);
  const last = points.at(-1);
  if (last && result.at(-1)?.capturedAt !== last.capturedAt) result.push(last);
  return result;
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
    history: downsample(history)
  };
}
