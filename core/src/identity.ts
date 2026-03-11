/**
 * Society Protocol — Identity Module
 *
 * Ed25519 keypair generation, did:key derivation, message signing/verification.
 * Uses @noble/ed25519 for cryptography.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { base58btc } from 'multiformats/bases/base58';
import { toString as uint8ToString, fromString as uint8FromString } from 'uint8arrays';

// Configure ed25519 to use sha512
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
    const h = sha512.create();
    for (const msg of m) h.update(msg);
    return h.digest();
};

export interface Identity {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
    did: string;
    displayName: string;
}

/**
 * Generate a new Ed25519 identity with a did:key identifier.
 *
 * did:key format: did:key:z6Mk<base58btc(0xed01 + pubkey)>
 * The 0xed01 prefix is the multicodec for Ed25519 public keys.
 */
export function generateIdentity(displayName: string): Identity {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = ed.getPublicKey(privateKey);

    // Build did:key: multicodec prefix 0xed01 + public key
    const multicodecPrefixed = new Uint8Array(2 + publicKey.length);
    multicodecPrefixed[0] = 0xed;
    multicodecPrefixed[1] = 0x01;
    multicodecPrefixed.set(publicKey, 2);

    const did = `did:key:${base58btc.encode(multicodecPrefixed)}`;

    return { privateKey, publicKey, did, displayName };
}

/**
 * Restore an identity from stored keys.
 */
export function restoreIdentity(
    privateKeyHex: string,
    displayName: string
): Identity {
    const privateKey = uint8FromString(privateKeyHex, 'base16');
    const publicKey = ed.getPublicKey(privateKey);

    const multicodecPrefixed = new Uint8Array(2 + publicKey.length);
    multicodecPrefixed[0] = 0xed;
    multicodecPrefixed[1] = 0x01;
    multicodecPrefixed.set(publicKey, 2);

    const did = `did:key:${base58btc.encode(multicodecPrefixed)}`;

    return { privateKey, publicKey, did, displayName };
}

/**
 * Canonical JSON serialization (sorted keys, no whitespace).
 * This ensures deterministic serialization for signing.
 */
export function canonicalJson(obj: unknown): string {
    return JSON.stringify(obj, Object.keys(obj as object).sort());
}

/**
 * Deep canonical JSON serialization (recursively sorts all nested objects).
 */
export function deepCanonicalJson(obj: unknown): string {
    if (obj === null || obj === undefined) return JSON.stringify(obj);
    if (typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
        return '[' + obj.map(deepCanonicalJson).join(',') + ']';
    }
    const sorted = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = sorted.map(
        (k) => `${JSON.stringify(k)}:${deepCanonicalJson((obj as Record<string, unknown>)[k])}`
    );
    return '{' + pairs.join(',') + '}';
}

/**
 * Sign a message (canonical JSON bytes) with the identity's private key.
 * Returns base64-encoded signature.
 */
export function sign(identity: Identity, message: string): string {
    const msgBytes = new TextEncoder().encode(message);
    const sig = ed.sign(msgBytes, identity.privateKey);
    return uint8ToString(sig, 'base64');
}

/**
 * Verify a signature against a message and public key.
 */
export function verify(
    publicKey: Uint8Array,
    message: string,
    signatureBase64: string
): boolean {
    const msgBytes = new TextEncoder().encode(message);
    const sig = uint8FromString(signatureBase64, 'base64');
    return ed.verify(sig, msgBytes, publicKey);
}

// ─── Sybil Resistance: Proof-of-Work Identity ────────────────────

/**
 * Generate an identity with proof-of-work to resist Sybil attacks.
 *
 * The PoW requirement forces an attacker to spend O(2^difficulty) hash
 * evaluations per identity, making mass DID creation economically infeasible.
 *
 * The proof is: SHA-512(did || nonce) must have `difficulty` leading zero bits.
 * The nonce is stored alongside the identity for verification.
 *
 * @param displayName - Human-readable name for the identity
 * @param difficulty - Number of leading zero bits required (default: 16 ≈ 65K hashes)
 * @returns Identity with proof-of-work nonce
 */
export function generateIdentityWithPoW(
    displayName: string,
    difficulty: number = 16
): Identity & { powNonce: number; powDifficulty: number } {
    let nonce = 0;
    let identity: Identity;

    while (true) {
        identity = generateIdentity(displayName);
        const challenge = new TextEncoder().encode(`${identity.did}:${nonce}`);
        const hash = sha512(challenge);

        if (hasLeadingZeroBits(hash, difficulty)) {
            return { ...identity, powNonce: nonce, powDifficulty: difficulty };
        }

        nonce++;
        // Re-generate key every 1000 attempts for better entropy distribution
        if (nonce % 1000 === 0) continue;
    }
}

/**
 * Verify a proof-of-work for a DID.
 * Returns true if SHA-512(did || nonce) has the required leading zero bits.
 */
export function verifyIdentityPoW(
    did: string,
    nonce: number,
    difficulty: number
): boolean {
    const challenge = new TextEncoder().encode(`${did}:${nonce}`);
    const hash = sha512(challenge);
    return hasLeadingZeroBits(hash, difficulty);
}

/**
 * Check if a hash has at least `bits` leading zero bits.
 */
function hasLeadingZeroBits(hash: Uint8Array, bits: number): boolean {
    let remaining = bits;
    for (let i = 0; i < hash.length && remaining > 0; i++) {
        if (remaining >= 8) {
            if (hash[i] !== 0) return false;
            remaining -= 8;
        } else {
            // Check the top `remaining` bits of this byte
            const mask = (0xFF << (8 - remaining)) & 0xFF;
            if ((hash[i] & mask) !== 0) return false;
            remaining = 0;
        }
    }
    return true;
}

/**
 * Extract public key bytes from a did:key string.
 */
export function publicKeyFromDid(did: string): Uint8Array {
    if (!did.startsWith('did:key:z')) {
        throw new Error(`Invalid did:key format: ${did}`);
    }
    const multibase = did.slice('did:key:'.length);
    const decoded = base58btc.decode(multibase);
    // Skip 2-byte multicodec prefix (0xed 0x01)
    if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
        throw new Error('Not an Ed25519 did:key');
    }
    return decoded.slice(2);
}
