/**
 * JSON-RPC method dispatcher.
 * Maps RPC method names to SocietyClient operations.
 */

import type { SocietyClient } from 'society-core/sdk';
import type { CollaborationSimulation } from './simulation.js';

type RpcParams = Record<string, unknown>;

export async function handleRpc(
  client: SocietyClient,
  method: string,
  params: RpcParams,
  simulation?: CollaborationSimulation | null,
): Promise<unknown> {
  switch (method) {
    // ─── Node ────────────────────────────────────────────
    case 'node.info': {
      const id = client.getIdentity();
      return {
        peerId: client.getPeerId(),
        did: id.did,
        name: id.name,
        multiaddrs: client.getMultiaddrs(),
      };
    }

    // ─── Rooms ───────────────────────────────────────────
    case 'rooms.list':
      return client.getJoinedRooms();

    case 'rooms.join':
      await client.joinRoom(params.roomId as string);
      return { ok: true };

    case 'rooms.leave':
      await client.leaveRoom(params.roomId as string);
      return { ok: true };

    // ─── Peers ───────────────────────────────────────────
    case 'peers.list':
      return client.getPeers(params.roomId as string);

    // ─── Topology ────────────────────────────────────────
    case 'topology.snapshot': {
      const peers = await client.getPeers(params.roomId as string || client.getJoinedRooms()[0]);
      const selfId = client.getPeerId();
      const selfIdentity = client.getIdentity();
      const selfDid = selfIdentity.did;
      const selfName = selfIdentity.name;

      const nodes = [
        { id: selfId, did: selfDid, name: selfName, isSelf: true, status: 'online', reputation: 1.0 },
        ...peers.map(p => ({
          id: p.did,
          did: p.did,
          name: p.name,
          isSelf: false,
          status: p.status,
          reputation: p.reputation,
        })),
        ...(simulation?.running ? simulation.agents.map(a => ({
          id: a.did,
          did: a.did,
          name: a.name,
          isSelf: false,
          status: a.status,
          reputation: 0.85 + Math.random() * 0.1,
        })) : []),
      ];

      const edges = [
        ...peers.map(p => ({
          source: selfId,
          target: p.did,
          transport: 'tcp',
          direction: 'outbound' as const,
        })),
        ...(simulation?.running ? simulation.agents.map(a => ({
          source: selfId,
          target: a.did,
          transport: 'gossipsub',
          direction: 'outbound' as const,
        })) : []),
      ];

      return { nodes, edges };
    }

    // ─── Transport ───────────────────────────────────────
    case 'transport.info':
      return {
        multiaddrs: client.getMultiaddrs(),
        connections: [],
        bandwidth: { totalIn: 0, totalOut: 0, rateIn: 0, rateOut: 0 },
        gossipsub: { topics: [], meshPeerCount: 0 },
      };

    // ─── Chains (CoC) ────────────────────────────────────
    case 'coc.list': {
      const roomId = params.roomId as string || client.getJoinedRooms()[0];
      return client.listChains(roomId);
    }

    case 'coc.get':
      return client.getChain(params.chainId as string);

    case 'coc.summon':
      return client.summon({
        goal: params.goal as string,
        roomId: params.roomId as string,
        template: params.template as string | undefined,
        priority: params.priority as 'low' | 'normal' | 'high' | 'critical' | undefined,
      });

    case 'coc.submitStep':
      await client.submitStep(params.stepId as string, {
        status: (params.status as 'completed' | 'failed' | 'partial') || 'completed',
        output: params.output as string,
      });
      return { ok: true };

    case 'coc.reviewStep':
      await client.reviewStep(
        params.stepId as string,
        params.decision as 'approved' | 'rejected' | 'needs_revision',
        params.notes as string || ''
      );
      return { ok: true };

    case 'coc.cancel':
      await client.cancelChain(params.chainId as string, params.reason as string);
      return { ok: true };

    // ─── Templates ───────────────────────────────────────
    case 'templates.list':
      return client.listTemplates(params.category as string | undefined);

    // ─── Federation ──────────────────────────────────────
    case 'federation.list':
      return client.listFederations();

    case 'federation.get':
      return client.getFederation(params.federationId as string);

    case 'federation.create':
      return client.createFederation(
        params.name as string,
        params.description as string,
        params.visibility as 'public' | 'private' | 'invite-only' || 'private',
      );

    case 'federation.join':
      return client.joinFederation(params.federationId as string);

    case 'federation.peering.list':
      return client.listPeerings(
        params.federationId as string,
        params.status as any
      );

    case 'federation.peering.request':
      return client.createPeering(
        params.sourceFederationId as string,
        params.targetFederationDid as string,
        params.policy as any
      );

    case 'federation.peering.accept':
      return client.acceptPeering(params.peeringId as string, params.reason as string);

    case 'federation.peering.reject':
      return client.rejectPeering(params.peeringId as string, params.reason as string);

    case 'federation.bridge.open':
      return client.openBridge(
        params.peeringId as string,
        params.localRoomId as string,
        params.remoteRoomId as string,
        params.rules as any
      );

    case 'federation.bridge.close':
      await client.closeBridge(params.bridgeId as string);
      return { ok: true };

    case 'federation.bridge.list':
      return client.listBridges(params.federationId as string);

    case 'federation.mesh.stats':
      return client.getMeshStats(params.federationId as string);

    // ─── Missions ────────────────────────────────────────
    case 'mission.list':
      return client.listMissions(params.roomId as string);

    case 'mission.get':
      return client.getMission(params.missionId as string);

    case 'mission.start':
      return client.startMission(params.spec as any);

    case 'mission.pause':
      await client.pauseMission(params.missionId as string);
      return { ok: true };

    case 'mission.resume':
      await client.resumeMission(params.missionId as string);
      return { ok: true };

    case 'mission.stop':
      await client.stopMission(params.missionId as string, params.reason as string);
      return { ok: true };

    case 'mission.swarmStatus':
      return client.getSwarmStatus(params.roomId as string);

    // ─── Reputation ──────────────────────────────────────
    case 'reputation.get':
      return client.getReputation(params.did as string);

    // ─── Knowledge ───────────────────────────────────────
    case 'knowledge.query':
      return { cards: client.queryKnowledgeCards({
        spaceId: params.spaceId as string | undefined,
        type: params.type as string | undefined,
        tags: params.tags as string[] | undefined,
        query: params.query as string | undefined,
        limit: params.limit as number | undefined,
      }) };

    case 'knowledge.space.create':
      return client.createKnowledgeSpace(
        params.name as string,
        params.description as string,
        params.type as any,
      );

    case 'knowledge.card.create':
      return client.createKnowledgeCard(
        params.spaceId as string,
        params.type as string,
        params.title as string,
        params.content as string,
        params.options as any,
      );

    case 'knowledge.card.link':
      return client.linkKnowledgeCards(
        params.sourceId as string,
        params.targetId as string,
        params.linkType as string,
        params.strength as number,
      );

    case 'knowledge.graph':
      return client.getKnowledgeGraph(params.spaceId as string);

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}
