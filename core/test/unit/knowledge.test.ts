import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KnowledgePool, type KnowledgeType } from '../../src/knowledge.js';
import { Storage } from '../../src/storage.js';
import { generateIdentity, type Identity } from '../../src/identity.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

describe('KnowledgePool', () => {
    let testDir: string;
    let storage: Storage;
    let identity: Identity;
    let knowledge: KnowledgePool;

    beforeEach(async () => {
        testDir = join(tmpdir(), `society-knowledge-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
        
        storage = new Storage({ dbPath: join(testDir, 'test.db') });
        identity = generateIdentity('Test User');
        knowledge = new KnowledgePool(storage, identity);
    });

    afterEach(() => {
        try {
            storage.close();
        } catch {}
        rmSync(testDir, { recursive: true, force: true });
    });

    describe('Create Space', () => {
        it('should create knowledge space', async () => {
            const space = await knowledge.createSpace(
                'Test Space',
                'Test Description',
                'team',
                'room'
            );

            expect(space).toBeDefined();
            expect(space.id).toMatch(/^space_/);
            expect(space.name).toBe('Test Space');
            expect(space.description).toBe('Test Description');
            expect(space.owner).toBe(identity.did);
            expect(space.type).toBe('team');
            expect(space.privacy).toBe('room');
        });

        it('should create spaces of all types', async () => {
            const types: Array<'personal' | 'team' | 'federation' | 'public'> = 
                ['personal', 'team', 'federation', 'public'];
            
            for (const type of types) {
                const space = await knowledge.createSpace(
                    `${type} Space`,
                    'Test',
                    type,
                    'room'
                );
                expect(space.type).toBe(type);
            }
        });
    });

    describe('Create Cards', () => {
        let spaceId: string;

        beforeEach(async () => {
            const space = await knowledge.createSpace('Card Test', 'Test', 'team', 'room');
            spaceId = space.id;
        });

        it('should create cards of all types', async () => {
            const types: KnowledgeType[] = ['concept', 'fact', 'insight', 'decision', 'code', 'sop'];
            
            for (const type of types) {
                const card = await knowledge.createCard(
                    spaceId,
                    type,
                    `${type} Card`,
                    `Content for ${type}`
                );
                
                expect(card.type).toBe(type);
                expect(card.title).toBe(`${type} Card`);
                expect(card.id).toMatch(/^know_/);
            }
        });

        it('should auto-generate summary', async () => {
            const card = await knowledge.createCard(
                spaceId,
                'fact',
                'Long Content',
                'This is a very long content that should be summarized automatically by the system'
            );
            
            expect(card.summary).toBeDefined();
            // Summary might be same length if content is already short
            expect(card.summary.length).toBeLessThanOrEqual(card.content.length);
        });

        it('should store tags', async () => {
            const card = await knowledge.createCard(
                spaceId,
                'concept',
                'Tagged Card',
                'Content',
                { tags: ['ai', 'ml', 'important'] }
            );
            
            expect(card.tags).toContain('ai');
            expect(card.tags).toContain('ml');
        });

        it('should set confidence for insights', async () => {
            const card = await knowledge.createCard(
                spaceId,
                'insight',
                'Confident Insight',
                'This is likely true',
                { confidence: 0.95 }
            );
            
            expect(card.confidence).toBe(0.95);
        });
    });

    describe('Update Cards', () => {
        it('should update card content', async () => {
            const space = await knowledge.createSpace('Update Test', 'Test', 'team', 'room');
            const card = await knowledge.createCard(space.id, 'fact', 'Original', 'Content');
            
            const updated = await knowledge.updateCard(
                card.id,
                { title: 'Updated Title', content: 'Updated content' }
            );
            
            expect(updated.title).toBe('Updated Title');
            expect(updated.content).toBe('Updated content');
            expect(updated.version).toBeGreaterThanOrEqual(card.version);
        });
    });

    describe('Links', () => {
        it('should create links between cards', async () => {
            const space = await knowledge.createSpace('Link Test', 'Test', 'team', 'room');
            const card1 = await knowledge.createCard(space.id, 'concept', 'Parent', 'Parent concept');
            const card2 = await knowledge.createCard(space.id, 'concept', 'Child', 'Child concept');
            
            const link = await knowledge.linkCards(card1.id, card2.id, 'supports', 0.9);
            
            expect(link).toBeDefined();
            expect(link.source).toBe(card1.id);
            expect(link.target).toBe(card2.id);
            expect(link.type).toBe('supports');
            expect(link.strength).toBe(0.9);
        });
    });

    describe('Query', () => {
        it('should query cards by type', async () => {
            const space = await knowledge.createSpace('Query Test', 'Test', 'team', 'room');
            
            await knowledge.createCard(space.id, 'fact', 'Fact 1', 'Content');
            await knowledge.createCard(space.id, 'fact', 'Fact 2', 'Content');
            await knowledge.createCard(space.id, 'concept', 'Concept 1', 'Content');
            
            const facts = knowledge.queryCards({ spaceId: space.id, type: 'fact' });
            expect(facts.length).toBe(2);
            
            const concepts = knowledge.queryCards({ spaceId: space.id, type: 'concept' });
            expect(concepts.length).toBe(1);
        });

        it('should query cards by tags', async () => {
            const space = await knowledge.createSpace('Tag Test', 'Test', 'team', 'room');
            
            await knowledge.createCard(space.id, 'fact', 'AI Card', 'Content', { tags: ['ai'] });
            await knowledge.createCard(space.id, 'fact', 'ML Card', 'Content', { tags: ['ml'] });
            await knowledge.createCard(space.id, 'fact', 'Both Card', 'Content', { tags: ['ai', 'ml'] });
            
            const aiCards = knowledge.queryCards({ spaceId: space.id, tags: ['ai'] });
            expect(aiCards.length).toBe(2);
        });

        it('should search cards by query', async () => {
            const space = await knowledge.createSpace('Search Test', 'Test', 'team', 'room');
            
            await knowledge.createCard(space.id, 'fact', 'Machine Learning', 'ML content');
            await knowledge.createCard(space.id, 'fact', 'Blockchain', 'Blockchain content');
            
            const results = knowledge.queryCards({ spaceId: space.id, query: 'machine' });
            expect(results.length).toBe(1);
            expect(results[0].title).toBe('Machine Learning');
        });
    });

    describe('Performance', () => {
        it('should create 100 cards in under 2 seconds', async () => {
            const space = await knowledge.createSpace('Perf Test', 'Test', 'team', 'room');
            const start = Date.now();
            
            for (let i = 0; i < 100; i++) {
                await knowledge.createCard(space.id, 'fact', `Card ${i}`, `Content ${i}`);
            }
            
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(2000);
            console.log(`Created 100 cards in ${elapsed}ms`);
        });
    });

    describe('Persistence Round-trip', () => {
        it('should restore spaces/cards/links after restart', async () => {
            const dbPath = join(testDir, 'test.db');
            const space = await knowledge.createSpace('Persistent Space', 'Persist me', 'team', 'room');
            const cardA = await knowledge.createCard(space.id, 'concept', 'Card A', 'Alpha content');
            const cardB = await knowledge.createCard(space.id, 'fact', 'Card B', 'Beta content');
            await knowledge.linkCards(cardA.id, cardB.id, 'supports', 0.9);

            storage.close();
            storage = new Storage({ dbPath });
            knowledge = new KnowledgePool(storage, identity);

            const cards = knowledge.queryCards({ spaceId: space.id });
            expect(cards).toHaveLength(2);

            const graph = knowledge.getKnowledgeGraph(space.id);
            expect(graph.nodes).toHaveLength(2);
            expect(graph.links).toHaveLength(1);
            expect(graph.links[0].type).toBe('supports');

            const collective = knowledge.getCollectiveUnconscious(space.id);
            expect(collective).toBeDefined();
        });
    });
});
