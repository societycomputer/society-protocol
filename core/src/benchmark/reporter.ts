/**
 * ProtocolBench — Markdown report formatter.
 */

import type { ProtocolBenchReport, CollectedMetrics, BenchmarkAxis, BenchmarkScenarioResult } from './types.js';

/**
 * Compute percentile from a sorted array of numbers.
 */
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

/**
 * Evaluate collected metrics into a 4-axis scenario result.
 */
export function evaluateScenario(
    scenario: string,
    metrics: CollectedMetrics,
    durationMs: number
): BenchmarkScenarioResult {
    // Task Success
    const totalTasks = metrics.tasks.length;
    const successRate = totalTasks > 0
        ? metrics.tasks.filter(t => t.success).length / totalTasks
        : 1.0;
    const avgQuality = totalTasks > 0
        ? metrics.tasks.reduce((s, t) => s + t.qualityScore, 0) / totalTasks
        : 1.0;

    const taskSuccess: BenchmarkAxis = {
        name: 'Task Success',
        score: (successRate * 0.6 + avgQuality * 0.4),
        metrics: {
            success_rate: successRate,
            avg_quality: avgQuality,
            total_tasks: totalTasks,
        },
    };

    // Latency & Throughput
    const latencies = metrics.messages.map(m => m.latencyMs).sort((a, b) => a - b);
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const throughput = durationMs > 0 ? (metrics.messages.length / (durationMs / 1000)) : 0;

    // Score: p95 < 100ms → 1.0, > 1000ms → 0.0 (log scale)
    const latencyScore = p95 > 0
        ? Math.max(0, Math.min(1, 1 - (Math.log10(p95) - 2) / 1))
        : 1.0;
    const throughputScore = Math.min(1, throughput / 1000); // 1000 msgs/sec = 1.0

    const latencyThroughput: BenchmarkAxis = {
        name: 'Latency & Throughput',
        score: latencyScore * 0.6 + throughputScore * 0.4,
        metrics: {
            p50_ms: p50,
            p95_ms: p95,
            p99_ms: p99,
            throughput_msgs_sec: Math.round(throughput * 100) / 100,
        },
    };

    // Message Overhead
    const totalMessages = metrics.messages.length;
    const totalBytes = metrics.messages.reduce((s, m) => s + m.sizeBytes, 0);
    const msgsPerTask = totalTasks > 0 ? totalMessages / totalTasks : totalMessages;

    // Score: fewer msgs per task is better; < 5 → 1.0, > 50 → 0.0
    const overheadScore = msgsPerTask > 0
        ? Math.max(0, Math.min(1, 1 - (msgsPerTask - 5) / 45))
        : 1.0;

    const messageOverhead: BenchmarkAxis = {
        name: 'Message Overhead',
        score: overheadScore,
        metrics: {
            total_messages: totalMessages,
            total_bytes: totalBytes,
            msgs_per_task: Math.round(msgsPerTask * 100) / 100,
        },
    };

    // Robustness
    const totalFaults = metrics.faults.length;
    const totalRecoveries = metrics.recoveries.length;
    const recoveryRate = totalFaults > 0 ? totalRecoveries / totalFaults : 1.0;
    const avgRecoveryMs = totalRecoveries > 0
        ? metrics.recoveries.reduce((s, r) => s + r.recoveryMs, 0) / totalRecoveries
        : 0;

    // Score: recovery rate * recovery speed factor
    const recoverySpeed = avgRecoveryMs > 0
        ? Math.max(0, Math.min(1, 1 - (avgRecoveryMs - 100) / 900))
        : 1.0;

    const robustness: BenchmarkAxis = {
        name: 'Robustness',
        score: Math.min(recoveryRate, recoverySpeed),
        metrics: {
            total_faults: totalFaults,
            total_recoveries: totalRecoveries,
            recovery_rate: recoveryRate,
            avg_recovery_ms: Math.round(avgRecoveryMs * 100) / 100,
        },
    };

    return {
        scenario,
        duration_ms: durationMs,
        axes: { taskSuccess, latencyThroughput, messageOverhead, robustness },
    };
}

/**
 * Format a ProtocolBench report as markdown for console output.
 */
export function formatBenchmarkReport(report: ProtocolBenchReport): string {
    const lines: string[] = [];
    lines.push(`# ProtocolBench Report — Society Protocol v${report.version}`);
    lines.push(`Date: ${new Date(report.timestamp).toISOString()} | Platform: ${report.platform}`);
    lines.push('');
    lines.push('## Scenarios');
    lines.push('| Scenario | Success | Latency | Overhead | Robustness | Duration |');
    lines.push('|----------|---------|---------|----------|------------|----------|');

    for (const s of report.scenarios) {
        lines.push(
            `| ${s.scenario} ` +
            `| ${(s.axes.taskSuccess.score * 100).toFixed(0)}% ` +
            `| ${(s.axes.latencyThroughput.score * 100).toFixed(0)}% ` +
            `| ${(s.axes.messageOverhead.score * 100).toFixed(0)}% ` +
            `| ${(s.axes.robustness.score * 100).toFixed(0)}% ` +
            `| ${s.duration_ms}ms |`
        );
    }

    lines.push('');
    lines.push('## Aggregate Scores');
    lines.push(
        `Task Success: ${(report.aggregate.taskSuccess * 100).toFixed(0)}% | ` +
        `Latency: ${(report.aggregate.latencyThroughput * 100).toFixed(0)}% | ` +
        `Overhead: ${(report.aggregate.messageOverhead * 100).toFixed(0)}% | ` +
        `Robustness: ${(report.aggregate.robustness * 100).toFixed(0)}%`
    );
    lines.push(`**Overall: ${(report.aggregate.overall * 100).toFixed(0)}%**`);

    return lines.join('\n');
}

/**
 * Compute aggregate scores from scenario results.
 */
export function aggregateScenarios(scenarios: BenchmarkScenarioResult[]): ProtocolBenchReport['aggregate'] {
    const n = scenarios.length || 1;
    const taskSuccess = scenarios.reduce((s, r) => s + r.axes.taskSuccess.score, 0) / n;
    const latencyThroughput = scenarios.reduce((s, r) => s + r.axes.latencyThroughput.score, 0) / n;
    const messageOverhead = scenarios.reduce((s, r) => s + r.axes.messageOverhead.score, 0) / n;
    const robustness = scenarios.reduce((s, r) => s + r.axes.robustness.score, 0) / n;

    // Weighted overall: success 35%, latency 25%, overhead 20%, robustness 20%
    const overall = taskSuccess * 0.35 + latencyThroughput * 0.25 + messageOverhead * 0.20 + robustness * 0.20;

    return { overall, taskSuccess, latencyThroughput, messageOverhead, robustness };
}
