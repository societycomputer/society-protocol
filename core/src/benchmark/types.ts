/**
 * ProtocolBench — Types for multi-axis protocol evaluation.
 * Based on: ProtocolBench (arxiv 2504.14476)
 */

export interface BenchmarkAxis {
    name: string;
    score: number;         // 0-1 normalized
    metrics: Record<string, number>;
}

export interface BenchmarkScenarioResult {
    scenario: string;
    duration_ms: number;
    axes: {
        taskSuccess: BenchmarkAxis;
        latencyThroughput: BenchmarkAxis;
        messageOverhead: BenchmarkAxis;
        robustness: BenchmarkAxis;
    };
}

export interface ProtocolBenchReport {
    version: string;
    timestamp: number;
    platform: string;
    scenarios: BenchmarkScenarioResult[];
    aggregate: {
        overall: number;
        taskSuccess: number;
        latencyThroughput: number;
        messageOverhead: number;
        robustness: number;
    };
}

export interface CollectedMetrics {
    messages: { type: string; sizeBytes: number; latencyMs: number; timestamp: number }[];
    tasks: { success: boolean; qualityScore: number; timestamp: number }[];
    faults: { type: string; timestamp: number }[];
    recoveries: { type: string; recoveryMs: number; timestamp: number }[];
}

export interface MetricsCollector {
    recordMessage(type: string, sizeBytes: number, latencyMs: number): void;
    recordTaskCompletion(success: boolean, qualityScore?: number): void;
    recordFault(type: string): void;
    recordRecovery(type: string, recoveryMs: number): void;
    snapshot(): CollectedMetrics;
    reset(): void;
}
