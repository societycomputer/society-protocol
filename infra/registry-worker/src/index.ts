/**
 * Society Registry — Cloudflare Worker
 *
 * Simple name → multiaddr registry for Society Protocol.
 * Nodes register a friendly name, others resolve it to connect.
 *
 * Endpoints:
 *   PUT  /v1/nodes/:name  — register/update (TTL: 5 min, heartbeat renews)
 *   GET  /v1/nodes/:name  — resolve name → connection info
 *   GET  /v1/nodes        — list all registered nodes
 *   GET  /health          — health check
 *
 * Deploy:
 *   wrangler kv namespace create NODES
 *   # update wrangler.toml with the KV ID
 *   wrangler deploy
 */

export interface Env {
	NODES: KVNamespace;
}

interface NodeRecord {
	multiaddr: string;
	room: string;
	peerId: string;
	name: string;
	registeredAt: string;
}

const TTL_SECONDS = 300; // 5 minutes — heartbeat renews

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// Health check
		if (path === '/health') {
			return json({ status: 'ok', service: 'society-registry' });
		}

		// PUT /v1/nodes/:name — register
		const putMatch = path.match(/^\/v1\/nodes\/([a-zA-Z0-9_-]+)$/);
		if (request.method === 'PUT' && putMatch) {
			const name = putMatch[1].toLowerCase();

			let body: Record<string, unknown>;
			try {
				body = await request.json() as Record<string, unknown>;
			} catch {
				return json({ error: 'Invalid JSON body' }, 400);
			}

			if (!body.multiaddr || typeof body.multiaddr !== 'string') {
				return json({ error: 'multiaddr is required' }, 400);
			}

			const record: NodeRecord = {
				multiaddr: body.multiaddr as string,
				room: (body.room as string) || 'lobby',
				peerId: (body.peerId as string) || '',
				name: (body.name as string) || name,
				registeredAt: new Date().toISOString(),
			};

			await env.NODES.put(name, JSON.stringify(record), {
				expirationTtl: TTL_SECONDS,
			});

			return json({ ok: true, name, expiresIn: TTL_SECONDS });
		}

		// GET /v1/nodes/:name — resolve
		if (request.method === 'GET' && putMatch) {
			const name = putMatch[1].toLowerCase();
			const value = await env.NODES.get(name);

			if (!value) {
				return json({ error: 'Not found' }, 404);
			}

			const record: NodeRecord = JSON.parse(value);
			return json(record);
		}

		// GET /v1/nodes — list all
		if (request.method === 'GET' && path === '/v1/nodes') {
			const list = await env.NODES.list({ limit: 100 });
			const nodes: Array<{ name: string; data: NodeRecord }> = [];

			for (const key of list.keys) {
				const value = await env.NODES.get(key.name);
				if (value) {
					nodes.push({ name: key.name, data: JSON.parse(value) });
				}
			}

			return json({ nodes, count: nodes.length });
		}

		return json({ error: 'Not found' }, 404);
	},
} satisfies ExportedHandler<Env>;
