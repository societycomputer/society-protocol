import type {
    MemoryQueryInput,
    MemoryQueryResult,
    PersonaEdge,
    PersonaNode,
    ScoreBreakdown,
} from './types.js';

const LEXICAL_WEIGHT = 0.4;
const VECTOR_WEIGHT = 0.35;
const GRAPH_WEIGHT = 0.25;

function normalize(text: string): string {
    return text.toLowerCase().trim();
}

function tokenize(text: string): string[] {
    return normalize(text)
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function tokenOverlapScore(query: string, haystack: string): number {
    if (!query) return 0;
    const q = new Set(tokenize(query));
    if (q.size === 0) return 0;
    const h = new Set(tokenize(haystack));
    let match = 0;
    for (const token of q) {
        if (h.has(token)) match += 1;
    }
    return match / q.size;
}

function trigramVector(text: string): Record<string, number> {
    const src = normalize(text).replace(/\s+/g, ' ');
    const vec: Record<string, number> = {};
    for (let i = 0; i < src.length - 2; i++) {
        const tri = src.slice(i, i + 3);
        vec[tri] = (vec[tri] || 0) + 1;
    }
    return vec;
}

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (const k of keys) {
        const va = a[k] || 0;
        const vb = b[k] || 0;
        dot += va * vb;
        na += va * va;
        nb += vb * vb;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function computePersonalizedPageRank(nodes: PersonaNode[], edges: PersonaEdge[]): Map<string, number> {
    const score = new Map<string, number>();
    const degree = new Map<string, number>();

    for (const node of nodes) {
        score.set(node.id, 1);
        degree.set(node.id, 0);
    }

    for (const edge of edges) {
        if (edge.deletedAt) continue;
        degree.set(edge.sourceNodeId, (degree.get(edge.sourceNodeId) || 0) + edge.weight);
        degree.set(edge.targetNodeId, (degree.get(edge.targetNodeId) || 0) + edge.weight);
    }

    // Lightweight personalized PageRank approximation with 3 power iterations.
    for (let i = 0; i < 3; i++) {
        const next = new Map<string, number>();
        for (const node of nodes) {
            next.set(node.id, 0.15);
        }
        for (const edge of edges) {
            if (edge.deletedAt) continue;
            const srcDeg = degree.get(edge.sourceNodeId) || 1;
            const srcScore = score.get(edge.sourceNodeId) || 0;
            const delta = 0.85 * srcScore * (edge.weight / srcDeg) * (edge.confidence || 1);
            next.set(edge.targetNodeId, (next.get(edge.targetNodeId) || 0) + delta);
        }
        score.clear();
        for (const [k, v] of next.entries()) {
            score.set(k, v);
        }
    }

    const max = Math.max(...Array.from(score.values()), 1);
    for (const [k, v] of score.entries()) {
        score.set(k, v / max);
    }

    return score;
}

export function rankMemories(
    nodes: PersonaNode[],
    edges: PersonaEdge[],
    query: MemoryQueryInput,
    options: {
        graphRank?: Map<string, number>;
    } = {}
): MemoryQueryResult {
    const started = Date.now();
    const graphRank = options.graphRank || computePersonalizedPageRank(nodes, edges);
    const queryText = query.query || '';
    const qVec = trigramVector(queryText);

    const ranked = nodes
        .map((node) => {
            const lexical = tokenOverlapScore(queryText, `${node.title} ${node.content} ${(node.tags || []).join(' ')}`);
            const vector = queryText
                ? cosineSimilarity(qVec, trigramVector(`${node.title} ${node.content}`))
                : 0;
            const graph = graphRank.get(node.id) || 0;
            const final = LEXICAL_WEIGHT * lexical + VECTOR_WEIGHT * vector + GRAPH_WEIGHT * graph;

            const scoreBreakdown: ScoreBreakdown = {
                lexical,
                vector,
                graph,
                final,
            };

            return {
                ...node,
                score: final,
                scoreBreakdown,
            };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, query.limit || 20);

    return {
        nodes: ranked,
        elapsedMs: Date.now() - started,
    };
}
