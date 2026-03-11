#!/usr/bin/env node
import crypto from 'crypto';

function canonical(value) {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => canonical(v)).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

function readStdin() {
    return new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        process.stdin.on('error', reject);
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

function signPayload(secret, payload) {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function makeProof(secret, payload) {
    const body = Buffer.from(payload, 'utf8').toString('base64url');
    const mac = signPayload(secret, body);
    return `bb1.${body}.${mac}`;
}

function parseProof(proof) {
    const parts = String(proof || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'bb1') {
        throw new Error('Malformed proof');
    }
    return { body: parts[1], mac: parts[2] };
}

async function main() {
    const operation = process.argv[2];
    if (operation !== 'prove' && operation !== 'verify') {
        throw new Error('Usage: persona-zkp-runner.mjs <prove|verify>');
    }

    const inputRaw = await readStdin();
    const input = inputRaw.trim() ? JSON.parse(inputRaw) : {};
    const secret = process.env.SOCIETY_PERSONA_ZKP_RUNNER_SECRET || 'persona-zkp-runner-secret-v1';

    if (operation === 'prove') {
        const payload = canonical({
            circuitId: input.circuitId,
            publicInputs: input.publicInputs || {},
            privateInputs: input.privateInputs || {},
            claimIds: input.claimIds || [],
            issuedAt: input.issuedAt || Date.now(),
            expiresAt: input.expiresAt,
            vaultId: input.vaultId,
        });
        const proof = makeProof(secret, payload);
        process.stdout.write(
            JSON.stringify({
                proof,
                publicInputs: input.publicInputs || {},
                claimIds: input.claimIds || [],
            })
        );
        return;
    }

    try {
        const { body, mac } = parseProof(input.proof);
        const expected = signPayload(secret, body);
        if (mac !== expected) {
            process.stdout.write(JSON.stringify({ valid: false, reason: 'Invalid proof signature' }));
            return;
        }

        const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        const expectedPublic = canonical(decoded.publicInputs || {});
        const providedPublic = canonical(input.publicInputs || {});
        if (expectedPublic !== providedPublic) {
            process.stdout.write(JSON.stringify({ valid: false, reason: 'Public inputs mismatch' }));
            return;
        }
        if (decoded.expiresAt && Date.now() > Number(decoded.expiresAt)) {
            process.stdout.write(JSON.stringify({ valid: false, reason: 'Proof expired' }));
            return;
        }
        if (decoded.circuitId !== input.circuitId) {
            process.stdout.write(JSON.stringify({ valid: false, reason: 'Circuit mismatch' }));
            return;
        }
        process.stdout.write(JSON.stringify({ valid: true }));
    } catch (error) {
        process.stdout.write(JSON.stringify({ valid: false, reason: String(error.message || error) }));
    }
}

main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exit(1);
});
