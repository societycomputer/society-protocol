/**
 * Society Protocol — Adapter Host v1.0
 *
 * HTTP bridge between Society P2P network and external AI agents.
 * Features:
 * - RESTful API for adapter registration
 * - Webhook support for push notifications
 * - Automatic step claiming based on capabilities
 * - Health monitoring
 * - SECURITY: API key authentication, rate limiting, CORS, input validation
 */

import express from 'express';
import { ulid } from 'ulid';
import { type Storage } from './storage.js';
import { InputValidator } from './prompt-guard.js';
import { type CocEngine } from './coc.js';
import { EventEmitter } from 'events';
import type { Artifact, AdapterProfile, AdapterCapabilities } from './swp.js';
import { createHash } from 'crypto';

// ─── Security Types ─────────────────────────────────────────────

export interface SecurityConfig {
    // Authentication
    apiKey?: string;                    // Required API key for all requests
    apiKeyHeader?: string;              // Header name (default: X-API-Key)
    
    // Network
    allowedOrigins?: string[];          // CORS origins (default: none = localhost only)
    trustProxy?: boolean;               // Trust X-Forwarded-For headers
    
    // Rate Limiting
    rateLimitEnabled?: boolean;
    rateLimitWindowMs?: number;         // Time window (default: 15 min)
    rateLimitMaxRequests?: number;      // Max requests per window (default: 100)
    
    // Input Validation
    maxBodySize?: string;               // Max request body (default: 10mb)
    
    // Security Headers
    securityHeaders?: boolean;          // Add security headers (default: true)
}

// ─── Types ──────────────────────────────────────────────────────

export interface AdapterConfig {
    port: number;
    host?: string;
    webhookSecret?: string;
    security?: SecurityConfig;
}

export interface AdapterRegistration {
    adapter_id: string;
    profile: AdapterProfile;
    registered_at: number;
    last_heartbeat: number;
    active_tasks: number;
    total_tasks_completed: number;
    health: 'healthy' | 'degraded' | 'unhealthy';
}

interface StepSubmission {
    step_id: string;
    chain_id: string;
    status: 'completed' | 'failed' | 'partial';
    memo: string;
    artifacts: Artifact[];
    metrics?: {
        tokens_used?: number;
        latency_ms?: number;
        cost?: number;
    };
}

// ─── Adapter Host ───────────────────────────────────────────────

// ─── Rate Limiter Implementation ────────────────────────────────

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

class RateLimiter {
    private cache = new Map<string, RateLimitEntry>();
    
    constructor(
        private windowMs: number = 15 * 60 * 1000,  // 15 minutes
        private maxRequests: number = 100
    ) {}

    check(identifier: string): { allowed: boolean; remaining: number; resetTime: number } {
        const now = Date.now();
        const entry = this.cache.get(identifier);
        
        if (!entry || now > entry.resetTime) {
            // New window
            const newEntry: RateLimitEntry = {
                count: 1,
                resetTime: now + this.windowMs
            };
            this.cache.set(identifier, newEntry);
            return { allowed: true, remaining: this.maxRequests - 1, resetTime: newEntry.resetTime };
        }
        
        if (entry.count >= this.maxRequests) {
            return { allowed: false, remaining: 0, resetTime: entry.resetTime };
        }
        
        entry.count++;
        return { allowed: true, remaining: this.maxRequests - entry.count, resetTime: entry.resetTime };
    }

    cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now > entry.resetTime) {
                this.cache.delete(key);
            }
        }
    }
}

// ─── Adapter Host ───────────────────────────────────────────────

export class AdapterHost extends EventEmitter {
    private app = express();
    private server?: ReturnType<express.Application['listen']>;
    private adapters = new Map<string, AdapterRegistration>();
    private stepClaims = new Map<string, string>(); // step_id -> adapter_id
    private healthCheckInterval?: ReturnType<typeof setInterval>;
    private rateLimiter?: RateLimiter;
    private cleanupInterval?: ReturnType<typeof setInterval>;

    constructor(
        private storage: Storage,
        private coc: CocEngine,
        private config: AdapterConfig
    ) {
        super();
        this.setupSecurity();
        this.app.use(express.json({ limit: this.config.security?.maxBodySize || '10mb' }));
        this.setupRoutes();
        this.setupEventListeners();
    }

    /**
     * Setup security middleware
     */
    private setupSecurity(): void {
        const security = this.config.security || {};
        
        // 1. Security Headers
        if (security.securityHeaders !== false) {
            this.app.use((req, res, next) => {
                res.setHeader('X-Content-Type-Options', 'nosniff');
                res.setHeader('X-Frame-Options', 'DENY');
                res.setHeader('X-XSS-Protection', '1; mode=block');
                res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
                res.setHeader('Content-Security-Policy', "default-src 'self'");
                res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
                res.removeHeader('X-Powered-By');
                next();
            });
        }
        
        // 2. CORS - Restrictive by default
        this.app.use((req, res, next) => {
            const origin = req.headers.origin;
            const host = this.config.host || '127.0.0.1';
            
            // Always allow localhost
            const isLocalhost = !origin || 
                origin.startsWith('http://localhost') || 
                origin.startsWith('http://127.0.0.1');
            
            if (isLocalhost) {
                res.setHeader('Access-Control-Allow-Origin', origin || '*');
            } else if (security.allowedOrigins?.includes(origin || '')) {
                res.setHeader('Access-Control-Allow-Origin', origin || '');
            }
            // Otherwise, no CORS headers (browser will block)
            
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
            
            if (req.method === 'OPTIONS') {
                res.sendStatus(204);
                return;
            }
            
            next();
        });
        
        // 3. Rate Limiting
        if (security.rateLimitEnabled !== false) {
            this.rateLimiter = new RateLimiter(
                security.rateLimitWindowMs || 15 * 60 * 1000,
                security.rateLimitMaxRequests || 100
            );
            
            this.app.use((req, res, next) => {
                const identifier = this.getClientIdentifier(req);
                const result = this.rateLimiter!.check(identifier);
                
                // Add rate limit headers
                res.setHeader('X-RateLimit-Limit', security.rateLimitMaxRequests || 100);
                res.setHeader('X-RateLimit-Remaining', result.remaining);
                res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));
                
                if (!result.allowed) {
                    res.status(429).json({
                        error: 'Too many requests',
                        retry_after: Math.ceil((result.resetTime - Date.now()) / 1000)
                    });
                    return;
                }
                
                next();
            });
            
            // Cleanup old entries every 5 minutes
            this.cleanupInterval = setInterval(() => {
                this.rateLimiter?.cleanup();
            }, 5 * 60 * 1000);
        }
        
        // 4. API Key Authentication (if configured)
        if (security.apiKey) {
            const headerName = security.apiKeyHeader || 'x-api-key';
            
            this.app.use((req, res, next) => {
                // Skip auth for health endpoint
                if (req.path === '/health') {
                    next();
                    return;
                }
                
                const providedKey = req.headers[headerName.toLowerCase()] as string;
                
                if (!providedKey) {
                    res.status(401).json({
                        error: 'Authentication required',
                        message: `Provide API key via ${headerName} header`
                    });
                    return;
                }
                
                // Constant-time comparison to prevent timing attacks
                if (!this.constantTimeCompare(providedKey, security.apiKey!)) {
                    res.status(403).json({ error: 'Invalid API key' });
                    return;
                }
                
                next();
            });
        }
        
        // 5. Localhost-only enforcement (default security)
        this.app.use((req, res, next) => {
            const host = this.config.host || '127.0.0.1';
            
            // If configured for localhost only, enforce it
            if (host === '127.0.0.1' || host === 'localhost') {
                const clientIp = this.getClientIp(req);
                const isLocal = clientIp === '127.0.0.1' || 
                               clientIp === '::1' || 
                               clientIp === '::ffff:127.0.0.1';
                
                if (!isLocal && !security.allowedOrigins) {
                    res.status(403).json({
                        error: 'Access denied',
                        message: 'This API is restricted to localhost. Configure allowedOrigins to enable remote access.'
                    });
                    return;
                }
            }
            
            next();
        });
    }

    /**
     * Get client IP address
     */
    private getClientIp(req: express.Request): string {
        const forwarded = req.headers['x-forwarded-for'];
        if (forwarded && this.config.security?.trustProxy) {
            return (forwarded as string).split(',')[0].trim();
        }
        return req.socket.remoteAddress || 'unknown';
    }

    /**
     * Get client identifier for rate limiting
     */
    private getClientIdentifier(req: express.Request): string {
        const apiKey = req.headers['x-api-key'] as string;
        if (apiKey) {
            // Hash API key for privacy
            return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
        }
        return this.getClientIp(req);
    }

    /**
     * Constant-time string comparison to prevent timing attacks
     */
    private constantTimeCompare(a: string, b: string): boolean {
        if (a.length !== b.length) return false;
        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    }

    start(): void {
        const host = this.config.host || '127.0.0.1';
        this.server = this.app.listen(this.config.port, host, () => {
            console.log(`[adapters] Host API listening on http://${host}:${this.config.port}`);
            if (this.config.security?.apiKey) {
                console.log(`[adapters] API key authentication enabled`);
            } else {
                console.log(`[adapters] WARNING: No API key configured - restrict to localhost only!`);
            }
        });

        // Start health check loop
        this.healthCheckInterval = setInterval(() => {
            this.runHealthChecks();
        }, 30000);
    }

    stop(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        if (this.server) {
            this.server.close();
        }
    }

    // ─── Input Sanitization ───────────────────────────────────────

    private getParam(param: string | string[] | undefined): string {
        if (Array.isArray(param)) return param[0] || '';
        return param || '';
    }

    private sanitizeString(input: string, maxLength: number): string {
        if (typeof input !== 'string') return '';
        // Remove control characters and limit length
        return input
            .replace(/[\x00-\x1F\x7F]/g, '')  // Remove control chars
            .replace(/[<>]/g, '')              // Basic XSS prevention
            .trim()
            .slice(0, maxLength);
    }

    private sanitizeUrl(input: string): string | undefined {
        if (typeof input !== 'string') return undefined;
        try {
            const url = new URL(input);
            // Only allow http/https
            if (!['http:', 'https:'].includes(url.protocol)) {
                return undefined;
            }
            // SSRF protection: block private/internal IP ranges
            if (this.isPrivateHost(url.hostname)) {
                return undefined;
            }
            return url.toString();
        } catch {
            return undefined;
        }
    }

    private isPrivateHost(hostname: string): boolean {
        // Block localhost variants
        if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
            return true;
        }
        // Block private IPv4 ranges (RFC 1918) and link-local
        const privateRanges = [
            /^10\./,                          // 10.0.0.0/8
            /^172\.(1[6-9]|2\d|3[01])\./,    // 172.16.0.0/12
            /^192\.168\./,                     // 192.168.0.0/16
            /^169\.254\./,                     // 169.254.0.0/16 (link-local)
            /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 (CGNAT)
            /^0\./,                            // 0.0.0.0/8
            /^::ffff:127\./,                   // IPv4-mapped localhost
            /^fc/i,                            // IPv6 ULA fc00::/7
            /^fd/i,                            // IPv6 ULA
            /^fe80/i,                          // IPv6 link-local
        ];
        return privateRanges.some(re => re.test(hostname));
    }

    // ─── Routes ───────────────────────────────────────────────────

    private setupRoutes(): void {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                version: 'society-1.0.0',
                adapters: this.adapters.size,
                timestamp: Date.now(),
            });
        });

        // Register adapter
        this.app.post('/adapters/register', (req, res) => {
            this.handleRegister(req, res);
        });

        // Get adapter info
        this.app.get('/adapters/:adapter_id', (req, res) => {
            this.handleGetAdapter(req, res);
        });

        // Update adapter capabilities
        this.app.put('/adapters/:adapter_id/capabilities', (req, res) => {
            this.handleUpdateCapabilities(req, res);
        });

        // Send heartbeat
        this.app.post('/adapters/:adapter_id/heartbeat', (req, res) => {
            this.handleHeartbeat(req, res);
        });

        // Poll for pending steps
        this.app.get('/adapters/:adapter_id/steps/pending', (req, res) => {
            this.handlePollPending(req, res);
        });

        // Claim a step (attempt to assign)
        this.app.post('/adapters/:adapter_id/steps/:step_id/claim', (req, res) => {
            this.handleClaimStep(req, res);
        });

        // Submit step result
        this.app.post('/adapters/:adapter_id/steps/:step_id/submit', (req, res) => {
            this.handleSubmitStep(req, res);
        });

        // Get step details
        this.app.get('/steps/:step_id', (req, res) => {
            this.handleGetStep(req, res);
        });

        // List available adapters
        this.app.get('/adapters', (req, res) => {
            this.handleListAdapters(req, res);
        });

        // Metrics endpoint
        this.app.get('/metrics', (req, res) => {
            this.handleMetrics(req, res);
        });
    }

    // ─── Route Handlers ───────────────────────────────────────────

    private handleRegister(req: express.Request, res: express.Response): void {
        const profile: AdapterProfile = req.body;

        // Validate required fields
        if (!profile.display_name || !profile.kinds || profile.kinds.length === 0) {
            res.status(400).json({
                error: 'Missing required fields: display_name, kinds',
                required: ['display_name', 'kinds', 'runtime'],
            });
            return;
        }

        // Input sanitization
        const sanitizedProfile: AdapterProfile = {
            ...profile,
            display_name: this.sanitizeString(profile.display_name, 100),
            description: profile.description ? this.sanitizeString(profile.description, 500) : undefined,
            endpoint: profile.endpoint ? (this.sanitizeUrl(profile.endpoint) || '') : '',
            kinds: profile.kinds.map(k => this.sanitizeString(k, 50)).filter(k => k),
            specialties: profile.specialties?.map(s => this.sanitizeString(s, 50)).filter(s => s) || [],
        };

        // Validate kinds
        const validKinds = ['task', 'review', 'merge', 'decision', 'synthesis', 'verification'];
        const invalidKinds = sanitizedProfile.kinds.filter(k => !validKinds.includes(k));
        if (invalidKinds.length > 0) {
            res.status(400).json({
                error: `Invalid kinds: ${invalidKinds.join(', ')}`,
                valid_kinds: validKinds,
            });
            return;
        }

        // Validate runtime
        const validRuntimes = ['claude-code', 'nanobot', 'ollama', 'openai', 'custom', 'docker'];
        if (!validRuntimes.includes(sanitizedProfile.runtime)) {
            res.status(400).json({
                error: `Invalid runtime: ${sanitizedProfile.runtime}`,
                valid_runtimes: validRuntimes,
            });
            return;
        }

        const adapterId = `adapter_${ulid()}`;
        const registration: AdapterRegistration = {
            adapter_id: adapterId,
            profile: { ...sanitizedProfile, adapter_id: adapterId },
            registered_at: Date.now(),
            last_heartbeat: Date.now(),
            active_tasks: 0,
            total_tasks_completed: 0,
            health: 'healthy',
        };

        this.adapters.set(adapterId, registration);

        // Store in persistent storage
        this.storage.registerAdapter(
            adapterId,
            profile.runtime,
            profile.display_name,
            profile.specialties || [],
            profile.kinds,
            profile.max_concurrency || 1,
            profile.endpoint || '',
            profile.auth_type || 'none',
            {
                ownerDid: profile.owner_did,
                roomId: profile.room_id,
                missionTags: profile.mission_tags,
                health: 'healthy',
                hostId: profile.host_id,
                peerId: profile.peer_id,
            }
        );

        this.emit('adapter:registered', adapterId, profile);

        res.status(201).json({
            adapter_id: adapterId,
            status: 'registered',
            message: 'Adapter registered successfully',
        });
    }

    private handleGetAdapter(req: express.Request, res: express.Response): void {
        const adapter_id = this.getParam(req.params.adapter_id);
        const adapter = this.adapters.get(adapter_id);

        if (!adapter) {
            res.status(404).json({ error: 'Adapter not found' });
            return;
        }

        res.json({
            ...adapter,
            uptime_ms: Date.now() - adapter.registered_at,
        });
    }

    private handleUpdateCapabilities(req: express.Request, res: express.Response): void {
        const adapter_id = this.getParam(req.params.adapter_id);
        const capabilities: Partial<AdapterCapabilities> = req.body;

        const adapter = this.adapters.get(adapter_id);
        if (!adapter) {
            res.status(404).json({ error: 'Adapter not found' });
            return;
        }

        // Update capabilities
        adapter.profile = {
            ...adapter.profile,
            ...capabilities,
        };

        res.json({ status: 'updated', adapter_id });
    }

    private handleHeartbeat(req: express.Request, res: express.Response): void {
        const adapter_id = this.getParam(req.params.adapter_id);
        const { active_tasks, queue_depth, metrics } = req.body;

        const adapter = this.adapters.get(adapter_id);
        if (!adapter) {
            res.status(404).json({ error: 'Adapter not found' });
            return;
        }

        adapter.last_heartbeat = Date.now();
        
        if (active_tasks !== undefined) {
            adapter.active_tasks = active_tasks;
        }

        // Update health status
        if (queue_depth > 10 || (metrics?.success_rate !== undefined && metrics.success_rate < 0.5)) {
            adapter.health = 'degraded';
        } else {
            adapter.health = 'healthy';
        }

        this.storage.updateAdapterHeartbeat(
            adapter_id,
            adapter.health,
            queue_depth || 0,
            metrics?.success_rate
        );

        res.json({ status: 'ok', timestamp: Date.now() });
    }

    private handlePollPending(req: express.Request, res: express.Response): void {
        const adapter_id = this.getParam(req.params.adapter_id);
        const limit = parseInt(req.query.limit as string) || 10;

        const adapter = this.adapters.get(adapter_id);
        if (!adapter) {
            res.status(404).json({ error: 'Adapter not found' });
            return;
        }

        // Find steps that match adapter capabilities
        const steps = this.findMatchingSteps(adapter, limit);

        res.json({
            steps: steps.map(s => ({
                step_id: s.step_id,
                chain_id: s.chain_id,
                kind: s.kind,
                title: s.title,
                description: s.description,
                requirements: s.requirements,
                timeout_ms: s.timeout_ms,
            })),
            adapter: {
                id: adapter_id,
                active_tasks: adapter.active_tasks,
                health: adapter.health,
            },
        });
    }

    private handleClaimStep(req: express.Request, res: express.Response): void {
        const adapter_id = this.getParam(req.params.adapter_id);
        const step_id = this.getParam(req.params.step_id);
        const { lease_ms } = req.body;

        const adapter = this.adapters.get(adapter_id);
        if (!adapter) {
            res.status(404).json({ error: 'Adapter not found' });
            return;
        }

        // Check if step is already claimed
        if (this.stepClaims.has(step_id)) {
            res.status(409).json({
                error: 'Step already claimed',
                claimed_by: this.stepClaims.get(step_id),
            });
            return;
        }

        // Get step info
        const step = this.storage.db
            .prepare('SELECT * FROM coc_steps WHERE step_id = ? AND status = ?')
            .get(step_id, 'proposed') as { kind: string; chain_id: string } | undefined;

        if (!step) {
            res.status(404).json({ error: 'Step not found or not available' });
            return;
        }

        // Check if adapter can handle this step kind
        if (!adapter.profile.kinds.includes(step.kind)) {
            res.status(400).json({
                error: 'Adapter cannot handle this step kind',
                step_kind: step.kind,
                adapter_kinds: adapter.profile.kinds,
            });
            return;
        }

        // Claim the step
        this.stepClaims.set(step_id, adapter_id);
        adapter.active_tasks++;

        // Emit to CoC engine for assignment
        this.coc.emit('adapter:lease_request', {
            chain_id: step.chain_id,
            step_id,
            adapter_id,
            worker_did: adapter.profile.owner_did || adapter_id,
            lease_ms: lease_ms || 120000,
        });

        res.json({
            status: 'claimed',
            step_id,
            chain_id: step.chain_id,
            lease_expires_at: Date.now() + (lease_ms || 120000),
        });
    }

    private handleSubmitStep(req: express.Request, res: express.Response): void {
        const adapter_id = this.getParam(req.params.adapter_id);
        const step_id = this.getParam(req.params.step_id);
        const submission: StepSubmission = req.body;

        const adapter = this.adapters.get(adapter_id);
        if (!adapter) {
            res.status(404).json({ error: 'Adapter not found' });
            return;
        }

        // Verify adapter owns this step
        if (this.stepClaims.get(step_id) !== adapter_id) {
            res.status(403).json({ error: 'Step not claimed by this adapter' });
            return;
        }

        // Get step info
        const step = this.storage.db
            .prepare('SELECT * FROM coc_steps WHERE step_id = ?')
            .get(step_id) as any;

        if (!step) {
            res.status(404).json({ error: 'Step not found' });
            return;
        }

        // Release claim
        this.stepClaims.delete(step_id);
        adapter.active_tasks = Math.max(0, adapter.active_tasks - 1);
        
        if (submission.status === 'completed') {
            adapter.total_tasks_completed++;
        }

        // Validate memo against prompt injection
        let validatedMemo = submission.memo;
        try {
            const validator = new InputValidator();
            if (validatedMemo) validatedMemo = validator.validateMemo(validatedMemo);
        } catch { /* log but don't block submission */ }

        // Emit to CoC engine
        this.coc.emit('adapter:submit_request', {
            chain_id: step.chain_id,
            step_id,
            assignee_did: adapter.profile.owner_did || adapter_id,
            adapter_id,
            status: submission.status,
            memo: validatedMemo,
            artifacts: submission.artifacts,
            metrics: submission.metrics,
        });

        res.json({
            status: 'submitted',
            step_id,
            chain_id: step.chain_id,
        });
    }

    private handleGetStep(req: express.Request, res: express.Response): void {
        const step_id = this.getParam(req.params.step_id);

        const step = this.storage.db
            .prepare('SELECT * FROM coc_steps WHERE step_id = ?')
            .get(step_id) as any;

        if (!step) {
            res.status(404).json({ error: 'Step not found' });
            return;
        }

        res.json({
            step_id: step.step_id,
            chain_id: step.chain_id,
            kind: step.kind,
            title: step.title,
            description: step.description,
            status: step.status,
            assignee_did: step.assignee_did,
            depends_on: JSON.parse(step.depends_on || '[]'),
            requirements: step.requirements_json ? JSON.parse(step.requirements_json) : undefined,
        });
    }

    private handleListAdapters(req: express.Request, res: express.Response): void {
        const filterKind = req.query.kind as string;
        
        let adapters = Array.from(this.adapters.values());
        
        if (filterKind) {
            adapters = adapters.filter(a => a.profile.kinds.includes(filterKind));
        }

        res.json({
            adapters: adapters.map(a => ({
                adapter_id: a.adapter_id,
                display_name: a.profile.display_name,
                runtime: a.profile.runtime,
                kinds: a.profile.kinds,
                specialties: a.profile.specialties,
                active_tasks: a.active_tasks,
                health: a.health,
                last_heartbeat: a.last_heartbeat,
            })),
            total: adapters.length,
        });
    }

    private handleMetrics(req: express.Request, res: express.Response): void {
        const stats = {
            total_adapters: this.adapters.size,
            healthy_adapters: 0,
            degraded_adapters: 0,
            total_active_tasks: 0,
            total_completed_tasks: 0,
            steps_claimed: this.stepClaims.size,
        };

        for (const adapter of this.adapters.values()) {
            if (adapter.health === 'healthy') stats.healthy_adapters++;
            else stats.degraded_adapters++;
            
            stats.total_active_tasks += adapter.active_tasks;
            stats.total_completed_tasks += adapter.total_tasks_completed;
        }

        res.json(stats);
    }

    // ─── Helpers ──────────────────────────────────────────────────

    private setupEventListeners(): void {
        // Listen for step unlocks to notify matching adapters
        this.coc.on('step:unlocked', (chainId: string, stepId: string, step: any) => {
            this.notifyMatchingAdapters(step);
        });

        // Clean up claims when steps complete or fail
        this.coc.on('step:submitted', (chainId: string, stepId: string) => {
            const adapterId = this.stepClaims.get(stepId);
            if (adapterId) {
                const adapter = this.adapters.get(adapterId);
                if (adapter) {
                    adapter.active_tasks = Math.max(0, adapter.active_tasks - 1);
                }
                this.stepClaims.delete(stepId);
            }
        });
    }

    private findMatchingSteps(adapter: AdapterRegistration, limit: number): any[] {
        // Query for proposed steps matching adapter capabilities
        const kinds = adapter.profile.kinds;
        const specialties = adapter.profile.specialties || [];

        // Build query to find matching steps
        const placeholders = kinds.map(() => '?').join(',');
        const query = `
            SELECT * FROM coc_steps 
            WHERE status = 'proposed' 
            AND kind IN (${placeholders})
            ORDER BY created_at DESC
            LIMIT ?
        `;

        return this.storage.db.prepare(query).all(...kinds, limit);
    }

    private notifyMatchingAdapters(step: any): void {
        // Find adapters that can handle this step
        for (const [adapterId, adapter] of this.adapters) {
            if (adapter.profile.kinds.includes(step.kind)) {
                // Check specialties match if required
                if (step.requirements?.capabilities) {
                    const hasCapability = step.requirements.capabilities.some((cap: string) =>
                        adapter.profile.specialties?.includes(cap)
                    );
                    if (!hasCapability) continue;
                }

                // Send webhook notification if endpoint configured
                if (adapter.profile.endpoint) {
                    this.sendWebhookNotification(adapter, step);
                }
            }
        }
    }

    private async sendWebhookNotification(adapter: AdapterRegistration, step: any): Promise<void> {
        try {
            await fetch(adapter.profile.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.webhookSecret && {
                        'X-Webhook-Secret': this.config.webhookSecret,
                    }),
                },
                body: JSON.stringify({
                    type: 'step_available',
                    step: {
                        step_id: step.step_id,
                        chain_id: step.chain_id,
                        kind: step.kind,
                        title: step.title,
                        description: step.description,
                    },
                    timestamp: Date.now(),
                }),
            });
        } catch (err) {
            // Webhook failed, ignore
            if (process.env.SOCIETY_DEBUG) {
                console.debug(`[adapters] Webhook failed for ${adapter.adapter_id}:`, err);
            }
        }
    }

    private runHealthChecks(): void {
        const now = Date.now();
        const timeout = 2 * 60 * 1000; // 2 minutes

        for (const [adapterId, adapter] of this.adapters) {
            if (now - adapter.last_heartbeat > timeout) {
                adapter.health = 'unhealthy';
                
                // Release any claimed steps
                for (const [stepId, claimedAdapter] of this.stepClaims) {
                    if (claimedAdapter === adapterId) {
                        this.stepClaims.delete(stepId);
                        adapter.active_tasks = Math.max(0, adapter.active_tasks - 1);
                        
                        // Emit step expiry
                        this.coc.emit('step:expired', null, stepId, adapterId);
                    }
                }
            }
        }
    }

    // ─── Public API ───────────────────────────────────────────────

    getAdapter(adapterId: string): AdapterRegistration | undefined {
        return this.adapters.get(adapterId);
    }

    getActiveAdapters(): AdapterRegistration[] {
        return Array.from(this.adapters.values()).filter(
            a => a.health === 'healthy' && a.active_tasks < (a.profile.max_concurrency || 1)
        );
    }

    getStats(): {
        totalAdapters: number;
        healthyAdapters: number;
        totalActiveTasks: number;
        stepsClaimed: number;
    } {
        return {
            totalAdapters: this.adapters.size,
            healthyAdapters: Array.from(this.adapters.values()).filter(a => a.health === 'healthy').length,
            totalActiveTasks: Array.from(this.adapters.values()).reduce((sum, a) => sum + a.active_tasks, 0),
            stepsClaimed: this.stepClaims.size,
        };
    }
}
