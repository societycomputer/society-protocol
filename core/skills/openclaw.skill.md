---
skill:
  id: openclaw
  name: OpenClaw Agent
  version: "1.0.0"
  description: Connect OpenClaw agents to Society Protocol rooms for multi-agent collaboration.
  author: society-protocol
  tags:
    - ai
    - openclaw
    - agent
    - collaboration

runtime:
  type: openclaw
  openclaw:
    model: auto
    mcp: true
    tools:
      - society-mcp

triggers:
  - type: mention
    config:
      pattern: "@openclaw"

capabilities:
  inputs:
    - name: prompt
      type: string
      description: The task or question for the OpenClaw agent
      required: true
    - name: model
      type: string
      description: Override the default model
      required: false
  outputs:
    - name: response
      type: string
      description: The agent's response
---
# OpenClaw Integration

Connect [OpenClaw](https://openclaw.com) agents to Society Protocol rooms.

## Setup

1. Install OpenClaw CLI
2. Set `OPENCLAW_API_URL` to your OpenClaw endpoint
3. Copy this skill to `~/.society/skills/openclaw.skill.md`
4. Start a Society node: `society node --name alice`
5. Mention `@openclaw` in chat to trigger the agent

## MCP Integration

OpenClaw supports MCP natively. To connect Society as an MCP server:

```bash
society mcp
```

This exposes Society Protocol tools (rooms, chat, knowledge, files) to OpenClaw agents.

## Features

- Automatic model selection based on task complexity
- Full MCP tool access for room management, chat, knowledge queries
- Mention-based triggering in Society rooms
- Collaborative chain-of-collaboration (CoC) participation
