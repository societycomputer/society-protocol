/**
 * Builds initial dashboard snapshot for new WebSocket connections.
 */

import type { SocietyClient } from 'society-core/sdk';
import type { DashboardSnapshot } from '../shared/types.js';
import type { CollaborationSimulation } from './simulation.js';

export async function buildSnapshot(
  client: SocietyClient,
  defaultRoom: string,
  simulation?: CollaborationSimulation | null,
): Promise<DashboardSnapshot> {
  const rooms = client.getJoinedRooms();
  const roomId = rooms[0] || defaultRoom;

  const [peers, chains, missions] = await Promise.all([
    client.getPeers(roomId).catch(() => []),
    client.listChains(roomId).catch(() => []),
    client.listMissions(roomId).catch(() => []),
  ]);

  const identity = client.getIdentity();

  return {
    node: {
      peerId: client.getPeerId(),
      did: identity.did,
      name: identity.name,
      multiaddrs: client.getMultiaddrs(),
    },
    peers: [
      ...peers.map(p => ({
        did: p.did,
        name: p.name,
        status: p.status as any,
        reputation: p.reputation,
        specialties: p.specialties,
      })),
      ...(simulation?.running ? simulation.agents.map(a => ({
        did: a.did,
        name: a.name,
        status: a.status as 'online' | 'busy',
        reputation: 0.85 + Math.random() * 0.15,
        specialties: [a.specialty],
      })) : []),
    ],
    rooms,
    chains: chains.map(c => ({
      id: c.id,
      roomId,
      goal: c.goal,
      status: c.status,
      priority: 'normal',
      steps: c.steps.map(s => ({
        id: s.id,
        chainId: c.id,
        kind: s.kind,
        title: s.title,
        status: s.status,
        assignee: s.assignee,
        dependsOn: [],
      })),
    })),
    federations: (client.listFederations() || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      visibility: f.visibility,
      governance: f.governance?.model || 'democracy',
      memberCount: f.memberCount || 0,
      onlineCount: f.onlineCount || 0,
    })),
    missions: missions.map((m: any) => ({
      id: m.missionId || m.id,
      roomId: m.roomId || roomId,
      goal: m.goal || m.spec?.goal || '',
      status: m.status,
      chainCount: m.chainIds?.length || 0,
      workerCount: m.workers?.length || 0,
    })),
    messages: simulation?.messages as any[] || [],
  };
}
