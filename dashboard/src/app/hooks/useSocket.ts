/**
 * WebSocket connection hook with auto-reconnect and JSON-RPC dispatch.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useConnectionStore } from '../stores/connection';
import { usePeersStore } from '../stores/peers';
import { useTopologyStore } from '../stores/topology';
import { useChainsStore } from '../stores/chains';
import { useFederationsStore } from '../stores/federations';
import { useMissionsStore } from '../stores/missions';
import { useChatStore } from '../stores/chat';
import type { RpcRequest, RpcResponse, RpcNotification, RpcMessage, DashboardSnapshot } from '../../shared/types';

const WS_URL = `ws://${window.location.hostname}:4200/ws`;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

let rpcId = 0;
const pendingCalls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

export function useSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const [connected, setConnected] = useState(false);

  const setConnectionStatus = useConnectionStore(s => s.setStatus);
  const setNodeInfo = useConnectionStore(s => s.setNodeInfo);
  const setRooms = useConnectionStore(s => s.setRooms);
  const setPeers = usePeersStore(s => s.setPeers);
  const setTopology = useTopologyStore(s => s.setSnapshot);
  const setChains = useChainsStore(s => s.setChains);
  const setFederations = useFederationsStore(s => s.setFederations);
  const setMissions = useMissionsStore(s => s.setMissions);

  const handleMessage = useCallback((event: MessageEvent) => {
    const msg: RpcMessage = JSON.parse(event.data);

    // Response to our call
    if ('id' in msg && msg.id !== undefined) {
      const resp = msg as RpcResponse;
      const pending = pendingCalls.get(resp.id);
      if (pending) {
        pendingCalls.delete(resp.id);
        if (resp.error) {
          pending.reject(new Error(resp.error.message));
        } else {
          pending.resolve(resp.result);
        }
      }
      return;
    }

    // Server notification
    const notif = msg as RpcNotification;
    switch (notif.method) {
      case 'snapshot': {
        const snap = notif.params as unknown as DashboardSnapshot;
        setNodeInfo(snap.node);
        setRooms(snap.rooms);
        setPeers(snap.peers);
        setChains(snap.chains);
        if (snap.federations) setFederations(snap.federations);
        if (snap.missions) setMissions(snap.missions);
        if (snap.messages?.length) useChatStore.getState().setMessages(snap.messages as any);
        break;
      }
      case 'event.peer.connected':
        usePeersStore.getState().addPeer(notif.params as any);
        break;
      case 'event.peer.disconnected':
        usePeersStore.getState().removePeer(notif.params.peerId as string);
        break;
      case 'event.presence':
        usePeersStore.getState().updatePresence(notif.params as any);
        break;
      case 'event.chain.opened':
        useChainsStore.getState().addChain(notif.params as any);
        break;
      case 'event.chain.completed':
        useChainsStore.getState().updateChainStatus(notif.params.id as string, 'completed');
        break;
      case 'event.step.assigned':
        useChainsStore.getState().updateStep(
          notif.params.chainId as string,
          notif.params.stepId as string,
          { status: 'assigned', assignee: notif.params.assignee as string }
        );
        break;
      case 'event.step.unlocked':
        useChainsStore.getState().updateStep(
          notif.params.chainId as string,
          notif.params.stepId as string,
          { status: 'unlocked' }
        );
        break;
      case 'event.message':
        useChatStore.getState().addMessage(notif.params as any);
        break;
    }
  }, [setNodeInfo, setRooms, setPeers, setTopology, setChains, setFederations, setMissions]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttempt.current = 0;
      setConnected(true);
      setConnectionStatus('connected');
      console.log('Dashboard connected');
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      setConnected(false);
      setConnectionStatus('disconnected');
      const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt.current, RECONNECT_DELAYS.length - 1)];
      reconnectAttempt.current++;
      setConnectionStatus('reconnecting');
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [handleMessage, setConnectionStatus]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const rpc = useCallback(async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      const id = ++rpcId;
      pendingCalls.set(id, { resolve, reject });
      const req: RpcRequest = { jsonrpc: '2.0', id, method, params };
      ws.send(JSON.stringify(req));

      // Timeout after 30s
      setTimeout(() => {
        if (pendingCalls.has(id)) {
          pendingCalls.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 30000);
    });
  }, []);

  return { connected, rpc };
}
