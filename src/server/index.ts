import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import open from 'open';
import { calculateAnalytics } from './analytics.js';
import { DemoPlatformAdapter } from './demo-adapter.js';
import { PollingCoordinator } from './polling-coordinator.js';
import { SnapshotStore } from './storage.js';
import { SseBroker } from './sse-broker.js';
import { TwitchPlatformAdapter } from './twitch-adapter.js';

const app = Fastify({ logger: true });
const broker = new SseBroker();
const store = new SnapshotStore();
const twitch = new TwitchPlatformAdapter();
await twitch.initialize();

const adapters = [
  new DemoPlatformAdapter({
    id: 'vk-live',
    displayName: 'VK Видео Live',
    baseViewers: 81,
    baseFollowers: 4812,
    baseReactions: 37,
    baseViews: 1337,
    phase: 0.4,
    title: 'Вечерний мультистрим',
    category: 'Just Chatting'
  }),
  twitch
];

const coordinator = new PollingCoordinator(adapters, store, broker);

app.get('/api/health', async () => ({
  status: 'ok',
  mode: twitch.getAuthStatus().connected ? 'vk-demo+twitch-live' : 'vk-demo+twitch-disconnected',
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
const url = await app.listen({ host: '127.0.0.1', port: 0 });
app.log.info(`StreamTool listening on ${url}`);

if (process.env.STREAMTOOL_NO_OPEN !== '1') {
  await open(url);
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  coordinator.stop();
  store.close();
  await app.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
