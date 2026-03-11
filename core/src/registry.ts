/**
 * Society Registry Client
 *
 * Registers and resolves node names via a central registry
 * (default: api.society.computer). Federations can run their
 * own registry by setting SOCIETY_REGISTRY_URL.
 */

const REGISTRY_URL = process.env.SOCIETY_REGISTRY_URL || 'https://api.society.computer';
const HEARTBEAT_INTERVAL_MS = 60_000; // 60s

export interface NodeInfo {
    multiaddr: string;
    room: string;
    peerId: string;
    name?: string;
}

export interface ResolvedNode {
    multiaddr: string;
    room: string;
    peerId?: string;
    name?: string;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Register a node name in the registry.
 * Starts a periodic heartbeat to keep the registration alive.
 * Fails silently if registry is unavailable.
 */
export async function registerNode(name: string, info: NodeInfo): Promise<boolean> {
    const registered = await putRegistration(name, info);

    // Start heartbeat to keep registration alive
    if (registered && !heartbeatTimer) {
        heartbeatTimer = setInterval(() => {
            putRegistration(name, info).catch(() => {});
        }, HEARTBEAT_INTERVAL_MS);

        // Don't block process exit
        if (heartbeatTimer.unref) heartbeatTimer.unref();
    }

    return registered;
}

/**
 * Resolve a node name from the registry.
 * Returns null if not found or registry is unavailable.
 */
export async function resolveNode(name: string): Promise<ResolvedNode | null> {
    try {
        const sanitized = encodeURIComponent(name.toLowerCase().trim());
        const res = await fetch(`${REGISTRY_URL}/v1/nodes/${sanitized}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(5_000),
        });

        if (!res.ok) return null;

        const data = await res.json() as Record<string, unknown>;
        if (typeof data.multiaddr !== 'string') return null;

        return {
            multiaddr: data.multiaddr as string,
            room: (data.room as string) || 'lobby',
            peerId: data.peerId as string | undefined,
            name: data.name as string | undefined,
        };
    } catch {
        // Registry unavailable — that's fine
        return null;
    }
}

/**
 * Stop heartbeat (call on shutdown).
 */
export function stopHeartbeat(): void {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

/**
 * Generate a human-friendly name for an agent (adjective-animal).
 */
export function generateFriendlyName(): string {
    const adjectives = [
        'brave', 'calm', 'clever', 'eager', 'fair', 'gentle', 'happy',
        'keen', 'lively', 'noble', 'proud', 'quick', 'sharp', 'swift',
        'warm', 'wise', 'bold', 'bright', 'cosmic', 'daring', 'fierce',
        'golden', 'iron', 'jade', 'lunar', 'mystic', 'neon', 'orbit',
        'pixel', 'quantum', 'ruby', 'solar', 'titan', 'ultra', 'vivid',
    ];
    const animals = [
        'fox', 'owl', 'wolf', 'hawk', 'lynx', 'bear', 'deer', 'hare',
        'crane', 'eagle', 'falcon', 'otter', 'raven', 'tiger', 'whale',
        'cobra', 'dragon', 'gecko', 'jaguar', 'koala', 'lemur', 'manta',
        'narwhal', 'ocelot', 'panda', 'quail', 'robin', 'shark', 'viper',
    ];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const animal = animals[Math.floor(Math.random() * animals.length)];
    return `${adj}-${animal}`;
}

// ─── Internal ────────────────────────────────────────────────────

async function putRegistration(name: string, info: NodeInfo): Promise<boolean> {
    try {
        const sanitized = encodeURIComponent(name.toLowerCase().trim());
        const res = await fetch(`${REGISTRY_URL}/v1/nodes/${sanitized}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                multiaddr: info.multiaddr,
                room: info.room,
                peerId: info.peerId,
                name: info.name || name,
            }),
            signal: AbortSignal.timeout(5_000),
        });
        return res.ok;
    } catch {
        return false;
    }
}
