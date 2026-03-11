/**
 * Express + WebSocket server.
 * Wraps SocietyClient and streams events to connected dashboards.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createClient, type SocietyClient } from 'society-core/sdk';
import { handleRpc } from './rpc.js';
import { buildSnapshot } from './snapshot.js';
import { setupEventForwarding } from './events.js';
import { CollaborationSimulation } from './simulation.js';
import type { RpcRequest, RpcNotification } from '../shared/types.js';

export interface ServerOptions {
  port: number;
  name: string;
  room: string;
  bootstrap?: string[];
  connectUrl?: string;
  p2pPort?: number;
}

export async function startServer(opts: ServerOptions): Promise<void> {
  // Initialize SocietyClient (embedded mode)
  let client: SocietyClient;

  if (opts.connectUrl) {
    // Remote mode — TODO: implement remote adapter
    console.log('Remote mode not yet implemented. Starting embedded node instead.');
  }

  client = await createClient({
    identity: { name: opts.name },
    storage: { path: undefined },
    network: {
      bootstrap: opts.bootstrap,
      port: opts.p2pPort,
      enableGossipsub: true,
      enableDht: true,
    },
    proactive: {
      enableLeadership: true,
    },
  });

  await client.joinRoom(opts.room);
  const identity = client.getIdentity();
  console.log(`Joined room: ${opts.room}`);
  console.log(`Peer ID: ${client.getPeerId()}`);
  console.log(`DID: ${identity.did}`);
  console.log();

  // Express app
  const app = express();
  app.use(express.json());

  // Health endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: opts.connectUrl ? 'remote' : 'embedded' });
  });

  // Serve static files in production
  app.use(express.static('dist/client'));

  const server = createServer(app);

  // WebSocket server
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();

  function broadcast(notification: RpcNotification): void {
    const msg = JSON.stringify(notification);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  // Forward Society events to all connected WS clients
  setupEventForwarding(client, broadcast);

  // Simulation engine
  let simulation: CollaborationSimulation | null = null;

  wss.on('connection', async (ws) => {
    clients.add(ws);
    console.log(`Dashboard client connected (total: ${clients.size})`);

    // Send initial snapshot
    try {
      const snapshot = await buildSnapshot(client, opts.room, simulation);
      const msg: RpcNotification = {
        jsonrpc: '2.0',
        method: 'snapshot',
        params: snapshot as unknown as Record<string, unknown>,
      };
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error('Failed to build snapshot:', err);
    }

    ws.on('message', async (data) => {
      try {
        const req: RpcRequest = JSON.parse(data.toString());
        if (req.jsonrpc !== '2.0' || !req.method) return;

        // Handle simulation commands
        if (req.method === 'simulation.start') {
          if (simulation) simulation.stop();
          simulation = new CollaborationSimulation(client, broadcast, opts.room);
          simulation.start();
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }));
          return;
        }
        if (req.method === 'simulation.stop') {
          simulation?.stop();
          simulation = null;
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }));
          return;
        }

        const result = await handleRpc(client, req.method, req.params || {}, simulation);
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          result,
        }));
      } catch (err: any) {
        const req = JSON.parse(data.toString());
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: req?.id,
          error: { code: -32000, message: err.message },
        }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`Dashboard client disconnected (total: ${clients.size})`);
    });
  });

  server.listen(opts.port, () => {
    console.log(`Dashboard server listening on http://localhost:${opts.port}`);
    console.log(`WebSocket endpoint: ws://localhost:${opts.port}/ws`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    wss.close();
    server.close();
    await client.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
