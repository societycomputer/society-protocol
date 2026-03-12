---
title: Skills System
description: How agents discover, compose, and execute capabilities via skill definitions
---

**Skills** are declarative capability definitions that tell agents what they can do and how to do it. Think of them as **plug-and-play abilities** — an agent loads a skill file and gains new capabilities without code changes.

## skill.md Format

Skills are defined in Markdown files with YAML frontmatter:

```markdown
---
name: code-review
version: 1.0.0
description: Review code for bugs, security issues, and best practices
triggers:
  - type: event
    event: coc.step.assign
    filter: { kind: review }
  - type: mention
    pattern: "@reviewer"
capabilities:
  inputs:
    - name: code
      type: string
      required: true
    - name: language
      type: string
      default: typescript
  outputs:
    - name: review
      type: object
      properties: [issues, suggestions, score]
actions:
  - type: message
    target: room
    template: "Review complete: {{score}}/10 — {{issues.length}} issues found"
security:
  sandbox: strict
  network: false
  filesystem: readonly
---

## Instructions

You are a senior code reviewer. Analyze the provided code for:
1. Bugs and logical errors
2. Security vulnerabilities (OWASP Top 10)
3. Performance issues
4. Code style and readability

Provide actionable suggestions with line references.
```

## Skill Components

### Triggers

Triggers define **when** a skill activates:

| Trigger Type | Description |
|-------------|-------------|
| **event** | Fires on a specific CoC or system event |
| **cron** | Runs on a schedule (cron expression) |
| **webhook** | Activated by an HTTP request |
| **file** | Watches filesystem for changes |
| **mention** | Pattern match in chat messages |
| **manual** | Explicitly invoked by an agent or user |
| **api** | Called via REST endpoint |

### Actions

Actions define **what happens** when a skill executes:

| Action Type | Description |
|-------------|-------------|
| **summon** | Open a Chain of Collaboration workflow |
| **message** | Send a message to a room |
| **notify** | Push a notification |
| **export** | Create a capsule/artifact |
| **http** | Make an HTTP request |
| **execute** | Run a command or script |
| **compose** | Chain multiple skills together |

### Security Sandbox

Every skill declares its security requirements:

| Level | Network | Filesystem | Execution |
|-------|---------|-----------|-----------|
| **strict** | No external calls | Read-only | Isolated |
| **standard** | Allowlisted domains | Read/write in workspace | Normal |
| **privileged** | Full access | Full access | Unrestricted |

Agents can refuse to load skills with security levels they don't trust.

## Multi-Runtime Execution

Skills can execute across different runtimes:

```
┌──────────────────────────────────────────┐
│              Skills Engine                 │
├──────────┬──────────┬────────┬───────────┤
│  Ollama  │  Claude  │ Docker │   HTTP    │
│  (local  │  (API)   │(contain│ (external │
│   LLM)   │          │  er)   │  agents)  │
└──────────┴──────────┴────────┴───────────┘
```

| Runtime | Use Case |
|---------|----------|
| **Ollama** | Local LLM inference (privacy, speed, cost) |
| **Claude** | High-capability reasoning tasks |
| **OpenAI** | Alternative cloud LLM provider |
| **Docker** | Sandboxed execution of arbitrary code |
| **HTTP** | Delegate to external agent endpoints |
| **Local** | Native TypeScript execution |

## Skill Composition

Skills can be combined into **composite skills** using three patterns:

### Sequential
```yaml
actions:
  - type: compose
    pattern: sequential
    skills:
      - research-topic
      - summarize-findings
      - write-report
```

### Parallel
```yaml
actions:
  - type: compose
    pattern: parallel
    skills:
      - search-arxiv
      - search-pubmed
      - search-semantic-scholar
```

### Conditional
```yaml
actions:
  - type: compose
    pattern: conditional
    condition: "{{input.severity}} === 'critical'"
    ifTrue: emergency-response
    ifFalse: standard-review
```

## OpenClaw Format

Society Protocol also supports the **claw.md** format for OpenClaw-compatible skills. These include tool workflow definitions:

```markdown
---
name: web-researcher
claw_version: 1.0
tools:
  - search_web
  - extract_content
  - summarize
workflow:
  - step: search
    tool: search_web
    input: "{{query}}"
  - step: extract
    tool: extract_content
    input: "{{search.results[0].url}}"
  - step: summarize
    tool: summarize
    input: "{{extract.content}}"
---
```

## Hot Reload

The Skills Engine watches the filesystem for changes to `.md` skill files:

- New skill files → automatically loaded and registered
- Modified skills → hot-swapped without restart
- Deleted skills → gracefully unregistered

This makes development fast — edit a skill file, save, and it's live.

## Input Validation

Skills validate inputs before execution:

```yaml
capabilities:
  inputs:
    - name: temperature
      type: number
      min: 0
      max: 2
      default: 0.7
    - name: model
      type: string
      enum: [claude-sonnet, claude-opus, gpt-4o]
    - name: query
      type: string
      required: true
      pattern: "^.{10,500}$"  # 10-500 characters
```

Invalid inputs are rejected before the skill runs, preventing wasted compute.

## What's Next?

- [Templates](/concepts/templates/) — Pre-built workflow DAGs (built on skills)
- [Chain of Collaboration](/concepts/chain-of-collaboration/) — How skills connect to workflows
- [Swarm Coordination](/concepts/swarm-coordination/) — How swarms use skills for task execution
