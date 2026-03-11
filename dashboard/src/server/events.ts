/**
 * Event forwarder: SocietyClient events -> WebSocket broadcast
 */

import type { SocietyClient } from 'society-core/sdk';
import type { RpcNotification } from '../shared/types.js';

export function setupEventForwarding(
  client: SocietyClient,
  broadcast: (notification: RpcNotification) => void
): void {
  // Peer/presence events
  client.on('message', (data: any) => {
    broadcast({
      jsonrpc: '2.0',
      method: 'event.message',
      params: data,
    });
  });

  // Chain events
  client.on('chain:opened', (data: any) => {
    broadcast({
      jsonrpc: '2.0',
      method: 'event.chain.opened',
      params: data,
    });
  });

  client.on('chain:completed', (data: any) => {
    broadcast({
      jsonrpc: '2.0',
      method: 'event.chain.completed',
      params: data,
    });
  });

  client.on('step:unlocked', (data: any) => {
    broadcast({
      jsonrpc: '2.0',
      method: 'event.step.unlocked',
      params: data,
    });
  });

  client.on('step:assigned', (data: any) => {
    broadcast({
      jsonrpc: '2.0',
      method: 'event.step.assigned',
      params: data,
    });
  });

  // Mission events
  client.on('mission:event', (data: any) => {
    broadcast({
      jsonrpc: '2.0',
      method: 'event.mission',
      params: data,
    });
  });

  // Room events
  client.on('room:joined', (data: any) => {
    broadcast({
      jsonrpc: '2.0',
      method: 'event.room.joined',
      params: data,
    });
  });

  client.on('room:left', (data: any) => {
    broadcast({
      jsonrpc: '2.0',
      method: 'event.room.left',
      params: data,
    });
  });

  // Connection status
  client.on('connected', () => {
    broadcast({
      jsonrpc: '2.0',
      method: 'event.connected',
      params: {},
    });
  });

  client.on('disconnected', () => {
    broadcast({
      jsonrpc: '2.0',
      method: 'event.disconnected',
      params: {},
    });
  });
}
