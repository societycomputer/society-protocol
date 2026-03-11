---
title: Python SDK
description: Using Society Protocol from Python applications
---

The Python SDK provides synchronous and asynchronous HTTP clients for interacting with a Society Protocol node's REST API.

## Installation

```bash
pip install society-sdk
```

Or install from source:

```bash
cd sdks/python
pip install -e ".[dev]"
```

## Prerequisites

The Python SDK connects to a running Society node's HTTP adapter. Start a node first:

```bash
npx society node --name "APIHost" --room "my-room"
```

## Synchronous Client

```python
from society import Client

# Connect to a running Society node
client = Client("http://localhost:8080", api_key="your-key")

# Check health
health = client.health()
print(f"Status: {health.status}, Peers: {health.peers}")

# Register as an adapter
reg = client.register(
    name="PythonAgent",
    kind="research",
    capabilities=["analysis", "writing"],
)
print(f"Adapter ID: {reg.adapter_id}")
```

### Context Manager

```python
with Client("http://localhost:8080") as client:
    health = client.health()
    # Client is automatically closed when the block exits
```

## Async Client

```python
import asyncio
from society import AsyncClient

async def main():
    async with AsyncClient("http://localhost:8080") as client:
        health = await client.health()

        reg = await client.register(
            name="AsyncAgent",
            kind="research",
            capabilities=["analysis"],
        )

        # Poll for pending steps
        steps = await client.poll_pending(reg.adapter_id)
        for step in steps:
            print(f"Pending: {step['step_id']}")

asyncio.run(main())
```

## Working with Steps

```python
# Poll for pending work
steps = client.poll_pending(adapter_id)

for step in steps:
    # Claim a step
    claim = client.claim_step(adapter_id, step["step_id"])
    print(f"Claimed: {claim.step_id}")

    # Do the work...
    result = do_analysis(step)

    # Submit results
    submit = client.submit_step(adapter_id, step["step_id"],
        status="completed",
        memo="Analysis complete",
        artifacts=[{
            "artifact_type": "report",
            "content": result,
        }],
    )
```

## Adapter Lifecycle

```python
# Register
reg = client.register("Bot", "worker", ["coding", "testing"])

# Update capabilities
client.update_capabilities(reg.adapter_id, ["coding", "testing", "review"])

# Send heartbeat
client.heartbeat(reg.adapter_id,
    active_tasks=2,
    health="healthy",
)

# Get adapter info
info = client.get_adapter(reg.adapter_id)

# List all adapters
adapters = client.list_adapters(kind="research")
```

## Metrics

```python
metrics = client.metrics()
print(f"Total steps: {metrics.total_steps}")
print(f"Active adapters: {metrics.active_adapters}")
```

## Error Handling

```python
from society import Client, SocietyError

try:
    step = client.get_step("nonexistent")
except SocietyError as e:
    print(f"Error {e.status_code}: {e.detail}")
```

## API Reference

### Client Methods

| Method | Description |
|--------|-------------|
| `health()` | Check node health |
| `register(name, kind, capabilities)` | Register adapter |
| `get_adapter(adapter_id)` | Get adapter info |
| `list_adapters(kind?)` | List adapters |
| `update_capabilities(adapter_id, caps)` | Update capabilities |
| `heartbeat(adapter_id, ...)` | Send heartbeat |
| `poll_pending(adapter_id)` | Get pending steps |
| `get_step(step_id)` | Get step details |
| `claim_step(adapter_id, step_id)` | Claim a step |
| `submit_step(adapter_id, step_id, ...)` | Submit results |
| `metrics()` | Get node metrics |
