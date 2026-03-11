---
title: AGENTS.md Integration
description: Generate and parse AGENTS.md files for AI coding tools
---

Society Protocol supports the **AGENTS.md** standard from the [Agentic AI Foundation](https://agents.md/) (Linux Foundation). AGENTS.md is used by 60,000+ open-source projects and supported by Google, OpenAI, Factory, Sourcegraph, and Cursor.

## What is AGENTS.md?

AGENTS.md is a plain Markdown file that helps AI coding assistants (Claude Code, Cursor, Goose, etc.) understand and work with your project. It provides:

- Project description and context
- Build/test commands
- Code style conventions
- MCP server configuration
- Security guidelines

## Generate AGENTS.md

Society Protocol includes a generator that creates AGENTS.md files with Society integration built in:

```typescript
import { generateAgentsMd } from 'society-protocol';

const agentsMd = generateAgentsMd({
  projectName: 'My Agent Project',
  description: 'A multi-agent research system using Society Protocol.',
  room: 'my-research-room',
  federation: 'research-team',
  mcpServer: 'npx society-protocol mcp',
  a2aAgentCard: '/.well-known/agent.json',
  buildCommands: {
    build: 'npm run build',
    test: 'npm test',
    dev: 'npm run dev',
  },
  codeStyle: {
    language: 'TypeScript',
    formatter: 'prettier',
    conventions: [
      'Use explicit types, avoid any',
      'Prefer interface over type for objects',
    ],
  },
  security: [
    'All messages are Ed25519-signed',
    'Validate capability tokens before actions',
  ],
  capabilities: ['p2p', 'knowledge-pool', 'coc'],
  knowledgeSpaces: ['project-docs', 'research-notes'],
});

// Write to project root
import { writeFileSync } from 'fs';
writeFileSync('AGENTS.md', agentsMd);
```

### Output

The generated file includes:

1. Project name and description
2. Society Protocol room/federation info
3. MCP server configuration (JSON)
4. Build commands
5. Code style guidelines
6. Security notes

## Parse Existing AGENTS.md

```typescript
import { parseAgentsMd } from 'society-protocol';
import { readFileSync } from 'fs';

const content = readFileSync('AGENTS.md', 'utf-8');
const config = parseAgentsMd(content);

console.log(config.projectName);  // 'My Agent Project'
console.log(config.room);         // 'my-research-room'
console.log(config.capabilities); // ['p2p', 'knowledge-pool', 'coc']
```

## Generate Society's Own AGENTS.md

```typescript
import { generateSocietyAgentsMd } from 'society-protocol';

const md = generateSocietyAgentsMd();
// Generates the AGENTS.md for Society Protocol itself
```

## Symlink with CLAUDE.md

For compatibility with Claude Code, create a symlink:

```bash
ln -s AGENTS.md CLAUDE.md
```

This ensures both Claude Code and other AI tools find the instructions.

## Best Practices

Following the AAIF's "ruthless minimalism" principle:

1. **Keep it short** — Frontier LLMs follow ~150-200 instructions consistently
2. **Lead with context** — One-sentence project description first
3. **Only non-obvious commands** — Skip `npm install`, include custom commands
4. **Progressive disclosure** — Link to detailed docs instead of inlining everything
5. **Include MCP config** — Makes Society tools available to AI assistants
6. **Security section** — Always include security-relevant instructions

## File Placement

| Location | Scope |
|----------|-------|
| Root `AGENTS.md` | Entire project |
| `packages/api/AGENTS.md` | API package only |
| `services/auth/AGENTS.md` | Auth service only |

Subdirectory files merge with root. Closest file takes precedence.
