import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { VkVideoPlatformAdapter } from './vk-video-adapter.js';
import { VkVideoStateStore, type VkVideoCredentials } from './vk-video-state-store.js';

const CLIENT_ID = 'vk-streamtool-client';
const CLIENT_SECRET = 'vk-streamtool-super-secret';

function statePath(): string {
  return join(tmpdir(), `streamtool-vk-${randomUUID()}.json`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function credentials(overrides: Partial<VkVideoCredentials> = {}): VkVideoCredentials {
  return {
    accessToken: 'vk-access-old',
    refreshToken: 'vk-refresh-old',
    expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    userNick: 'vk-tester',
    channelUrl: 'vk-tester-channel',
    displayName: 'VK Tester',
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

test('disconnected VK snapshot needs no network and exposes no credentials', async () => {
  const path = statePath();
  const store = new VkVideoStateStore(path);
  store.configure(CLIENT_ID, CLIENT_SECRET);
  let calls = 0;
  const adapter = new VkVideoPlatformAdapter(store, async () => {
    calls += 1;
    throw new Error('network should not be called');
  });

  const snapshot = await adapter.getSnapshot();
  const status = adapter.getAuthStatus();
  assert.equal(snapshot.connected, false);
  assert.equal(snapshot.viewers, null);
  assert.equal(calls, 0);
  assert.equal(status.configured, true);
  assert.equal(JSON.stringify(status).includes(CLIENT_SECRET), false);
  rmSync(path, { force: true });
});

test('VK authorization URL uses registered loopback redirect and never exposes client secret', () => {
  const path = statePath();
  const store = new VkVideoStateStore(path);
  store.configure(CLIENT_ID, CLIENT_SECRET);
  const adapter = new VkVideoPlatformAdapter(store, async () => {
    throw new Error('network should not be called');
  });

  const status = adapter.beginAuthorization();
  assert.equal(status.state, 'authorizing');
  assert.ok(status.authorizationUrl);
  const url = new URL(status.authorizationUrl!);
  assert.equal(url.origin + url.pathname, 'https://auth.live.vkvideo.ru/app/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), store.getRedirectUri());
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.ok(url.searchParams.get('state'));
  assert.equal(status.authorizationUrl!.includes(CLIENT_SECRET), false);
  assert.equal(JSON.stringify(status).includes(CLIENT_SECRET), false);
  rmSync(path, { force: true });
});

test('VK code exchange uses Basic client auth and maps real live counters', async () => {
  const path = statePath();
  const store = new VkVideoStateStore(path);
  store.configure(CLIENT_ID, CLIENT_SECRET);
  const expectedBasic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, 'utf8').toString('base64')}`;
  const startedAtSeconds = Math.floor(Date.parse('2026-10-29T18:00:00Z') / 1000);
  let channelCalls = 0;

  const adapter = new VkVideoPlatformAdapter(store, async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth/server/token')) {
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('authorization'), expectedBasic);
      const body = init?.body as URLSearchParams;
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('code'), 'vk-code');
      assert.equal(body.get('redirect_uri'), store.getRedirectUri());
      return jsonResponse({ access_token: 'vk-access', refresh_token: 'vk-refresh', expires_in: 7200, token_type: 'bearer' });
    }
    if (url.endsWith('/v1/current_user')) {
      return jsonResponse({ data: { user: { nick: 'VK Tester' }, channel: { url: 'vk-tester-channel' } } });
    }
    if (url.includes('/v1/channel?')) {
      channelCalls += 1;
      return jsonResponse({
        data: {
          channel: { nick: 'VK Tester', url: 'vk-tester-channel', counters: { subscribers: 321 } },
          stream: {
            title: 'VK live test',
            status: 'started',
            started_at: startedAtSeconds,
            category: { title: 'Игры' },
            counters: { viewers: 17, views: 88 },
            reactions: [{ type: 'like', count: 4 }, { type: 'heart', count: 3 }]
          }
        }
      });
    }
    throw new Error(`unexpected request ${url}`);
  });

  const pending = adapter.beginAuthorization();
  const state = new URL(pending.authorizationUrl!).searchParams.get('state')!;
  const connected = await adapter.completeAuthorization('vk-code', state);
  assert.equal(connected.connected, true);
  assert.equal(connected.broadcaster?.displayName, 'VK Tester');

  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.live, true);
  assert.equal(snapshot.viewers, 17);
  assert.equal(snapshot.followers, 321);
  assert.equal(snapshot.views, 88);
  assert.equal(snapshot.reactions, 7);
  assert.equal(snapshot.paidSubscribers, null);
  assert.equal(snapshot.streamTitle, 'VK live test');
  assert.equal(snapshot.category, 'Игры');
  assert.equal(snapshot.startedAt, '2026-10-29T18:00:00.000Z');
  assert.equal(channelCalls, 2);
  rmSync(path, { force: true });
});

test('expired VK access token refreshes with Basic auth and redirect_uri', async () => {
  const path = statePath();
  const store = new VkVideoStateStore(path);
  store.configure(CLIENT_ID, CLIENT_SECRET);
  store.saveCredentials(credentials({ expiresAt: new Date(Date.now() - 60_000).toISOString() }));
  const expectedBasic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, 'utf8').toString('base64')}`;

  const adapter = new VkVideoPlatformAdapter(store, async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth/server/token')) {
      assert.equal(new Headers(init?.headers).get('authorization'), expectedBasic);
      const body = init?.body as URLSearchParams;
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), 'vk-refresh-old');
      assert.equal(body.get('redirect_uri'), store.getRedirectUri());
      return jsonResponse({ access_token: 'vk-access-new', refresh_token: 'vk-refresh-new', expires_in: 7200 });
    }
    if (url.includes('/v1/channel?')) {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer vk-access-new');
      return jsonResponse({ data: { channel: { nick: 'VK Tester', counters: { subscribers: 10 } }, stream: null } });
    }
    throw new Error(`unexpected request ${url}`);
  });

  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.live, false);
  assert.equal(snapshot.viewers, 0);
  assert.equal(snapshot.followers, 10);
  assert.equal(store.getCredentials()?.accessToken, 'vk-access-new');
  assert.equal(store.getCredentials()?.refreshToken, 'vk-refresh-new');
  rmSync(path, { force: true });
});

test('authorized VK account without a channel is a valid connected state', async () => {
  const path = statePath();
  const store = new VkVideoStateStore(path);
  store.configure(CLIENT_ID, CLIENT_SECRET);
  store.saveCredentials(credentials({ channelUrl: null, displayName: 'New VK User' }));

  const adapter = new VkVideoPlatformAdapter(store, async (input) => {
    const url = String(input);
    if (url.endsWith('/v1/current_user')) {
      return jsonResponse({ data: { user: { nick: 'New VK User' }, channel: null } });
    }
    throw new Error(`unexpected request ${url}`);
  });

  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.live, false);
  assert.equal(snapshot.viewers, 0);
  assert.equal(snapshot.followers, null);
  rmSync(path, { force: true });
});
