"""Thin HTTP wrapper around nanobot AgentLoop for Society Protocol testing.

Exposes a simple POST /chat endpoint that sends a message to the nanobot
agent and returns the response. This allows Society Protocol tests to
communicate with nanobot agents via HTTP.
"""

import asyncio
import os
import uuid

from aiohttp import web


def _load_config():
    from nanobot.config.loader import load_config
    return load_config()


def _make_provider(config):
    from nanobot.cli.commands import _make_provider as mp
    return mp(config)


bus = None
agent = None


async def create_agent(config):
    from nanobot.agent.loop import AgentLoop
    from nanobot.bus.queue import MessageBus
    from nanobot.session.manager import SessionManager
    from nanobot.cron.service import CronService
    from nanobot.config.paths import get_cron_dir

    global bus
    bus = MessageBus()
    provider = _make_provider(config)
    session_manager = SessionManager(config.workspace_path)
    cron_store_path = get_cron_dir() / "jobs.json"
    cron = CronService(cron_store_path)

    defaults = config.agents.defaults
    loop = AgentLoop(
        bus=bus,
        provider=provider,
        workspace=config.workspace_path,
        model=defaults.model,
        temperature=defaults.temperature,
        max_tokens=defaults.max_tokens,
        max_iterations=defaults.max_tool_iterations,
        memory_window=defaults.memory_window,
        reasoning_effort=defaults.reasoning_effort,
        cron_service=cron,
        session_manager=session_manager,
    )
    await cron.start()
    return loop


async def handle_chat(request: web.Request) -> web.Response:
    global agent, bus
    try:
        body = await request.json()
        message = body.get("message", "")
        if not message:
            return web.json_response({"error": "missing 'message' field"}, status=400)

        # Use unique session key per request to avoid stale context
        session_key = body.get("session_key", f"http-{uuid.uuid4().hex[:8]}")

        response = await agent.process_direct(
            message,
            session_key=session_key,
            channel="cli",
            chat_id="direct",
        )

        # If process_direct returned None, the agent sent the response
        # via the message tool → it's in the outbound queue
        result = response or ""
        if not result:
            # Drain any messages from outbound queue (non-blocking)
            parts = []
            while not bus.outbound.empty():
                try:
                    msg = bus.outbound.get_nowait()
                    if msg.content:
                        parts.append(msg.content)
                except asyncio.QueueEmpty:
                    break
            if parts:
                result = parts[-1]  # Use last (final) message

        return web.json_response({"response": result})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"error": str(e)}, status=500)


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "model": agent.model if agent else "unknown"})


async def init_app():
    global agent
    config = _load_config()
    agent = await create_agent(config)

    # Start agent loop in background
    asyncio.create_task(agent.run())

    app = web.Application()
    app.router.add_post("/chat", handle_chat)
    app.router.add_get("/health", handle_health)
    return app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "18790"))
    print(f"Starting nanobot HTTP wrapper on port {port}...")
    web.run_app(init_app(), host="0.0.0.0", port=port)
