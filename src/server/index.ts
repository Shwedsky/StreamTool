import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import open from 'open';
import { DemoPlatformAdapter } from './demo-adapter.js';
import { PollingCoordinator } from './polling-coordinator.js';
import { SnapshotStore } from './storage.js';
import { SseBroker } from './sse-broker.js';

const app = Fastify({ logger: true });
const broker = new SseBroker();
const store = new SnapshotStore();

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
  new DemoPlatformAdapter({
    id: 'twitch',
    displayName: 'Twitch',
    baseViewers: 53,
    baseFollowers: 2341,
    paidSubscribers: 41,
    baseChatters: 28,
    phase: 1.8,
    title: 'Вечерний мультистрим',
    category: 'Just Chatting'
  })
];

const coordinator = new PollingCoordinator(adapters, store, broker);

app.get('/api/health', async () => ({
  status: 'ok',
  mode: 'demo',
  sseClients: broker.clientCount,
  generatedAt: new Date().toISOString()
}));

app.get('/api/snapshot', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return coordinator.getLatest();
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
