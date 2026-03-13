/**
 * Society Protocol library entrypoint (side-effect free).
 *
 * Keep this file explicit to avoid ambiguous re-exports.
 */

export {
  generateIdentity,
  generateIdentityWithPoW,
  verifyIdentityPoW,
  restoreIdentity,
  canonicalJson,
  deepCanonicalJson,
  sign,
  verify,
  publicKeyFromDid,
  type Identity,
} from './identity.js';

export { Storage } from './storage.js';
export { P2PNode, knowledgeTopic, reputationTopic } from './p2p.js';
export { RoomManager } from './rooms.js';
export { CocEngine } from './coc.js';
export { FederationEngine } from './federation.js';
export {
  KnowledgePool,
  compareVectorClocks,
  mergeVectorClocks,
  tickHLC,
  receiveHLC,
  compareHLC,
  type KnowledgeCard,
  type KnowledgeSpace,
  type HybridLogicalClock,
  type VectorClockOrder,
  type ChatMessage,
  type ContextCompactionConfig,
  type CollectiveUnconscious,
} from './knowledge.js';
export { SkillsEngine } from './skills/engine.js';
export { SecurityManager } from './security.js';
export {
    PromptInjectionDetector,
    SafePromptBuilder,
    InputValidator,
    SafeExpressionEvaluator,
    InputValidationError,
    FIELD_LIMITS,
    type ScanResult,
    type GuardConfig,
} from './prompt-guard.js';
export { IntegrationEngine } from './integration.js';
export { ProactiveMissionEngine } from './proactive/engine.js';
export { P2PSwarmRegistry } from './proactive/swarm-registry.js';
export { SwarmScheduler } from './proactive/scheduler.js';
export { MissionCheckpointService } from './proactive/checkpoints.js';
export { ProactiveWatcher, type ProactiveWatcherConfig, type ProactiveDecision } from './proactive/watcher.js';
export { ResearchWorkerNode } from './workers/research-worker.js';
export { Planner } from './planner.js';
export {
  ReputationEngine,
  type ReputationScore,
  type ReputationObservation,
  type TaskOutcome,
  formatReputationTier,
  isTrusted,
} from './reputation.js';
export { CotStreamEngine } from './cot-stream.js';
export { CapsuleExporter } from './capsules.js';
export { SocietyMCPServer } from './mcp/server.js';
export { MCPBridge } from './bridges/mcp-bridge.js';
export { A2ABridge } from './bridges/a2a-bridge.js';
export { registerNode, resolveNode, stopHeartbeat, generateFriendlyName } from './registry.js';
export { ContentStore, type FileManifest } from './content-store.js';
export {
    createIdentityProof,
    verifyIdentityProof,
    serializeIdentityProof,
    deserializeIdentityProof,
    type IdentityProof,
    type IdentityProofVerifyResult,
} from './identity-proof.js';
export { InMemoryMetricsCollector } from './benchmark/collector.js';
export { evaluateScenario, formatBenchmarkReport, aggregateScenarios } from './benchmark/reporter.js';
export type { ProtocolBenchReport, BenchmarkScenarioResult, MetricsCollector } from './benchmark/types.js';

// Gateway — Demand-driven agent spawning
export { DemandSpawner, DEFAULT_SPAWN_CONFIG } from './gateway/demand-spawner.js';
export { CapabilityRouter } from './gateway/capability-router.js';

// Social Layer
export { SocialEngine } from './social.js';

export {
  createClient,
  society,
  quickStart,
  SocietyClient,
  checkEnvironment,
  VERSION as SDK_VERSION,
} from './sdk/index.js';
