import { describe, it, expect } from 'vitest';
import { generateAgentsMd, parseAgentsMd, generateSocietyAgentsMd } from '../../src/agents-md.js';

describe('AGENTS.md Generator', () => {
    it('generates valid markdown with all sections', () => {
        const md = generateAgentsMd({
            projectName: 'Test Project',
            description: 'A test project for Society Protocol.',
            room: 'test-room',
            mcpServer: 'npx test-mcp',
            a2aAgentCard: '/.well-known/agent.json',
            buildCommands: {
                build: 'npm run build',
                test: 'npm test',
            },
            codeStyle: {
                language: 'TypeScript',
                conventions: ['Use strict mode'],
            },
            security: ['Sign all messages'],
            capabilities: ['p2p', 'knowledge'],
            federation: 'test-fed',
            knowledgeSpaces: ['docs', 'research'],
        });

        expect(md).toContain('# Test Project');
        expect(md).toContain('A test project for Society Protocol.');
        expect(md).toContain('**Room:** `test-room`');
        expect(md).toContain('**Federation:** `test-fed`');
        expect(md).toContain('**MCP Server:** `npx test-mcp`');
        expect(md).toContain('**Build:** `npm run build`');
        expect(md).toContain('**Language:** TypeScript');
        expect(md).toContain('Sign all messages');
        expect(md).toContain('p2p, knowledge');
        expect(md).toContain('docs, research');
        expect(md).toContain('mcpServers');
    });

    it('generates minimal markdown with only required fields', () => {
        const md = generateAgentsMd({
            projectName: 'Minimal',
            description: 'Minimal project.',
        });

        expect(md).toContain('# Minimal');
        expect(md).toContain('Minimal project.');
        expect(md).toContain('Society Protocol');
        expect(md).not.toContain('**Room:**');
    });

    it('generates Society Protocol AGENTS.md', () => {
        const md = generateSocietyAgentsMd();
        expect(md).toContain('# Society Protocol');
        expect(md).toContain('society-dev');
        expect(md).toContain('npm run build');
        expect(md).toContain('Ed25519');
        expect(md).toContain('chain-of-collaboration');
    });
});

describe('AGENTS.md Parser', () => {
    it('parses generated markdown back to config', () => {
        const original = generateAgentsMd({
            projectName: 'Parse Test',
            description: 'Testing parser.',
            room: 'parse-room',
            federation: 'parse-fed',
            mcpServer: 'npx parse-mcp',
            buildCommands: { build: 'make build', test: 'make test' },
            capabilities: ['cap1', 'cap2'],
            knowledgeSpaces: ['space1'],
        });

        const parsed = parseAgentsMd(original);
        expect(parsed.projectName).toBe('Parse Test');
        expect(parsed.description).toBe('Testing parser.');
        expect(parsed.room).toBe('parse-room');
        expect(parsed.federation).toBe('parse-fed');
        expect(parsed.mcpServer).toBe('npx parse-mcp');
        expect(parsed.buildCommands?.build).toBe('make build');
        expect(parsed.buildCommands?.test).toBe('make test');
        expect(parsed.capabilities).toContain('cap1');
        expect(parsed.knowledgeSpaces).toContain('space1');
    });

    it('handles partial AGENTS.md gracefully', () => {
        const parsed = parseAgentsMd('# Just a Title\n\nSome description.');
        expect(parsed.projectName).toBe('Just a Title');
        expect(parsed.description).toBe('Some description.');
        expect(parsed.room).toBeUndefined();
    });
});
