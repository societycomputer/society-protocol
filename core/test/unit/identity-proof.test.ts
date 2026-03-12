/**
 * ZKP Identity Proof — Unit Tests
 *
 * Tests Schnorr PoK generation, verification, expiration, tamper detection.
 */

import { describe, it, expect } from 'vitest';
import {
    createIdentityProof,
    verifyIdentityProof,
    serializeIdentityProof,
    deserializeIdentityProof,
} from '../../src/identity-proof.js';
import { generateIdentity } from '../../src/identity.js';

describe('ZKP Identity Proofs (Schnorr PoK)', () => {
    const alice = generateIdentity('Alice');
    const bob = generateIdentity('Bob');
    const roomId = 'test-room-123';

    it('creates a valid identity proof', () => {
        const proof = createIdentityProof(alice, roomId);

        expect(proof.did).toBe(alice.did);
        expect(proof.roomId).toBe(roomId);
        expect(proof.challenge).toBeTruthy();
        expect(proof.proof).toBeTruthy();
        expect(proof.nonce).toBeTruthy();
        expect(proof.timestamp).toBeGreaterThan(0);
        expect(proof.expiresAt).toBeGreaterThan(proof.timestamp);
    });

    it('verifies a freshly created proof', () => {
        const proof = createIdentityProof(alice, roomId);
        const result = verifyIdentityProof(proof);

        expect(result.valid).toBe(true);
        expect(result.did).toBe(alice.did);
        expect(result.reason).toBeUndefined();
    });

    it('rejects a proof with tampered DID', () => {
        const proof = createIdentityProof(alice, roomId);
        proof.did = bob.did; // Tamper

        const result = verifyIdentityProof(proof);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('challenge mismatch');
    });

    it('rejects a proof with tampered challenge', () => {
        const proof = createIdentityProof(alice, roomId);
        proof.challenge = proof.challenge.replace(/^./, 'f'); // Tamper first char

        const result = verifyIdentityProof(proof);
        expect(result.valid).toBe(false);
    });

    it('rejects a proof with tampered signature', () => {
        const proof = createIdentityProof(alice, roomId);
        // Tamper with the base64 signature
        const sigBytes = Buffer.from(proof.proof, 'base64');
        sigBytes[0] = sigBytes[0] ^ 0xff;
        proof.proof = sigBytes.toString('base64');

        const result = verifyIdentityProof(proof);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('signature');
    });

    it('rejects an expired proof', () => {
        const proof = createIdentityProof(alice, roomId, 1); // 1ms TTL
        // Wait for expiration
        proof.expiresAt = Date.now() - 1000;

        const result = verifyIdentityProof(proof);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('proof expired');
    });

    it('different identities produce different proofs for same room', () => {
        const proofAlice = createIdentityProof(alice, roomId);
        const proofBob = createIdentityProof(bob, roomId);

        expect(proofAlice.did).not.toBe(proofBob.did);
        expect(proofAlice.proof).not.toBe(proofBob.proof);

        // Both should verify
        expect(verifyIdentityProof(proofAlice).valid).toBe(true);
        expect(verifyIdentityProof(proofBob).valid).toBe(true);
    });

    it('serialization round-trip preserves proof', () => {
        const proof = createIdentityProof(alice, roomId);
        const serialized = serializeIdentityProof(proof);
        const deserialized = deserializeIdentityProof(serialized);

        expect(deserialized).toEqual(proof);
        expect(verifyIdentityProof(deserialized).valid).toBe(true);
    });

    it('proof for different rooms are independent', () => {
        const proof1 = createIdentityProof(alice, 'room-1');
        const proof2 = createIdentityProof(alice, 'room-2');

        expect(proof1.challenge).not.toBe(proof2.challenge);
        expect(verifyIdentityProof(proof1).valid).toBe(true);
        expect(verifyIdentityProof(proof2).valid).toBe(true);

        // Cross-room tampering fails
        proof1.roomId = 'room-2';
        expect(verifyIdentityProof(proof1).valid).toBe(false);
    });

    it('rejects proof with invalid DID format', () => {
        const proof = createIdentityProof(alice, roomId);
        // Keep challenge consistent with invalid DID
        const tamperedProof = { ...proof, did: 'invalid-did' };
        // Recompute challenge would not match
        const result = verifyIdentityProof(tamperedProof);
        expect(result.valid).toBe(false);
    });
});
