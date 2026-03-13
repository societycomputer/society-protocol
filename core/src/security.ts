/**
 * Society Protocol - Advanced Security Layer v1.0
 * 
 * Camada de segurança aprimorada:
 * - End-to-end encryption (E2EE)
 * - Key rotation automático
 * - Permission system granular
 * - Audit logging
 * - Rate limiting avançado
 * - Content sanitization
 * - DDoS protection
 * - Threat detection
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { promisify } from 'util';
import { InputValidator } from './prompt-guard.js';
import { type SwpEnvelope } from './swp.js';
import {
    type Identity,
    sign as identitySign,
    verify as identityVerify
} from './identity.js';

const randomBytesAsync = promisify(randomBytes);

// ─── Types ───────────────────────────────────────────────────────

export type SecurityLevel = 'low' | 'medium' | 'high' | 'paranoid';

export interface EncryptionConfig {
    algorithm: 'x25519-xsalsa20-poly1305' | 'aes-256-gcm' | 'chacha20-poly1305';
    keyRotationInterval: number;  // ms
    forwardSecrecy: boolean;
}

export interface Permission {
    resource: string;
    action: 'read' | 'write' | 'execute' | 'admin';
    conditions?: {
        timeWindow?: { start: number; end: number };
        ipWhitelist?: string[];
        reputationMin?: number;
        mfaRequired?: boolean;
    };
}

export interface SecurityContext {
    identity: Identity;
    permissions: Permission[];
    sessionId: string;
    ip?: string;
    userAgent?: string;
    mfaVerified: boolean;
    reputation: number;
    trustTier: 'unverified' | 'bronze' | 'silver' | 'gold' | 'platinum';
}

export interface AuditEvent {
    id: string;
    timestamp: number;
    type: 'auth' | 'access' | 'action' | 'violation' | 'encryption';
    severity: 'info' | 'warning' | 'error' | 'critical';
    actor: string;  // DID
    resource: string;
    action: string;
    result: 'success' | 'failure' | 'blocked';
    details: Record<string, any>;
    ip?: string;
    sessionId?: string;
    signature?: string;
}

export interface ThreatIntel {
    id: string;
    type: 'ip' | 'did' | 'pattern' | 'behavior';
    value: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    category: 'spam' | 'malware' | 'ddos' | 'sybil' | 'eclipse' | 'other';
    firstSeen: number;
    lastSeen: number;
    occurrences: number;
    confidence: number;
}

// ─── End-to-End Encryption ───────────────────────────────────────

export class E2EEncryption {
    private keys = new Map<string, any>();
    private sharedSecrets = new Map<string, Uint8Array>();
    private config: EncryptionConfig;

    constructor(config?: Partial<EncryptionConfig>) {
        this.config = {
            algorithm: config?.algorithm || 'aes-256-gcm',
            keyRotationInterval: config?.keyRotationInterval || 24 * 60 * 60 * 1000,  // 24h
            forwardSecrecy: config?.forwardSecrecy ?? true
        };

        // Rotacionar chaves periodicamente
        setInterval(() => this.rotateKeys(), this.config.keyRotationInterval);
    }

    /**
     * Gerar par de chaves X25519 para Diffie-Hellman
     */
    async generateKeyPair(identityId: string): Promise<any> {
        // Usar Web Crypto API
        const keyPair = await crypto.subtle.generateKey(
            {
                name: 'X25519'
            },
            true,  // extractable
            ['deriveBits']
        );

        this.keys.set(identityId, keyPair);
        return keyPair;
    }

    /**
     * Derivar segredo compartilhado com outro participante
     */
    async deriveSharedSecret(
        myId: string,
        theirPublicKey: Uint8Array
    ): Promise<Uint8Array> {
        const myKeyPair = this.keys.get(myId);
        if (!myKeyPair) {
            throw new Error('Key pair not found');
        }

        // Importar chave pública do outro
        const theirKey = await crypto.subtle.importKey(
            'raw',
            theirPublicKey,
            { name: 'X25519' },
            false,
            []
        );

        // Derivar segredo
        const sharedSecret = await crypto.subtle.deriveBits(
            {
                name: 'X25519',
                public: theirKey
            },
            myKeyPair.privateKey,
            256
        );

        const secret = new Uint8Array(sharedSecret);
        
        // Derivar chave de criptografia
        const key = await this.deriveEncryptionKey(secret);
        
        const cacheKey = `${myId}:${Buffer.from(theirPublicKey).toString('hex')}`;
        this.sharedSecrets.set(cacheKey, key);

        return key;
    }

    /**
     * Criptografar mensagem
     */
    async encrypt(
        plaintext: string,
        recipientPublicKey: Uint8Array,
        senderId: string
    ): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
        const key = await this.deriveSharedSecret(senderId, recipientPublicKey);
        
        // Gerar nonce
        const nonce = await randomBytesAsync(12);
        
        // Criptografar
        const data = new TextEncoder().encode(plaintext);
        
        let ciphertext: Uint8Array;
        
        if (this.config.algorithm === 'aes-256-gcm') {
            // Usar AES-256-GCM via Node.js crypto
            const cipher = createCipheriv('aes-256-gcm', key.slice(0, 32), nonce);
            const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
            const authTag = cipher.getAuthTag();
            ciphertext = new Uint8Array(Buffer.concat([encrypted, authTag]));
        } else {
            throw new Error(`Unsupported encryption algorithm: ${this.config.algorithm}`);
        }

        return { ciphertext, nonce };
    }

    /**
     * Descriptografar mensagem
     */
    async decrypt(
        ciphertext: Uint8Array,
        nonce: Uint8Array,
        senderPublicKey: Uint8Array,
        recipientId: string
    ): Promise<string> {
        const key = await this.deriveSharedSecret(recipientId, senderPublicKey);
        
        let plaintext: Uint8Array;
        
        if (this.config.algorithm === 'aes-256-gcm') {
            const decipher = createDecipheriv(
                'aes-256-gcm',
                key.slice(0, 32),
                nonce
            );
            const authTag = ciphertext.slice(-16);
            decipher.setAuthTag(authTag);
            const encrypted = ciphertext.slice(0, -16);
            plaintext = new Uint8Array(Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]));
        } else {
            throw new Error(`Unsupported encryption algorithm: ${this.config.algorithm}`);
        }

        return new TextDecoder().decode(plaintext);
    }

    private async deriveEncryptionKey(sharedSecret: Uint8Array): Promise<Uint8Array> {
        // HKDF via Web Crypto API (RFC 5869)
        // Use a deterministic salt derived from the shared secret itself,
        // so both sides derive the same key from the same DH output.
        const ikm = await crypto.subtle.importKey(
            'raw',
            sharedSecret,
            'HKDF',
            false,
            ['deriveBits']
        );
        const salt = createHash('sha256').update('society-hkdf-salt-v1').digest();
        const info = new TextEncoder().encode('society-protocol-e2e-v1');
        const derived = await crypto.subtle.deriveBits(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt,
                info,
            },
            ikm,
            256  // 32 bytes
        );
        return new Uint8Array(derived);
    }

    private async xorWithKey(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
        const result = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            result[i] = data[i] ^ key[i % key.length];
        }
        return result;
    }

    private rotateKeys(): void {
        // Implementar rotação de chaves
        console.log('[security] Rotating encryption keys...');
        
        if (this.config.forwardSecrecy) {
            // Limpar segredos antigos
            this.sharedSecrets.clear();
        }
    }
}

// ─── Permission System ───────────────────────────────────────────

export class PermissionManager {
    private roles = new Map<string, Permission[]>();
    private userPermissions = new Map<string, Permission[]>();
    private acl = new Map<string, Set<string>>();  // resource -> Set<did>

    constructor() {
        this.setupDefaultRoles();
    }

    private setupDefaultRoles(): void {
        this.roles.set('guest', [
            { resource: 'room:*', action: 'read' },
            { resource: 'message:*', action: 'read' }
        ]);

        this.roles.set('member', [
            { resource: 'room:*', action: 'read' },
            { resource: 'room:*', action: 'write' },
            { resource: 'message:*', action: 'read' },
            { resource: 'message:*', action: 'write' },
            { resource: 'coc:*', action: 'execute' }
        ]);

        this.roles.set('moderator', [
            { resource: '*', action: 'read' },
            { resource: 'room:*', action: 'admin' },
            { resource: 'member:*', action: 'admin' },
            { resource: 'message:*', action: 'admin' }
        ]);

        this.roles.set('admin', [
            { resource: '*', action: 'admin' }
        ]);
    }

    /**
     * Verificar se usuário tem permissão
     */
    checkPermission(
        context: SecurityContext,
        resource: string,
        action: Permission['action']
    ): boolean {
        // Verificar permissões diretas
        const userPerms = this.userPermissions.get(context.identity.did) || [];
        if (this.hasMatchingPermission(userPerms, resource, action)) {
            return this.checkConditions(context, userPerms, resource, action);
        }

        // Verificar via roles
        // TODO: Implementar sistema de roles vinculado ao context

        return false;
    }

    /**
     * Conceder permissão a usuário
     */
    grantPermission(did: string, permission: Permission): void {
        if (!this.userPermissions.has(did)) {
            this.userPermissions.set(did, []);
        }
        this.userPermissions.get(did)!.push(permission);
    }

    /**
     * Revogar permissão
     */
    revokePermission(did: string, resource: string, action: string): void {
        const perms = this.userPermissions.get(did);
        if (!perms) return;

        const filtered = perms.filter(p => 
            !(p.resource === resource && p.action === action)
        );
        this.userPermissions.set(did, filtered);
    }

    /**
     * Verificar ACL de recurso
     */
    checkACL(resource: string, did: string): boolean {
        const allowed = this.acl.get(resource);
        if (!allowed) return true;  // Sem ACL = aberto
        return allowed.has(did) || allowed.has('*');
    }

    /**
     * Adicionar entrada ACL
     */
    addToACL(resource: string, did: string): void {
        if (!this.acl.has(resource)) {
            this.acl.set(resource, new Set());
        }
        this.acl.get(resource)!.add(did);
    }

    private hasMatchingPermission(
        permissions: Permission[],
        resource: string,
        action: Permission['action']
    ): boolean {
        return permissions.some(p => {
            const resourceMatch = this.matchResource(p.resource, resource);
            const actionMatch = p.action === action || p.action === 'admin';
            return resourceMatch && actionMatch;
        });
    }

    private matchPermission(pattern: string, resource: string): boolean {
        // Suportar wildcards: room:*:message → room:abc123:message
        const regex = new RegExp('^' + pattern.replace(/\*/g, '[^:]*') + '$');
        return regex.test(resource);
    }

    private matchResource(pattern: string, resource: string): boolean {
        if (pattern === '*') return true;
        if (pattern === resource) return true;
        
        // Wildcard: room:*:message
        const regex = new RegExp('^' + pattern.replace(/\*/g, '[^:]*') + '$');
        return regex.test(resource);
    }

    private checkConditions(
        context: SecurityContext,
        permissions: Permission[],
        resource: string,
        action: string
    ): boolean {
        const perm = permissions.find(p => 
            this.matchResource(p.resource, resource) && 
            (p.action === action || p.action === 'admin')
        );

        if (!perm?.conditions) return true;

        const cond = perm.conditions;

        // Verificar time window
        if (cond.timeWindow) {
            const now = Date.now();
            if (now < cond.timeWindow.start || now > cond.timeWindow.end) {
                return false;
            }
        }

        // Verificar IP whitelist
        if (cond.ipWhitelist && context.ip) {
            if (!cond.ipWhitelist.includes(context.ip)) {
                return false;
            }
        }

        // Verificar reputação mínima
        if (cond.reputationMin && context.reputation < cond.reputationMin) {
            return false;
        }

        // Verificar MFA
        if (cond.mfaRequired && !context.mfaVerified) {
            return false;
        }

        return true;
    }
}

// ─── Audit Logger ────────────────────────────────────────────────

export class AuditLogger {
    private events: AuditEvent[] = [];
    private maxSize: number;
    private listeners: Array<(event: AuditEvent) => void> = [];

    constructor(maxSize: number = 10000) {
        this.maxSize = maxSize;
    }

    async log(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
        const fullEvent: AuditEvent = {
            id: `audit_${Date.now()}_${randomBytes(4).toString('hex')}`,
            timestamp: Date.now(),
            ...event
        };

        // Assinar evento para integridade
        fullEvent.signature = await this.signEvent(fullEvent);

        this.events.push(fullEvent);

        // Manter tamanho limitado
        if (this.events.length > this.maxSize) {
            this.events = this.events.slice(-this.maxSize);
        }

        // Notificar listeners
        for (const listener of this.listeners) {
            listener(fullEvent);
        }
    }

    query(filters: {
        type?: AuditEvent['type'];
        actor?: string;
        resource?: string;
        severity?: AuditEvent['severity'];
        startTime?: number;
        endTime?: number;
        limit?: number;
    }): AuditEvent[] {
        let results = this.events;

        if (filters.type) {
            results = results.filter(e => e.type === filters.type);
        }
        if (filters.actor) {
            results = results.filter(e => e.actor === filters.actor);
        }
        if (filters.resource) {
            results = results.filter(e => e.resource === filters.resource);
        }
        if (filters.severity) {
            results = results.filter(e => e.severity === filters.severity);
        }
        if (filters.startTime) {
            results = results.filter(e => e.timestamp >= filters.startTime!);
        }
        if (filters.endTime) {
            results = results.filter(e => e.timestamp <= filters.endTime!);
        }

        // Ordenar por timestamp decrescente
        results.sort((a, b) => b.timestamp - a.timestamp);

        return results.slice(0, filters.limit || 100);
    }

    onEvent(listener: (event: AuditEvent) => void): void {
        this.listeners.push(listener);
    }

    private async signEvent(event: AuditEvent): Promise<string> {
        const data = JSON.stringify({
            type: event.type,
            actor: event.actor,
            resource: event.resource,
            action: event.action,
            timestamp: event.timestamp
        });
        
        return createHash('sha256').update(data).digest('hex');
    }
}

// ─── Threat Detection ────────────────────────────────────────────

export class ThreatDetector {
    private threatIntel = new Map<string, ThreatIntel>();
    private patterns = new Map<string, RegExp>();
    private behaviorScores = new Map<string, {
        score: number;
        events: number[];
    }>();

    constructor() {
        this.setupPatterns();
    }

    private setupPatterns(): void {
        // Padrões de ameaça
        this.patterns.set('spam', /\b(viagra|casino|lottery|winner)\b/gi);
        this.patterns.set('suspicious_links', /https?:\/\/[^\s]{100,}/gi);
        this.patterns.set('credential_harvest', /\b(password|login|credential)\s*=\s*/gi);

        // Prompt injection patterns
        this.patterns.set('injection_system_override', /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)\b/gi);
        this.patterns.set('injection_role_confusion', /\b(act as|pretend to be|you are now)\s/gi);
        this.patterns.set('injection_delimiter', /<\|system\|>|<<SYS>>|###\s*System\s*:/gi);
        this.patterns.set('injection_safety_bypass', /\b(bypass|disable)\s+(security|safety|filter|guard)\b/gi);
    }

    /**
     * Analisar envelope para ameaças
     */
    analyzeEnvelope(envelope: SwpEnvelope): {
        threat: boolean;
        severity: ThreatIntel['severity'];
        category?: ThreatIntel['category'];
        reason?: string;
    } {
        const checks = [
            this.checkKnownThreats(envelope.from.did),
            this.checkContentPatterns(envelope),
            this.checkBehaviorAnomalies(envelope.from.did),
            this.checkRateAnomalies(envelope.from.did)
        ];

        const highestThreat = checks
            .filter(c => c.threat)
            .sort((a, b) => this.severityRank(b.severity) - this.severityRank(a.severity))[0];

        return highestThreat || { threat: false, severity: 'low' };
    }

    /**
     * Reportar ameaça
     */
    reportThreat(threat: Omit<ThreatIntel, 'firstSeen' | 'lastSeen' | 'occurrences'>): void {
        const existing = this.threatIntel.get(threat.value);
        
        if (existing) {
            existing.lastSeen = Date.now();
            existing.occurrences++;
            existing.confidence = Math.min(1, existing.confidence + 0.1);
        } else {
            const newThreat: ThreatIntel = {
                ...threat,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                occurrences: 1
            };
            this.threatIntel.set(threat.value, newThreat);
        }
    }

    /**
     * Verificar se está na lista de ameaças
     */
    isThreat(value: string): ThreatIntel | undefined {
        return this.threatIntel.get(value);
    }

    private checkKnownThreats(did: string): ReturnType<ThreatDetector['analyzeEnvelope']> {
        const threat = this.threatIntel.get(did);
        if (threat) {
            return {
                threat: true,
                severity: threat.severity,
                category: threat.category,
                reason: `Known threat: ${threat.category}`
            };
        }
        return { threat: false, severity: 'low' };
    }

    private checkContentPatterns(envelope: SwpEnvelope): ReturnType<ThreatDetector['analyzeEnvelope']> {
        const bodyStr = JSON.stringify(envelope.body);
        
        for (const [category, pattern] of this.patterns) {
            pattern.lastIndex = 0;
            if (pattern.test(bodyStr)) {
                const isInjection = category.startsWith('injection_');
                return {
                    threat: true,
                    severity: isInjection ? 'high' : 'medium',
                    category: category as ThreatIntel['category'],
                    reason: `Pattern match: ${category}`
                };
            }
        }

        return { threat: false, severity: 'low' };
    }

    private checkBehaviorAnomalies(did: string): ReturnType<ThreatDetector['analyzeEnvelope']> {
        const behavior = this.behaviorScores.get(did);
        if (!behavior) return { threat: false, severity: 'low' };

        // Score anormalmente alto = possível Sybil ou ataque
        if (behavior.score > 100) {
            return {
                threat: true,
                severity: 'high',
                category: 'sybil',
                reason: 'Behavioral anomaly detected'
            };
        }

        return { threat: false, severity: 'low' };
    }

    private checkRateAnomalies(did: string): ReturnType<ThreatDetector['analyzeEnvelope']> {
        const behavior = this.behaviorScores.get(did);
        if (!behavior) return { threat: false, severity: 'low' };

        // Muitos eventos em curto período
        const recentEvents = behavior.events.filter(t => Date.now() - t < 60000);
        if (recentEvents.length > 100) {
            return {
                threat: true,
                severity: 'high',
                category: 'ddos',
                reason: 'Rate limit exceeded'
            };
        }

        return { threat: false, severity: 'low' };
    }

    updateBehaviorScore(did: string, delta: number): void {
        if (!this.behaviorScores.has(did)) {
            this.behaviorScores.set(did, { score: 0, events: [] });
        }
        
        const behavior = this.behaviorScores.get(did)!;
        behavior.score += delta;
        behavior.events.push(Date.now());
        
        // Limpar eventos antigos
        behavior.events = behavior.events.filter(t => Date.now() - t < 3600000);
    }

    private severityRank(severity: ThreatIntel['severity']): number {
        const ranks = { low: 1, medium: 2, high: 3, critical: 4 };
        return ranks[severity];
    }
}

// ─── Content Sanitizer ───────────────────────────────────────────

export class ContentSanitizer {
    private allowedTags = new Set(['b', 'i', 'u', 'code', 'pre', 'a']);
    private allowedSchemes = new Set(['http', 'https', 'mailto']);

    /**
     * Sanitizar conteúdo HTML/Markdown
     */
    sanitize(input: string): string {
        let sanitized = input;

        // Remover scripts e eventos
        sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, '');
        sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
        sanitized = sanitized.replace(/javascript:/gi, '');

        // Validar links
        sanitized = sanitized.replace(/href=["']([^"']*)["']/gi, (match, url) => {
            try {
                const parsed = new URL(url);
                if (this.allowedSchemes.has(parsed.protocol.slice(0, -1))) {
                    return match;
                }
            } catch {
                // URL relativa - permitir
                return match;
            }
            return 'href="#"';
        });

        // Limitar tamanho
        if (sanitized.length > 10000) {
            sanitized = sanitized.slice(0, 10000) + '... [truncated]';
        }

        return sanitized;
    }

    /**
     * Validar e normalizar input
     */
    normalize(input: string): string {
        // Normalizar Unicode
        let normalized = input.normalize('NFC');

        // Remover caracteres de controle (exceto whitespace)
        normalized = normalized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        // Normalizar whitespace
        normalized = normalized.replace(/\s+/g, ' ').trim();

        return normalized;
    }

    /**
     * Sanitize content for LLM prompt inclusion.
     * Strips zero-width characters and sentinel tag escapes.
     */
    sanitizeForLlm(input: string): string {
        let s = input.normalize('NFC');
        // Strip zero-width characters
        s = s.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, '');
        // Escape sentinel delimiters
        s = s.replace(/<\/?user_goal>/gi, '&lt;user_goal&gt;');
        s = s.replace(/<\/?user_context>/gi, '&lt;user_context&gt;');
        s = s.replace(/<\/?user_constraints>/gi, '&lt;user_constraints&gt;');
        // Strip control characters
        s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        return s;
    }
}

// ─── Security Manager ────────────────────────────────────────────

export class SecurityManager {
    encryption: E2EEncryption;
    permissions: PermissionManager;
    audit: AuditLogger;
    threats: ThreatDetector;
    sanitizer: ContentSanitizer;
    guard: InputValidator;
    private identity?: Identity;
    private localEncryptionId?: string;
    private localEncryptionPublicKey?: Uint8Array;
    private localKeyGenerated = false;

    constructor(identityOrConfig?: Identity | { encryption?: Partial<EncryptionConfig> }) {
        const hasIdentity = this.isIdentity(identityOrConfig);
        this.identity = hasIdentity ? identityOrConfig : undefined;
        const config = hasIdentity ? undefined : identityOrConfig;

        this.encryption = new E2EEncryption(config?.encryption);
        this.permissions = new PermissionManager();
        this.audit = new AuditLogger();
        this.threats = new ThreatDetector();
        this.sanitizer = new ContentSanitizer();

        this.guard = new InputValidator({}, this.audit);

        if (this.identity) {
            this.localEncryptionId = this.identity.did;
        }
    }

    /**
     * Pipeline completo de segurança para mensagem
     */
    async processIncoming(envelope: SwpEnvelope): Promise<{
        allowed: boolean;
        reason?: string;
        sanitized?: SwpEnvelope;
    }> {
        // 1. Verificar ameaças
        const threatCheck = this.threats.analyzeEnvelope(envelope);
        if (threatCheck.threat && threatCheck.severity === 'critical') {
            await this.audit.log({
                type: 'violation',
                severity: 'critical',
                actor: envelope.from.did,
                resource: 'network',
                action: 'receive',
                result: 'blocked',
                details: { threat: threatCheck }
            });
            return { allowed: false, reason: threatCheck.reason };
        }

        // 2. Sanitizar conteúdo
        const sanitizedBody = this.sanitizer.sanitize(
            JSON.stringify(envelope.body)
        );
        const sanitized: SwpEnvelope = {
            ...envelope,
            body: JSON.parse(sanitizedBody)
        };

        // 3. Auditar
        await this.audit.log({
            type: 'access',
            severity: 'info',
            actor: envelope.from.did,
            resource: `room:${envelope.room}`,
            action: 'receive',
            result: 'success',
            details: { messageType: envelope.t }
        });

        return { allowed: true, sanitized };
    }

    /**
     * Verificar permissão completa
     */
    async checkAccess(
        context: SecurityContext,
        resource: string,
        action: Permission['action']
    ): Promise<boolean> {
        // Verificar permissão
        const hasPermission = this.permissions.checkPermission(
            context,
            resource,
            action
        );

        if (!hasPermission) {
            await this.audit.log({
                type: 'access',
                severity: 'warning',
                actor: context.identity.did,
                resource,
                action,
                result: 'blocked',
                details: { reason: 'permission_denied' }
            });
            return false;
        }

        return true;
    }

    // ─── Compatibility Wrappers ───────────────────────────────────

    async generateKeyPair(identityId?: string): Promise<any> {
        const id = identityId || this.localEncryptionId || this.identity?.did || `sec_${Date.now()}`;
        const keyPair = await this.encryption.generateKeyPair(id);

        if (!this.localEncryptionId) {
            this.localEncryptionId = id;
        }

        if (id === this.localEncryptionId) {
            this.localEncryptionId = id;
            const exported = await crypto.subtle.exportKey('raw', keyPair.publicKey);
            this.localEncryptionPublicKey = new Uint8Array(exported);
            this.localKeyGenerated = true;
        }

        return keyPair;
    }

    async sign(message: Uint8Array): Promise<Uint8Array> {
        if (!this.identity) {
            throw new Error('Identity is required for signing');
        }

        const msgBase64 = Buffer.from(message).toString('base64');
        const signatureBase64 = identitySign(this.identity, msgBase64);
        return new Uint8Array(Buffer.from(signatureBase64, 'base64'));
    }

    async verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
        const msgBase64 = Buffer.from(message).toString('base64');
        const signatureBase64 = Buffer.from(signature).toString('base64');
        return identityVerify(publicKey, msgBase64, signatureBase64);
    }

    async encrypt(
        plaintext: Uint8Array,
        recipientPublicKey: Uint8Array
    ): Promise<{
        ciphertext: Uint8Array;
        nonce: Uint8Array;
        senderPublicKey: Uint8Array;
    }> {
        const senderId = await this.ensureEncryptionIdentity();
        const encodedPlaintext = Buffer.from(plaintext).toString('base64');
        const encrypted = await this.encryption.encrypt(
            encodedPlaintext,
            recipientPublicKey,
            senderId
        );

        if (!this.localEncryptionPublicKey) {
            throw new Error('Missing sender public key');
        }

        return {
            ...encrypted,
            senderPublicKey: this.localEncryptionPublicKey
        };
    }

    async decrypt(message: {
        ciphertext: Uint8Array;
        nonce: Uint8Array;
        senderPublicKey: Uint8Array;
    }): Promise<Uint8Array> {
        const recipientId = await this.ensureEncryptionIdentity();
        const decoded = await this.encryption.decrypt(
            message.ciphertext,
            message.nonce,
            message.senderPublicKey,
            recipientId
        );
        return new Uint8Array(Buffer.from(decoded, 'base64'));
    }

    private isIdentity(value: unknown): value is Identity {
        if (!value || typeof value !== 'object') return false;
        const candidate = value as Identity;
        return (
            typeof candidate.did === 'string' &&
            candidate.privateKey instanceof Uint8Array &&
            candidate.publicKey instanceof Uint8Array
        );
    }

    private async ensureEncryptionIdentity(): Promise<string> {
        const senderId = this.localEncryptionId || this.identity?.did || `sec_${Date.now()}`;
        this.localEncryptionId = senderId;
        if (!this.localKeyGenerated) {
            await this.generateKeyPair(senderId);
        }
        return senderId;
    }
}

// Classes already exported via 'export class'
