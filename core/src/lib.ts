/**
 * Society Protocol library entrypoint (side-effect free).
 *
 * Keep this file explicit to avoid ambiguous re-exports.
 */

export {
  generateIdentity,
  restoreIdentity,
  canonicalJson,
  deepCanonicalJson,
  sign,
  verify,
  publicKeyFromDid,
  type Identity,
} from './identity.js';

export { Storage } from './storage.js';
export { P2PNode } from './p2p.js';
export { RoomManager } from './rooms.js';
export { CocEngine } from './coc.js';
export { FederationEngine } from './federation.js';
export { KnowledgePool } from './knowledge.js';
export { SkillsEngine } from './skills/engine.js';
export { SecurityManager } from './security.js';
export { IntegrationEngine } from './integration.js';
export { ProactiveMissionEngine } from './proactive/engine.js';
export { P2PSwarmRegistry } from './proactive/swarm-registry.js';
export { SwarmScheduler } from './proactive/scheduler.js';
export { MissionCheckpointService } from './proactive/checkpoints.js';
export { ResearchWorkerNode } from './workers/research-worker.js';
export { Planner } from './planner.js';
export { ReputationEngine } from './reputation.js';
export { CotStreamEngine } from './cot-stream.js';
export { CapsuleExporter } from './capsules.js';
export { SocietyMCPServer } from './mcp/server.js';
export { MCPBridge } from './bridges/mcp-bridge.js';
export { A2ABridge } from './bridges/a2a-bridge.js';
export { registerNode, resolveNode, stopHeartbeat } from './registry.js';

export {
  createClient,
  society,
  quickStart,
  SocietyClient,
  checkEnvironment,
  VERSION as SDK_VERSION,
} from './sdk/index.js';
