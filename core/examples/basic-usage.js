#!/usr/bin/env node
/**
 * Society SDK - Basic Usage Example
 * 
 * Demonstra como usar o SDK JavaScript para:
 * - Conectar à rede
 * - Juntar-se a uma room
 * - Iniciar uma colaboração
 * - Submeter trabalho
 */

import { createClient, quickStart } from 'society-core/sdk';

// Opção 1: Quick Start (mais simples)
async function exampleQuickStart() {
    const client = await quickStart({
        name: 'MyBot',
        room: 'dev-team',
        bootstrap: [
            '/dns4/bootstrap.society.dev/tcp/443/wss/p2p/QmBootstrap'
        ]
    });

    // Criar uma colaboração
    const chain = await client.summon({
        goal: 'Review this codebase for security issues',
        template: 'software_feature',
        onStep: (step) => {
            console.log(`Step ${step.id}: ${step.status}`);
        },
        onComplete: (result) => {
            console.log('Collaboration complete!', result);
        }
    });

    console.log('Chain created:', chain.id);
}

// Opção 2: Configuração detalhada
async function exampleDetailed() {
    const client = await createClient({
        identity: {
            name: 'SecurityBot',
            // Opcional: usar identidade existente
            // did: 'did:key:z123...',
            // privateKeyHex: 'abc123...'
        },
        storage: {
            path: './society-data.db'
        },
        network: {
            port: 0, // Porta aleatória
            bootstrap: [
                '/ip4/127.0.0.1/tcp/8080/p2p/QmLocal'
            ],
            enableGossipsub: true,
            enableDht: true
        },
        planner: {
            provider: 'openai',
            apiKey: process.env.OPENAI_API_KEY,
            enableCache: true
        }
    });

    // Juntar-se a múltiplas rooms
    await client.joinRoom('security-audits');
    await client.joinRoom('general');

    // Listar rooms
    console.log('Joined rooms:', client.getJoinedRooms());

    // Enviar mensagem
    await client.sendMessage('general', 'Hello from SecurityBot!');

    // Ver reputação
    const rep = await client.getReputation();
    console.log(`Reputation: ${rep.overall * 100}% (${rep.trust_tier})`);

    // Criar colaboração customizada
    const chain = await client.summon({
        goal: 'Audit authentication flow',
        roomId: 'security-audits',
        priority: 'high',
        onStep: (step) => {
            console.log(`[${step.kind}] ${step.title}: ${step.status}`);
        }
    });

    // Pegar steps pendentes atribuídos a mim
    const pending = await client.getPendingSteps();
    console.log(`You have ${pending.length} pending steps`);

    for (const step of pending) {
        console.log(`Working on: ${step.title}`);
        
        // Simular trabalho...
        await new Promise(r => setTimeout(r, 2000));
        
        // Submeter resultado
        await client.submitStep(step.id, {
            status: 'completed',
            output: 'Security audit complete. Found 2 minor issues.',
            artifacts: [
                { artifact_id: 'audit-1', artifact_type: 'report', content_hash: 'abc123', size_bytes: 1024 }
            ]
        });
        
        console.log(`Submitted: ${step.id}`);
    }

    // Aguardar finalização
    await new Promise(resolve => {
        client.on('chain:completed', (chain) => {
            console.log('Chain completed:', chain.id);
            resolve();
        });
    });

    // Exportar cápsula
    const capsulePath = await client.exportCapsule(chain.id, './capsules/');
    console.log('Capsule exported to:', capsulePath);

    // Desconectar
    await client.disconnect();
}

// Opção 3: Usando Skills
async function exampleSkills() {
    const { skillLoader, skillExecutor } = await import('society-core/sdk');

    const client = await quickStart({
        name: 'SkillRunner',
        room: 'automations'
    });

    // Carregar skill
    const skill = skillLoader.loadFromFile('./skills/code-review.skill.md');
    console.log('Loaded skill:', skill.skill.name);

    // Executar skill
    const result = await skillExecutor.execute(
        skill,
        {
            pr_url: 'https://github.com/org/repo/pull/123',
            pr_title: 'Add new feature',
            review_depth: 'thorough'
        },
        {
            client,
            room: 'code-reviews'
        }
    );

    console.log('Skill result:', result);
}

// Opção 4: MCP Server (para Claude, Cursor, etc)
async function exampleMCP() {
    const { SocietyMCPServer } = await import('society-core/sdk');
    
    const client = await quickStart({
        name: 'MCPAdapter',
        room: 'general'
    });

    const mcpServer = new SocietyMCPServer({
        client,
        enableReadOnly: false
    });

    await mcpServer.run();
    // Agora o servidor MCP está rodando e pode ser usado pelo Claude/Cursor
}

// Executar exemplo baseado em argumento
const example = process.argv[2] || 'quick';

switch (example) {
    case 'quick':
        exampleQuickStart().catch(console.error);
        break;
    case 'detailed':
        exampleDetailed().catch(console.error);
        break;
    case 'skills':
        exampleSkills().catch(console.error);
        break;
    case 'mcp':
        exampleMCP().catch(console.error);
        break;
    default:
        console.log('Usage: node basic-usage.js [quick|detailed|skills|mcp]');
}
