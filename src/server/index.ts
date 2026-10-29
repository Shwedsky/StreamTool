import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import open from 'open';
import { calculateAnalytics } from './analytics.js';
import { PollingCoordinator } from './polling-coordinator.js';
import { SnapshotStore } from './storage.js';
import { SseBroker } from './sse-broker.js';
import { TwitchPlatformAdapter } from './twitch-adapter.js';
import { VkVideoPlatformAdapter } from './vk-video-adapter.js';

const app = Fastify({ logger: true });
const broker = new SseBroker();
const store = new SnapshotStore();
const twitch = new TwitchPlatformAdapter();
const vkVideo = new VkVideoPlatformAdapter();
await Promise.all([twitch.initialize(), vkVideo.initialize()]);

const adapters = [vkVideo, twitch];
const coordinator = new PollingCoordinator(adapters, store, broker);

let dashboardUrl = '';
let vkCallbackApp: ReturnType<typeof Fastify> | null = null;

async function ensureVkCallbackServer(): Promise<void> {
  if (vkCallbackApp) return;

  const redirect = new URL(vkVideo.getRedirectUri());
  if (redirect.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(redirect.hostname)) {
    throw new Error('VK redirect URI должен быть локальным http://127.0.0.1 или http://localhost адресом');
  }
  const port = Number(redirect.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('VK redirect URI должен содержать локальный порт');
  }

  const callback = Fastify({ logger: false });
  callback.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>(redirect.pathname, async (request, reply) => {
    if (request.query.error) {
      return reply.type('text/html; charset=utf-8').send(`<!doctype html><meta charset="utf-8"><title>VK Video Live</title><body style="font-family:system-ui;background:#111827;color:#e5e7eb;padding:40px"><h2>Подключение VK не завершено</h2><p>Вернитесь в StreamToolByShwedsky и попробуйте ещё раз.</p></body>`);
    }

    try {
      await vkVideo.completeAuthorization(request.query.code ?? '', request.query.state ?? '');
      const target = dashboardUrl || 'about:blank';
      return reply.redirect(target);
    } catch {
      return reply.type('text/html; charset=utf-8').code(400).send(`<!doctype html><meta charset="utf-8"><title>VK Video Live</title><body style="font-family:system-ui;background:#111827;color:#e5e7eb;padding:40px"><h2>Не удалось подключить VK Video Live</h2><p>Вернитесь в StreamToolByShwedsky и повторите подключение.</p></body>`);
    }
  });

  try {
    await callback.listen({ host: redirect.hostname, port });
  } catch {
    await callback.close().catch(() => undefined);
    throw new Error(`Не удалось занять порт ${port} для VK OAuth. Закройте программу, которая использует этот порт, и повторите.`);
  }

  vkCallbackApp = callback;
}

app.get('/api/health', async () => ({
  status: 'ok',
  mode: `${vkVideo.getAuthStatus().connected ? 'vk-live' : 'vk-disconnected'}+${twitch.getAuthStatus().connected ? 'twitch-live' : 'twitch-disconnected'}`,
  sseClients: broker.clientCount,
  generatedAt: new Date().toISOString()
}));

app.get('/api/snapshot', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return coordinator.getLatest();
});

app.get('/api/platforms/twitch/auth', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return twitch.getAuthStatus();
});

app.post<{ Body: { clientId?: string } }>('/api/platforms/twitch/config', async (request, reply) => {
  const clientId = request.body?.clientId?.trim();
  if (!clientId) return reply.code(400).send({ error: 'Укажите Twitch Client ID' });

  try {
    return twitch.configureClientId(clientId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось сохранить Twitch Client ID';
    return reply.code(400).send({ error: message });
  }
});

app.post('/api/platforms/twitch/connect', async (_request, reply) => {
  try {
    return await twitch.beginDeviceFlow();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось начать подключение Twitch';
    return reply.code(400).send({ error: message });
  }
});

app.post('/api/platforms/twitch/disconnect', async () => twitch.disconnect());

app.get('/api/platforms/vk-live/auth', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return vkVideo.getAuthStatus();
});

app.post<{ Body: { clientId?: string; clientSecret?: string } }>('/api/platforms/vk-live/config', async (request, reply) => {
  const clientId = request.body?.clientId?.trim();
  const clientSecret = request.body?.clientSecret?.trim();
  if (!clientId || !clientSecret) {
    return reply.code(400).send({ error: 'Укажите VK Video Live Client ID и Client Secret' });
  }

  try {
    return vkVideo.configure(clientId, clientSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось сохранить настройки VK Video Live';
    return reply.code(400).send({ error: message });
  }
});

app.post('/api/platforms/vk-live/connect', async (_request, reply) => {
  try {
    await ensureVkCallbackServer();
    return vkVideo.beginAuthorization();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось начать подключение VK Video Live';
    return reply.code(400).send({ error: message });
  }
});

app.post('/api/platforms/vk-live/disconnect', async () => vkVideo.disconnect());

app.get('/api/sessions', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return { sessions: store.listRecentSessions(20) };
});

app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const session = store.getSession(request.params.id);
  if (!session) return reply.code(404).send({ error: 'Session not found' });

  const analytics = calculateAnalytics(
    session.id,
    session.streamStartedAt,
    [],
    store.loadSessionViewerRows(session.id)
  );
  return { session, analytics };
});

app.get('/api/events', async (request, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  reply.raw.write(': connected\n\n');
  broker.send(reply.raw, coordinator.getLatest());

  const unsubscribe = broker.subscribe(reply.raw);
  request.raw.once('close', unsubscribe);
});

const webRoot = resolve(process.cwd(), 'dist', 'web');
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, {
    root: webRoot,
    prefix: '/'
  });

  app.get('/dashboard', async (_request, reply) => reply.sendFile('index.html'));
  app.get('/compact', async (_request, reply) => reply.sendFile('index.html'));
  app.get('/reports', async (_request, reply) => reply.sendFile('index.html'));
}

await coordinator.start();
dashboardUrl = await app.listen({ host: '127.0.0.1', port: 0 });
app.log.info(`StreamTool listening on ${dashboardUrl}`);

if (process.env.STREAMTOOL_NO_OPEN !== '1') {
  await open(dashboardUrl);
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  coordinator.stop();
  store.close();
  if (vkCallbackApp) await vkCallbackApp.close().catch(() => undefined);
  await app.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
