import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { TwitchPlatformAdapter } from './twitch-adapter.js';
import { TwitchStateStore, type TwitchCredentials } from './twitch-state-store.js';

const CLIENT_ID = 'streamtoolclientid12345';

function statePath(): string {
  return join(tmpdir(), `streamtool-twitch-${randomUUID()}.json`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function credentials(overrides: Partial<TwitchCredentials> = {}): TwitchCredentials {
  return {
    accessToken: 'access-old',
    refreshToken: 'refresh-old',
    expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    userId: '1234',
    login: 'tester',
    displayName: 'Tester',
    scopes: ['channel:read:subscriptions', 'moderator:read:chatters'],
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

test('disconnected Twitch snapshot does not require network', async () => {
  const path = statePath();
  const store = new TwitchStateStore(path);
  store.setClientId(CLIENT_ID);
  let calls = 0;
  const adapter = new TwitchPlatformAdapter(store, async () => {
    calls += 1;
    throw new Error('network should not be called');
  });

  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connected, false);
  assert.equal(snapshot.live, false);
  assert.equal(snapshot.viewers, null);
  assert.equal(calls, 0);
  rmSync(path, { force: true });
});

test('device flow start exposes activation code but never token material', async () => {
  const path = statePath();
  const store = new TwitchStateStore(path);
  store.setClientId(CLIENT_ID);

  const adapter = new TwitchPlatformAdapter(store, async (input) => {
    assert.equal(String(input), 'https://id.twitch.tv/oauth2/device');
    return jsonResponse({
      device_code: 'device-secret-code',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://www.twitch.tv/activate',
      expires_in: 1800,
      interval: 60
    });
  });

  const status = await adapter.beginDeviceFlow();
  assert.equal(status.state, 'authorizing');
  assert.equal(status.activation?.userCode, 'ABCD-EFGH');
  assert.equal(status.activation?.verificationUri, 'https://www.twitch.tv/activate');
  assert.equal(JSON.stringify(status).includes('device-secret-code'), false);
  adapter.disconnect();
  rmSync(path, { force: true });
});

test('real Twitch snapshot maps live viewers and isolates optional metric failures', async () => {
  const path = statePath();
  const store = new TwitchStateStore(path);
  store.setClientId(CLIENT_ID);
  store.saveCredentials(credentials());

  const calls: string[] = [];
  const adapter = new TwitchPlatformAdapter(store, async (input) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith('/oauth2/validate')) {
      return jsonResponse({ client_id: CLIENT_ID, login: 'tester', user_id: '1234', scopes: [], expires_in: 7200 });
    }
    if (url.includes('/helix/streams?')) {
      return jsonResponse({ data: [{ id: 'stream-1', viewer_count: 17, title: 'Live test', game_name: 'Dota 2', started_at: '2026-10-29T18:00:00Z' }] });
    }
    if (url.includes('/channels/followers?')) return jsonResponse({ total: 222, data: [], pagination: {} });
    if (url.includes('/subscriptions?')) return jsonResponse({ message: 'not eligible' }, 403);
    if (url.includes('/chat/chatters?')) return jsonResponse({ total: 6, data: [], pagination: {} });
    throw new Error(`unexpected request ${url}`);
  });

  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.live, true);
  assert.equal(snapshot.viewers, 17);
  assert.equal(snapshot.followers, 222);
  assert.equal(snapshot.paidSubscribers, null);
  assert.equal(snapshot.chatters, 6);
  assert.equal(snapshot.streamTitle, 'Live test');
  assert.equal(snapshot.category, 'Dota 2');
  assert.equal(snapshot.startedAt, '2026-10-29T18:00:00Z');
  assert.equal(calls.filter((url) => url.includes('/helix/streams?')).length, 1);
  rmSync(path, { force: true });
});

test('expired access token rotates public-client refresh token before polling Twitch', async () => {
  const path = statePath();
  const store = new TwitchStateStore(path);
  store.setClientId(CLIENT_ID);
  store.saveCredentials(credentials({ expiresAt: new Date(Date.now() - 60_000).toISOString() }));

  const adapter = new TwitchPlatformAdapter(store, async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth2/token')) {
      const body = init?.body as URLSearchParams;
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), 'refresh-old');
      assert.equal(body.get('client_id'), CLIENT_ID);
      assert.equal(body.has('client_secret'), false);
      return jsonResponse({
        access_token: 'access-new',
        refresh_token: 'refresh-new',
        expires_in: 14400,
        scope: ['channel:read:subscriptions', 'moderator:read:chatters'],
        token_type: 'bearer'
      });
    }
    if (url.includes('/helix/streams?')) return jsonResponse({ data: [] });
    if (url.includes('/channels/followers?')) return jsonResponse({ total: 10, data: [], pagination: {} });
    if (url.includes('/subscriptions?')) return jsonResponse({ total: 2, data: [], pagination: {} });
    if (url.includes('/chat/chatters?')) return jsonResponse({ total: 0, data: [], pagination: {} });
    throw new Error(`unexpected request ${url}`);
  });

  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.live, false);
  assert.equal(snapshot.viewers, 0);
  assert.equal(store.getCredentials()?.accessToken, 'access-new');
  assert.equal(store.getCredentials()?.refreshToken, 'refresh-new');
  rmSync(path, { force: true });
});
