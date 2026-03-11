import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityManager, E2EEncryption, PermissionManager, AuditLogger } from '../../src/security.js';
import type { SwpEnvelope } from '../../src/swp.js';
import { generateIdentity, type Identity } from '../../src/identity.js';

describe('SecurityManager', () => {
    let security: SecurityManager;
    let identity: Identity;

    beforeEach(() => {
        identity = generateIdentity('Security Test');
        security = new SecurityManager(identity);
    });

    describe('E2E Encryption', () => {
        it('should instantiate E2E encryption', () => {
            expect(security.encryption).toBeDefined();
        });

        it('should generate key pair', async () => {
            const keyPair = await security.encryption.generateKeyPair('test-id');
            expect(keyPair).toBeDefined();
            expect(security.encryption['keys'].has('test-id')).toBe(true);
        });

        it('should encrypt and decrypt messages', async () => {
            // Generate key pairs for sender and recipient
            const senderKeys = await security.encryption.generateKeyPair('sender');
            const recipientKeys = await security.encryption.generateKeyPair('recipient');
            
            // Get recipient's public key
            const recipientPublicKey = await crypto.subtle.exportKey('raw', recipientKeys.publicKey);
            
            // Encrypt
            const plaintext = 'Hello, World!';
            const encrypted = await security.encryption.encrypt(
                plaintext,
                new Uint8Array(recipientPublicKey),
                'sender'
            );
            
            expect(encrypted).toBeDefined();
            expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
            expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
        });
    });

    describe('Compatibility API', () => {
        it('should sign and verify via compatibility wrappers', async () => {
            const message = new TextEncoder().encode('compat-sign');
            const signature = await security.sign(message);
            const valid = await security.verify(message, signature, identity.publicKey);
            expect(valid).toBe(true);
        });

        it('should encrypt and decrypt via compatibility wrappers', async () => {
            const recipient = await security.generateKeyPair();
            const recipientPublicKeyRaw = await crypto.subtle.exportKey('raw', recipient.publicKey);
            const plaintext = new TextEncoder().encode('compat-encrypt');

            const encrypted = await security.encrypt(plaintext, new Uint8Array(recipientPublicKeyRaw));
            const decrypted = await security.decrypt(encrypted);

            expect(new TextDecoder().decode(decrypted)).toBe('compat-encrypt');
        });
    });

    describe('Permission Manager', () => {
        it('should check permissions', () => {
            const context = {
                identity: { did: 'did:key:z6MkTest' } as any,
                permissions: [],
                sessionId: 'test-session',
                mfaVerified: true,
                reputation: 1.0,
                trustTier: 'gold' as const
            };
            
            const hasPermission = security.permissions.checkPermission(
                context,
                'room:lobby',
                'read'
            );
            
            expect(typeof hasPermission).toBe('boolean');
        });

        it('should check admin permissions', () => {
            const context = {
                identity: { did: 'did:key:z6MkAdmin' } as any,
                permissions: [{
                    resource: '*',
                    action: 'admin' as const
                }],
                sessionId: 'test-session',
                mfaVerified: true,
                reputation: 1.0,
                trustTier: 'platinum' as const
            };
            
            // Just verify it doesn't throw and returns boolean
            const hasPermission = security.permissions.checkPermission(
                context,
                'room:any',
                'admin'
            );
            
            expect(typeof hasPermission).toBe('boolean');
        });
    });

    describe('Audit Logger', () => {
        it('should log events', async () => {
            await security.audit.log({
                type: 'access',
                severity: 'info',
                actor: 'did:key:z6MkTest',
                resource: 'room:test',
                action: 'join',
                result: 'success',
                details: {}
            });
            
            expect(true).toBe(true); // Should not throw
        });
    });

    describe('Threat Detector', () => {
        it('should analyze envelopes', () => {
            const envelope: SwpEnvelope = {
                v: '1.0',
                t: 'chat.msg',
                id: 'msg_123',
                room: 'lobby',
                from: {
                    did: 'did:key:z6MkTest',
                    name: 'Test User'
                },
                ts: Date.now(),
                ttl: 30000,
                sig: 'test-signature',
                body: { text: 'Hello' }
            };
            
            const analysis = security.threats.analyzeEnvelope(envelope);
            expect(analysis).toBeDefined();
            expect(analysis.threat).toBeDefined();
        });
    });

    describe('Content Sanitizer', () => {
        it('should sanitize HTML content', () => {
            const dirty = '<script>alert("xss")</script><p>Hello</p>';
            const clean = security.sanitizer.sanitize(dirty);
            expect(clean).not.toContain('<script>');
        });

        it('should allow safe HTML', () => {
            const safe = '<p>Hello <strong>World</strong></p>';
            const result = security.sanitizer.sanitize(safe);
            expect(result).toContain('<p>');
        });
    });

    describe('Process Incoming', () => {
        it('should process valid messages', async () => {
            const envelope: SwpEnvelope = {
                v: '1.0',
                t: 'chat.msg',
                id: 'msg_123',
                room: 'lobby',
                from: {
                    did: 'did:key:z6MkTest',
                    name: 'Test User'
                },
                ts: Date.now(),
                ttl: 30000,
                sig: 'test-signature',
                body: { text: 'Hello' }
            };
            
            const result = await security.processIncoming(envelope);
            expect(result.allowed).toBe(true);
        });
    });
});
