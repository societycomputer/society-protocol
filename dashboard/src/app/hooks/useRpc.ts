/**
 * Higher-level RPC helpers for common operations.
 */

import { useCallback } from 'react';
import { useSocket } from './useSocket';
import type {
  TopologySnapshot,
  TransportInfo,
  ChainData,
  MissionData,
  KnowledgeCardData,
} from '../../shared/types';

export function useRpc() {
  const { connected, rpc } = useSocket();

  const refreshTopology = useCallback(async (roomId?: string): Promise<TopologySnapshot> => {
    return rpc('topology.snapshot', { roomId }) as Promise<TopologySnapshot>;
  }, [rpc]);

  const refreshTransport = useCallback(async (): Promise<TransportInfo> => {
    return rpc('transport.info') as Promise<TransportInfo>;
  }, [rpc]);

  const refreshChains = useCallback(async (roomId?: string): Promise<ChainData[]> => {
    return rpc('coc.list', { roomId }) as Promise<ChainData[]>;
  }, [rpc]);

  const summon = useCallback(async (goal: string, roomId: string, template?: string, priority?: string) => {
    return rpc('coc.summon', { goal, roomId, template, priority });
  }, [rpc]);

  const submitStep = useCallback(async (stepId: string, output: string, status = 'completed') => {
    return rpc('coc.submitStep', { stepId, output, status });
  }, [rpc]);

  const reviewStep = useCallback(async (stepId: string, decision: string, notes = '') => {
    return rpc('coc.reviewStep', { stepId, decision, notes });
  }, [rpc]);

  const joinRoom = useCallback(async (roomId: string) => {
    return rpc('rooms.join', { roomId });
  }, [rpc]);

  const listTemplates = useCallback(async () => {
    return rpc('templates.list') as Promise<any[]>;
  }, [rpc]);

  const getReputation = useCallback(async (did?: string) => {
    return rpc('reputation.get', { did });
  }, [rpc]);

  const refreshMissions = useCallback(async (roomId?: string): Promise<MissionData[]> => {
    return rpc('mission.list', { roomId }) as Promise<MissionData[]>;
  }, [rpc]);

  const startMission = useCallback(async (spec: any) => {
    return rpc('mission.start', { spec });
  }, [rpc]);

  const stopMission = useCallback(async (missionId: string, reason?: string) => {
    return rpc('mission.stop', { missionId, reason });
  }, [rpc]);

  const createFederation = useCallback(async (name: string, description: string, visibility: string) => {
    return rpc('federation.create', { name, description, visibility });
  }, [rpc]);

  const refreshFederations = useCallback(async () => {
    return rpc('federation.list') as Promise<any[]>;
  }, [rpc]);

  const createKnowledgeSpace = useCallback(async (name: string, description: string, type = 'team') => {
    return rpc('knowledge.space.create', { name, description, type });
  }, [rpc]);

  const createKnowledgeCard = useCallback(async (
    spaceId: string, type: string, title: string, content: string,
    options?: { summary?: string; tags?: string[]; domain?: string[]; confidence?: number },
  ) => {
    return rpc('knowledge.card.create', { spaceId, type, title, content, options });
  }, [rpc]);

  const queryKnowledge = useCallback(async (query: string, options?: any) => {
    return rpc('knowledge.query', { query, ...options });
  }, [rpc]);

  return {
    connected,
    rpc,
    refreshTopology,
    refreshTransport,
    refreshChains,
    summon,
    submitStep,
    reviewStep,
    joinRoom,
    listTemplates,
    getReputation,
    refreshMissions,
    startMission,
    stopMission,
    createFederation,
    refreshFederations,
    createKnowledgeSpace,
    createKnowledgeCard,
    queryKnowledge,
  };
}
