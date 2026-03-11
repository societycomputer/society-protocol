// ─── JSON-RPC Protocol ─────────────────────────────────────────

export interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface RpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
}

export type RpcMessage = RpcResponse | RpcNotification;

// ─── Node Info ─────────────────────────────────────────────────

export interface NodeInfo {
  peerId: string;
  did: string;
  name: string;
  multiaddrs: string[];
}

// ─── Peers & Presence ──────────────────────────────────────────

export interface PeerData {
  did: string;
  peerId?: string;
  name: string;
  status: 'online' | 'busy' | 'running' | 'offline' | 'away';
  reputation?: number;
  trustTier?: string;
  specialties?: string[];
  capabilities?: string[];
  load?: number;
  rooms?: string[];
  lastSeen?: number;
}

// ─── Network Topology ──────────────────────────────────────────

export interface TopologyNode {
  id: string;
  did?: string;
  name: string;
  isSelf: boolean;
  status: string;
  reputation?: number;
}

export interface TopologyEdge {
  source: string;
  target: string;
  transport?: string;
  latency?: number;
  direction?: 'inbound' | 'outbound';
}

export interface TopologySnapshot {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

// ─── Transport ─────────────────────────────────────────────────

export interface TransportInfo {
  multiaddrs: string[];
  connections: ConnectionInfo[];
  bandwidth: BandwidthStats;
  gossipsub: GossipSubInfo;
}

export interface ConnectionInfo {
  peerId: string;
  peerName?: string;
  transport: string;
  direction: 'inbound' | 'outbound';
  latency?: number;
}

export interface BandwidthStats {
  totalIn: number;
  totalOut: number;
  rateIn: number;
  rateOut: number;
}

export interface GossipSubInfo {
  topics: string[];
  meshPeerCount: number;
}

// ─── Chains (CoC) ──────────────────────────────────────────────

export interface ChainData {
  id: string;
  roomId: string;
  goal: string;
  status: string;
  priority: string;
  steps: StepData[];
  createdAt?: number;
}

export interface StepData {
  id: string;
  chainId: string;
  kind: string;
  title: string;
  status: string;
  assignee?: string;
  assigneeName?: string;
  dependsOn: string[];
  result?: string;
}

// ─── Federations ───────────────────────────────────────────────

export interface FederationData {
  id: string;
  name: string;
  did: string;
  description?: string;
  visibility: string;
  governance: string;
  memberCount: number;
  onlineCount: number;
  createdAt?: number;
}

// ─── Missions ──────────────────────────────────────────────────

export interface MissionData {
  id: string;
  roomId: string;
  goal: string;
  status: string;
  chainCount: number;
  workerCount: number;
}

// ─── Knowledge ─────────────────────────────────────────────────

export interface KnowledgeCardData {
  id: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  domain: string[];
  confidence: number;
  author: string;
  createdAt?: number;
}

// ─── Dashboard Snapshot (sent on connect) ──────────────────────

export interface ChatMessageData {
  id: string;
  roomId: string;
  from: string;
  fromName: string;
  fromRole?: string;
  text: string;
  type: 'chat' | 'system' | 'negotiation' | 'step' | 'discovery';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface DashboardSnapshot {
  node: NodeInfo;
  peers: PeerData[];
  rooms: string[];
  chains: ChainData[];
  federations: FederationData[];
  missions: MissionData[];
  messages?: ChatMessageData[];
}
