import type { ServerResponse } from 'node:http';
import type { AppSnapshot } from '../shared/domain.js';

export class SseBroker {
  private readonly clients = new Set<ServerResponse>();

  subscribe(response: ServerResponse): () => void {
    this.clients.add(response);
    return () => this.clients.delete(response);
  }

  send(response: ServerResponse, snapshot: AppSnapshot): void {
    response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  }

  broadcast(snapshot: AppSnapshot): void {
    for (const client of this.clients) {
      if (client.destroyed || client.writableEnded) {
        this.clients.delete(client);
        continue;
      }
      this.send(client, snapshot);
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
