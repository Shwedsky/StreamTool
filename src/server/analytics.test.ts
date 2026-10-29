import assert from 'node:assert/strict';
import test from 'node:test';
import type { HistoryPoint, PlatformSnapshot } from '../shared/domain.js';
import { calculateAnalytics, downsampleHistory, rowsToHistory } from './analytics.js';
import type { StoredViewerRow } from './storage.js';

const base = Date.parse('2026-10-29T00:00:00.000Z');
const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();

function rows(): StoredViewerRow[] {
  return [
    { capturedAt: at(0), platformId: 'vk-live', live: 1, viewers: 60 },
    { capturedAt: at(0), platformId: 'twitch', live: 1, viewers: 40 },
    { capturedAt: at(1), platformId: 'vk-live', live: 1, viewers: 64 },
    { capturedAt: at(1), platformId: 'twitch', live: 1, viewers: 41 },
    { capturedAt: at(5), platformId: 'vk-live', live: 1, viewers: 70 },
    { capturedAt: at(5), platformId: 'twitch', live: 1, viewers: 45 }
  ];
}

const platforms: PlatformSnapshot[] = [
  {
    platformId: 'vk-live', platformName: 'VK Видео Live', connected: true, health: 'ok', error: null,
    live: true, viewers: 70, followers: 1_000, paidSubscribers: null, chatters: null, reactions: 10,
    views: 500, streamTitle: 'Test', category: null, startedAt: at(0), updatedAt: at(5)
  },
  {
    platformId: 'twitch', platformName: 'Twitch', connected: true, health: 'ok', error: null,
    live: true, viewers: 45, followers: 2_000, paidSubscribers: 20, chatters: 12, reactions: null,
    views: null, streamTitle: 'Test', category: null, startedAt: at(0), updatedAt: at(5)
  }
];

test('rowsToHistory aggregates platforms into total viewer points', () => {
  const history = rowsToHistory(rows());
  assert.equal(history.length, 3);
  assert.equal(history[0].totalViewers, 100);
  assert.equal(history[2].totalViewers, 115);
  assert.deepEqual(history[2].viewersByPlatform, { 'twitch': 45, 'vk-live': 70 });
});

test('calculateAnalytics derives average, peak, deltas and audience share', () => {
  const analytics = calculateAnalytics('session-test', at(0), platforms, rows());

  assert.equal(analytics.sampleCount, 3);
  assert.equal(analytics.averageViewers, 106.7);
  assert.equal(analytics.peakViewers, 115);
  assert.equal(analytics.peakAt, at(5));
  assert.equal(analytics.deltas.oneMinute, null);
  assert.equal(analytics.deltas.fiveMinutes, 15);
  assert.equal(analytics.audienceShare[0].percent, 60.9);
  assert.equal(analytics.audienceShare[1].percent, 39.1);
  assert.equal(analytics.bestGrowth?.delta, 15);
  assert.equal(analytics.bestGrowth?.minutes, 5);
});

test('downsampleHistory preserves short raid spikes while compressing a long stream', () => {
  const history: HistoryPoint[] = Array.from({ length: 1_200 }, (_value, index) => ({
    capturedAt: new Date(base + index * 15_000).toISOString(),
    totalViewers: index === 613 ? 88 : 20,
    viewersByPlatform: {
      'vk-live': index === 613 ? 48 : 11,
      twitch: index === 613 ? 40 : 9
    }
  }));

  const compressed = downsampleHistory(history);

  assert.ok(compressed.length <= 480);
  assert.equal(compressed[0].capturedAt, history[0].capturedAt);
  assert.equal(compressed.at(-1)?.capturedAt, history.at(-1)?.capturedAt);
  assert.ok(compressed.some((point) => point.totalViewers === 88));
  assert.ok(compressed.some((point) => point.viewersByPlatform['vk-live'] === 48));
  assert.ok(compressed.some((point) => point.viewersByPlatform.twitch === 40));
});