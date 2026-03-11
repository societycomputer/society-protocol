/**
 * Society Protocol — AGENTS.md Support (AAIF Standard)
 *
 * Generates and parses AGENTS.md files following the Agentic AI Foundation
 * standard (Linux Foundation). Used by 60,000+ open-source projects and
 * supported by Google, OpenAI, Factory, Sourcegraph, and Cursor.
 *
 * Reference: https://agents.md / https://github.com/agentsmd/agents.md
 */

export interface AgentsMdConfig {
    /** Project name */
    projectName: string;
    /** One-sentence project description */
    description: string;
    /** Society Protocol room for collaboration */
    room?: string;
    /** MCP server endpoint or config path */
    mcpServer?: string;
    /** A2A Agent Card URL */
    a2aAgentCard?: string;
    /** Custom build commands */
    buildCommands?: { build?: string; test?: string; lint?: string; dev?: string };
    /** Code style preferences */
    codeStyle?: {
        language?: string;
        formatter?: string;
        conventions?: string[];
    };
    /** Security notes */
    security?: string[];
    /** Additional sections (key = heading, value = content) */
    customSections?: Record<string, string>;
    /** Society node capabilities */
    capabilities?: string[];
    /** Federation membership */
    federation?: string;
    /** Knowledge spaces to use */
    knowledgeSpaces?: string[];
}

/**
 * Generate an AGENTS.md file following the AAIF standard.
 * Follows the "ruthless minimalism" principle — every token loads on every request.
 */
export function generateAgentsMd(config: AgentsMdConfig): string {
    const sections: string[] = [];

    // Project description (required — establishes role context)
    sections.push(`# ${config.projectName}\n`);
    sections.push(config.description);

    // Society Protocol integration
    sections.push('\n## Society Protocol\n');
    sections.push(`This project uses [Society Protocol](https://society.computer) for P2P multi-agent collaboration.\n`);

    if (config.room) {
        sections.push(`- **Room:** \`${config.room}\``);
    }
    if (config.federation) {
        sections.push(`- **Federation:** \`${config.federation}\``);
    }
    if (config.mcpServer) {
        sections.push(`- **MCP Server:** \`${config.mcpServer}\``);
    }
    if (config.a2aAgentCard) {
        sections.push(`- **A2A Agent Card:** \`${config.a2aAgentCard}\``);
    }
    if (config.capabilities?.length) {
        sections.push(`- **Capabilities:** ${config.capabilities.join(', ')}`);
    }
    if (config.knowledgeSpaces?.length) {
        sections.push(`- **Knowledge Spaces:** ${config.knowledgeSpaces.join(', ')}`);
    }

    // MCP Integration
    sections.push('\n### MCP Configuration\n');
    sections.push('```json');
    sections.push(JSON.stringify({
        mcpServers: {
            society: {
                command: 'npx',
                args: ['society-protocol', 'mcp'],
                env: {
                    SOCIETY_ROOM: config.room || 'default',
                },
            },
        },
    }, null, 2));
    sections.push('```');

    // Build commands
    if (config.buildCommands) {
        sections.push('\n## Commands\n');
        const cmds = config.buildCommands;
        if (cmds.build) sections.push(`- **Build:** \`${cmds.build}\``);
        if (cmds.test) sections.push(`- **Test:** \`${cmds.test}\``);
        if (cmds.lint) sections.push(`- **Lint:** \`${cmds.lint}\``);
        if (cmds.dev) sections.push(`- **Dev:** \`${cmds.dev}\``);
    }

    // Code style
    if (config.codeStyle) {
        sections.push('\n## Code Style\n');
        if (config.codeStyle.language) {
            sections.push(`- **Language:** ${config.codeStyle.language}`);
        }
        if (config.codeStyle.formatter) {
            sections.push(`- **Formatter:** ${config.codeStyle.formatter}`);
        }
        if (config.codeStyle.conventions?.length) {
            for (const conv of config.codeStyle.conventions) {
                sections.push(`- ${conv}`);
            }
        }
    }

    // Security
    if (config.security?.length) {
        sections.push('\n## Security\n');
        for (const note of config.security) {
            sections.push(`- ${note}`);
        }
    }

    // Custom sections
    if (config.customSections) {
        for (const [heading, content] of Object.entries(config.customSections)) {
            sections.push(`\n## ${heading}\n`);
            sections.push(content);
        }
    }

    return sections.join('\n') + '\n';
}

/**
 * Parse an AGENTS.md file into structured config.
 * Lenient parser — AGENTS.md is plain Markdown with no formal schema.
 */
export function parseAgentsMd(content: string): Partial<AgentsMdConfig> {
    const config: Partial<AgentsMdConfig> = {};

    // Extract project name from first H1
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
        config.projectName = h1Match[1].trim();
    }

    // Extract first paragraph as description
    const lines = content.split('\n');
    let descStart = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('# ')) {
            descStart = i + 1;
            continue;
        }
        if (descStart >= 0 && lines[i].trim() && !lines[i].startsWith('#')) {
            config.description = lines[i].trim();
            break;
        }
    }

    // Extract bullet items by label
    const extractBullet = (label: string): string | undefined => {
        const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*\`([^\`]+)\``, 'i');
        const match = content.match(re);
        return match?.[1];
    };

    config.room = extractBullet('Room');
    config.federation = extractBullet('Federation');
    config.mcpServer = extractBullet('MCP Server');
    config.a2aAgentCard = extractBullet('A2A Agent Card');

    // Extract capabilities
    const capMatch = content.match(/\*\*Capabilities:\*\*\s*(.+)/i);
    if (capMatch) {
        config.capabilities = capMatch[1].split(',').map((s) => s.trim());
    }

    // Extract knowledge spaces
    const ksMatch = content.match(/\*\*Knowledge Spaces:\*\*\s*(.+)/i);
    if (ksMatch) {
        config.knowledgeSpaces = ksMatch[1].split(',').map((s) => s.trim());
    }

    // Extract build commands
    const buildCmd = extractBullet('Build');
    const testCmd = extractBullet('Test');
    const lintCmd = extractBullet('Lint');
    const devCmd = extractBullet('Dev');
    if (buildCmd || testCmd || lintCmd || devCmd) {
        config.buildCommands = {};
        if (buildCmd) config.buildCommands.build = buildCmd;
        if (testCmd) config.buildCommands.test = testCmd;
        if (lintCmd) config.buildCommands.lint = lintCmd;
        if (devCmd) config.buildCommands.dev = devCmd;
    }

    return config;
}

/**
 * Generate the Society Protocol AGENTS.md for the core package itself.
 */
export function generateSocietyAgentsMd(): string {
    return generateAgentsMd({
        projectName: 'Society Protocol',
        description: 'P2P multi-agent collaboration framework with Chain of Collaboration, Knowledge Pool, and reputation system.',
        room: 'society-dev',
        mcpServer: 'npx society-protocol mcp',
        a2aAgentCard: '/.well-known/agent.json',
        buildCommands: {
            build: 'npm run build',
            test: 'npm test',
            dev: 'npx tsx src/index.ts node --name DevAgent --room dev',
        },
        codeStyle: {
            language: 'TypeScript (strict)',
            formatter: 'None (manual)',
            conventions: [
                'Use explicit types, avoid `any`',
                'Prefer `interface` over `type` for object shapes',
                'Use `ulid()` for all generated IDs',
                'All P2P messages use SWP envelope format',
                'Use CRDT clocks (HLC + vector) for distributed state',
                'All knowledge cards have explicit KnowledgeType',
            ],
        },
        security: [
            'All messages are Ed25519-signed',
            'Verify signatures before processing any SWP envelope',
            'Never expose private keys in logs or error messages',
            'Use SSRF protection for all external HTTP calls',
            'Validate all input against capability tokens',
        ],
        capabilities: [
            'p2p-networking', 'chain-of-collaboration', 'knowledge-pool',
            'reputation', 'federation', 'mcp-server', 'a2a-bridge',
            'proactive-missions', 'persona-vault', 'cot-streaming',
        ],
        federation: 'society-core',
        knowledgeSpaces: ['protocol-docs', 'api-reference', 'examples'],
    });
}
