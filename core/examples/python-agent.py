#!/usr/bin/env python3
"""
Society Protocol — Python Agent Example

Connect a Python agent to Society Protocol via the REST adapter.
The Python agent registers, polls for tasks, and submits results.

Prerequisites:
  1. Start a Society node with REST adapter:
     npx society --name gateway --adapter
  2. Run this script:
     pip install society-protocol
     python examples/python-agent.py

Or without pip, using raw HTTP:
     python examples/python-agent.py --raw
"""

import argparse
import time
import json

def main_sdk():
    """Using the official Python SDK."""
    from society import Client

    client = Client("http://localhost:8080")

    # Register agent
    reg = client.register(
        display_name="PyResearcher",
        specialties=["nlp", "data-analysis", "python"],
    )
    print(f"Registered: {reg.adapter_id}")
    print(f"DID: {reg.did}")

    # Health check
    health = client.health()
    print(f"Node health: {health.status}")

    # Poll for tasks
    print("\nPolling for tasks... (Ctrl+C to stop)")
    while True:
        steps = client.poll_pending(reg.adapter_id)
        if steps:
            for step in steps:
                print(f"\n  Task: {step.title} ({step.kind})")
                # Do work here...
                result = f"Analysis complete: processed {step.title}"
                client.submit(reg.adapter_id, step.id, output=result)
                print(f"  Submitted: {step.id}")
        time.sleep(2)


def main_raw():
    """Using raw HTTP — no SDK required."""
    import urllib.request

    base = "http://localhost:8080"

    # Register
    data = json.dumps({
        "name": "PyAgent",
        "capabilities": ["research", "python"],
    }).encode()
    req = urllib.request.Request(
        f"{base}/adapters/register",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req)
    reg = json.loads(resp.read())
    adapter_id = reg["adapter_id"]
    print(f"Registered: {adapter_id}")

    # Poll for tasks
    print("\nPolling for tasks... (Ctrl+C to stop)")
    while True:
        resp = urllib.request.urlopen(f"{base}/adapters/{adapter_id}/steps/pending")
        steps = json.loads(resp.read())
        if steps:
            for step in steps:
                print(f"  Task: {step['title']}")
                # Submit result
                result = json.dumps({
                    "status": "completed",
                    "output": f"Done: {step['title']}",
                }).encode()
                req = urllib.request.Request(
                    f"{base}/adapters/{adapter_id}/steps/{step['step_id']}/submit",
                    data=result,
                    headers={"Content-Type": "application/json"},
                )
                urllib.request.urlopen(req)
                print(f"  Submitted: {step['step_id']}")
        time.sleep(2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", action="store_true", help="Use raw HTTP instead of SDK")
    args = parser.parse_args()

    try:
        if args.raw:
            main_raw()
        else:
            main_sdk()
    except KeyboardInterrupt:
        print("\nStopped.")
