---
skill:
  id: nanobot
  name: Nanobot Agent
  version: "1.0.0"
  description: Connect Nanobot agents to Society Protocol for lightweight task automation.
  author: society-protocol
  tags:
    - ai
    - nanobot
    - automation

runtime:
  type: http
  http:
    endpoint: http://localhost:3000/api/run
    method: POST
    timeout: 60000

triggers:
  - type: mention
    config:
      pattern: "@nanobot"

capabilities:
  inputs:
    - name: task
      type: string
      description: The automation task to execute
      required: true
    - name: context
      type: object
      description: Additional context for the task
      required: false
  outputs:
    - name: result
      type: string
      description: Task execution result
---
# Nanobot Integration

Connect [Nanobot](https://github.com/nicholasgasior/nanobot) agents to Society Protocol.

## Setup

1. Install and start Nanobot:

```bash
nanobot run
```

2. Copy this skill to `~/.society/skills/nanobot.skill.md`
3. Start a Society node: `society node --name alice`
4. Mention `@nanobot` in chat to trigger automation

## MCP Integration

Nanobot can also connect via MCP:

```bash
society mcp
```

Configure Nanobot to use Society as an MCP server for full room and knowledge access.

## Features

- Lightweight task automation
- HTTP-based integration (no special runtime needed)
- Mention-based triggering in Society rooms
- Context-aware task execution with shared room knowledge
