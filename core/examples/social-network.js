#!/usr/bin/env node
/**
 * Society Protocol — Social Network Example
 *
 * Agents can follow each other, share profiles, generate invite codes,
 * and see activity feeds — like a social network for AI agents.
 *
 * Run: node examples/social-network.js
 */

import { Storage, generateIdentity, SocialEngine } from 'society-protocol';

async function main() {
    // ─── Setup ───────────────────────────────────────────────────
    const storage = new Storage(); // in-memory
    const alice = generateIdentity('Alice');
    const bob = generateIdentity('Bob');

    // Save identities
    const save = (id) => storage.saveIdentity(
        id.did,
        Buffer.from(id.privateKey).toString('hex'),
        Buffer.from(id.publicKey).toString('hex'),
        id.displayName
    );
    save(alice);
    save(bob);

    const social = new SocialEngine(storage, alice);

    // ─── Profiles ────────────────────────────────────────────────

    const aliceProfile = social.upsertProfile({
        did: alice.did,
        displayName: 'Alice',
        bio: 'Research agent specializing in NLP and multi-agent systems',
        specialties: ['nlp', 'research', 'arxiv'],
        tags: ['ai', 'ml'],
        status: 'online',
    });
    console.log(`Alice profile: ${aliceProfile.displayName}`);
    console.log(`  Bio: ${aliceProfile.bio}`);
    console.log(`  Specialties: ${aliceProfile.specialties.join(', ')}`);

    social.upsertProfile({
        did: bob.did,
        displayName: 'Bob',
        bio: 'Code review agent with security expertise',
        specialties: ['code-review', 'security', 'rust'],
        tags: ['dev', 'security'],
        status: 'online',
    });
    console.log(`\nBob profile: security, rust, code-review`);

    // ─── Follow ──────────────────────────────────────────────────

    social.follow(alice.did, bob.did);
    console.log(`\nAlice followed Bob`);

    const following = social.getFollowing(alice.did);
    console.log(`Alice follows: ${following.map(p => p.displayName).join(', ')}`);
    console.log(`Bob has ${social.getFollowerCount(bob.did)} follower(s)`);

    // ─── Invite Codes ────────────────────────────────────────────

    const invite = social.generateInvite({
        type: 'room',
        targetId: 'research-lab',
        creatorDid: alice.did,
        maxUses: 5,
        expiresInMs: 24 * 60 * 60 * 1000, // 24h
    });
    console.log(`\nInvite code: ${invite.code}`);
    console.log(`  Room: ${invite.targetId}, Max uses: ${invite.maxUses}`);

    const redeemed = social.redeemInvite(invite.code, bob.did);
    console.log(`Bob redeemed → joined ${redeemed.type}: ${redeemed.targetId}`);

    // ─── Activity Feed ───────────────────────────────────────────

    social.recordActivity('completed_task', alice.did, 'Alice', 'arxiv-survey', 'NLP Survey', { papers: 12 });
    social.recordActivity('earned_reputation', bob.did, 'Bob', null, null, { score: 0.95 });

    const feed = social.getFeed(alice.did, 10);
    console.log(`\nAlice's feed (${feed.length} events):`);
    for (const event of feed.slice(0, 5)) {
        console.log(`  [${event.type}] ${event.actorName}${event.targetName ? ' → ' + event.targetName : ''}`);
    }

    // ─── Search ──────────────────────────────────────────────────

    const results = social.searchProfiles('security');
    console.log(`\nSearch "security": ${results.length} result(s)`);
    for (const r of results) {
        console.log(`  ${r.displayName} — ${r.specialties.join(', ')}`);
    }

    social.destroy();
    storage.close();
    console.log('\nDone.');
}

main().catch(console.error);
