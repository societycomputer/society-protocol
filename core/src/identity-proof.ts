/**
 * Society Protocol — ZKP Identity Proofs (Schnorr PoK)
 *
 * Non-interactive Schnorr proof of DID/key ownership via Fiat-Shamir.
 * Ed25519 signatures ARE Schnorr signatures — we use ed.sign(challenge, key)
 * as a zero-knowledge proof of private key ownership.
 *
 * Based on: Agent-OSI Layer 3 (arxiv 2602.13795)
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { toString as uint8ToString, fromString as uint8FromString } from 'uint8arrays';
import { randomBytes as cryptoRandomBytes } from 'crypto';
import { publicKeyFromDid, type Identity } from './identity.js';

// ─── Types ──────────────────────────────────────────────────────

export interface IdentityProof {
    did: string;
    challenge: string;       // hex-encoded SHA-512 hash
    proof: string;           // base64-encoded Ed25519 signature
    roomId: string;
    timestamp: number;
    nonce: string;           // random hex for replay protection
    expiresAt: number;       // proof TTL
}

export interface IdentityProofVerifyResult {
    valid: boolean;
    did: string;
    reason?: string;
}

// ─── Proof Generation ───────────────────────────────────────────

const DEFAULT_TTL_MS = 300_000; // 5 minutes

/**
 * Create a non-interactive Schnorr proof of DID ownership.
 *
 * The challenge is SHA-512(did || roomId || timestamp || nonce),
 * and the proof is ed.sign(challenge, privateKey).
 */
export function createIdentityProof(
    identity: Identity,
    roomId: string,
    ttlMs: number = DEFAULT_TTL_MS
): IdentityProof {
    const timestamp = Date.now();
    const nonce = uint8ToString(randomBytes(16), 'base16');
    const expiresAt = timestamp + ttlMs;

    // Build challenge: SHA-512(did || roomId || timestamp || nonce)
    const challengeInput = `${identity.did}|${roomId}|${timestamp}|${nonce}`;
    const challengeBytes = sha512(new TextEncoder().encode(challengeInput));
    const challenge = uint8ToString(challengeBytes, 'base16');

    // Sign the challenge as Schnorr PoK
    const sig = ed.sign(challengeBytes, identity.privateKey);
    const proof = uint8ToString(sig, 'base64');

    return {
        did: identity.did,
        challenge,
        proof,
        roomId,
        timestamp,
        nonce,
        expiresAt,
    };
}

// ─── Proof Verification ────────────────────────────────────────

/**
 * Verify a non-interactive Schnorr proof of DID ownership.
 *
 * 1. Recompute the challenge from the proof fields
 * 2. Extract public key from the DID
 * 3. Verify the Ed25519 signature
 * 4. Check TTL expiration
 */
export function verifyIdentityProof(proof: IdentityProof): IdentityProofVerifyResult {
    // Check expiration
    if (Date.now() > proof.expiresAt) {
        return { valid: false, did: proof.did, reason: 'proof expired' };
    }

    // Recompute challenge
    const challengeInput = `${proof.did}|${proof.roomId}|${proof.timestamp}|${proof.nonce}`;
    const expectedChallengeBytes = sha512(new TextEncoder().encode(challengeInput));
    const expectedChallenge = uint8ToString(expectedChallengeBytes, 'base16');

    // Verify challenge matches
    if (proof.challenge !== expectedChallenge) {
        return { valid: false, did: proof.did, reason: 'challenge mismatch' };
    }

    // Extract public key from DID
    let publicKey: Uint8Array;
    try {
        publicKey = publicKeyFromDid(proof.did);
    } catch {
        return { valid: false, did: proof.did, reason: 'invalid DID format' };
    }

    // Verify Ed25519 signature (Schnorr PoK)
    try {
        const sigBytes = uint8FromString(proof.proof, 'base64');
        const valid = ed.verify(sigBytes, expectedChallengeBytes, publicKey);
        if (!valid) {
            return { valid: false, did: proof.did, reason: 'signature verification failed' };
        }
    } catch {
        return { valid: false, did: proof.did, reason: 'signature verification error' };
    }

    return { valid: true, did: proof.did };
}

// ─── Serialization ──────────────────────────────────────────────

export function serializeIdentityProof(proof: IdentityProof): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(proof));
}

export function deserializeIdentityProof(data: Uint8Array): IdentityProof {
    return JSON.parse(new TextDecoder().decode(data));
}

// ─── Utility ────────────────────────────────────────────────────

function randomBytes(n: number): Uint8Array {
    return new Uint8Array(cryptoRandomBytes(n));
}
