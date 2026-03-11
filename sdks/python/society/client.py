"""Society Protocol Python SDK — thin HTTP client.

Usage:
    from society import Client

    client = Client("http://localhost:8080", api_key="my-key")

    # Register as an adapter
    reg = client.register(
        display_name="PythonAgent",
        runtime="custom",
        kinds=["task", "review"],
        specialties=["nlp", "summarization"],
    )
    adapter_id = reg.adapter_id

    # Poll for work
    steps = client.poll_pending(adapter_id, limit=5)
    for step in steps:
        claim = client.claim_step(adapter_id, step.step_id)
        # ... do work ...
        client.submit_step(adapter_id, step.step_id,
            chain_id=step.chain_id,
            status="completed",
            memo="Done!",
            artifacts=[],
        )
"""

from __future__ import annotations

from typing import Any

import httpx

from .types import (
    AdapterInfo,
    AdapterRegistration,
    Artifact,
    ClaimResult,
    HealthStatus,
    Metrics,
    StepInfo,
    SubmitResult,
)


class SocietyError(Exception):
    """Error from the Society Protocol API."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"HTTP {status_code}: {detail}")


class Client:
    """Synchronous thin client for the Society Protocol HTTP adapter API."""

    def __init__(
        self,
        base_url: str = "http://localhost:8080",
        api_key: str | None = None,
        timeout: float = 30.0,
    ):
        headers: dict[str, str] = {}
        if api_key:
            headers["X-API-Key"] = api_key
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=timeout,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    # ─── Internal ──────────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        resp = self._http.request(method, path, **kwargs)
        if resp.status_code >= 400:
            detail = resp.text
            try:
                detail = resp.json().get("error", detail)
            except Exception:
                pass
            raise SocietyError(resp.status_code, detail)
        return resp.json()

    # ─── Health ────────────────────────────────────────────────

    def health(self) -> HealthStatus:
        data = self._request("GET", "/health")
        return HealthStatus(**data)

    # ─── Adapter Registration ──────────────────────────────────

    def register(
        self,
        display_name: str,
        runtime: str = "custom",
        kinds: list[str] | None = None,
        specialties: list[str] | None = None,
        max_concurrency: int = 1,
        endpoint: str = "",
        description: str | None = None,
    ) -> AdapterRegistration:
        body: dict[str, Any] = {
            "display_name": display_name,
            "runtime": runtime,
            "kinds": kinds or ["task"],
            "specialties": specialties or [],
            "max_concurrency": max_concurrency,
            "endpoint": endpoint,
            "version": "1.0.0",
            "auth_type": "none",
        }
        if description:
            body["description"] = description
        data = self._request("POST", "/adapters/register", json=body)
        return AdapterRegistration(**data)

    def get_adapter(self, adapter_id: str) -> dict[str, Any]:
        return self._request("GET", f"/adapters/{adapter_id}")

    def list_adapters(self, kind: str | None = None) -> list[AdapterInfo]:
        params: dict[str, str] = {}
        if kind:
            params["kind"] = kind
        data = self._request("GET", "/adapters", params=params)
        return [AdapterInfo(**a) for a in data["adapters"]]

    def update_capabilities(
        self, adapter_id: str, **capabilities: Any
    ) -> dict[str, Any]:
        return self._request(
            "PUT", f"/adapters/{adapter_id}/capabilities", json=capabilities
        )

    # ─── Heartbeat ─────────────────────────────────────────────

    def heartbeat(
        self,
        adapter_id: str,
        active_tasks: int = 0,
        queue_depth: int = 0,
        metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "active_tasks": active_tasks,
            "queue_depth": queue_depth,
        }
        if metrics:
            body["metrics"] = metrics
        return self._request(
            "POST", f"/adapters/{adapter_id}/heartbeat", json=body
        )

    # ─── Steps ─────────────────────────────────────────────────

    def poll_pending(
        self, adapter_id: str, limit: int = 10
    ) -> list[StepInfo]:
        data = self._request(
            "GET",
            f"/adapters/{adapter_id}/steps/pending",
            params={"limit": str(limit)},
        )
        return [StepInfo(**s) for s in data["steps"]]

    def get_step(self, step_id: str) -> StepInfo:
        data = self._request("GET", f"/steps/{step_id}")
        return StepInfo(**data)

    def claim_step(
        self, adapter_id: str, step_id: str, lease_ms: int = 120_000
    ) -> ClaimResult:
        data = self._request(
            "POST",
            f"/adapters/{adapter_id}/steps/{step_id}/claim",
            json={"lease_ms": lease_ms},
        )
        return ClaimResult(**data)

    def submit_step(
        self,
        adapter_id: str,
        step_id: str,
        *,
        chain_id: str,
        status: str = "completed",
        memo: str = "",
        artifacts: list[dict[str, Any]] | None = None,
        metrics: dict[str, Any] | None = None,
    ) -> SubmitResult:
        body: dict[str, Any] = {
            "step_id": step_id,
            "chain_id": chain_id,
            "status": status,
            "memo": memo,
            "artifacts": artifacts or [],
        }
        if metrics:
            body["metrics"] = metrics
        data = self._request(
            "POST",
            f"/adapters/{adapter_id}/steps/{step_id}/submit",
            json=body,
        )
        return SubmitResult(**data)

    # ─── Metrics ───────────────────────────────────────────────

    def metrics(self) -> Metrics:
        data = self._request("GET", "/metrics")
        return Metrics(**data)


class AsyncClient:
    """Async thin client for the Society Protocol HTTP adapter API."""

    def __init__(
        self,
        base_url: str = "http://localhost:8080",
        api_key: str | None = None,
        timeout: float = 30.0,
    ):
        headers: dict[str, str] = {}
        if api_key:
            headers["X-API-Key"] = api_key
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=timeout,
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "AsyncClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    # ─── Internal ──────────────────────────────────────────────

    async def _request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        resp = await self._http.request(method, path, **kwargs)
        if resp.status_code >= 400:
            detail = resp.text
            try:
                detail = resp.json().get("error", detail)
            except Exception:
                pass
            raise SocietyError(resp.status_code, detail)
        return resp.json()

    # ─── Health ────────────────────────────────────────────────

    async def health(self) -> HealthStatus:
        data = await self._request("GET", "/health")
        return HealthStatus(**data)

    # ─── Adapter Registration ──────────────────────────────────

    async def register(
        self,
        display_name: str,
        runtime: str = "custom",
        kinds: list[str] | None = None,
        specialties: list[str] | None = None,
        max_concurrency: int = 1,
        endpoint: str = "",
        description: str | None = None,
    ) -> AdapterRegistration:
        body: dict[str, Any] = {
            "display_name": display_name,
            "runtime": runtime,
            "kinds": kinds or ["task"],
            "specialties": specialties or [],
            "max_concurrency": max_concurrency,
            "endpoint": endpoint,
            "version": "1.0.0",
            "auth_type": "none",
        }
        if description:
            body["description"] = description
        data = await self._request("POST", "/adapters/register", json=body)
        return AdapterRegistration(**data)

    async def get_adapter(self, adapter_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/adapters/{adapter_id}")

    async def list_adapters(self, kind: str | None = None) -> list[AdapterInfo]:
        params: dict[str, str] = {}
        if kind:
            params["kind"] = kind
        data = await self._request("GET", "/adapters", params=params)
        return [AdapterInfo(**a) for a in data["adapters"]]

    async def update_capabilities(
        self, adapter_id: str, **capabilities: Any
    ) -> dict[str, Any]:
        return await self._request(
            "PUT", f"/adapters/{adapter_id}/capabilities", json=capabilities
        )

    # ─── Heartbeat ─────────────────────────────────────────────

    async def heartbeat(
        self,
        adapter_id: str,
        active_tasks: int = 0,
        queue_depth: int = 0,
        metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "active_tasks": active_tasks,
            "queue_depth": queue_depth,
        }
        if metrics:
            body["metrics"] = metrics
        return await self._request(
            "POST", f"/adapters/{adapter_id}/heartbeat", json=body
        )

    # ─── Steps ─────────────────────────────────────────────────

    async def poll_pending(
        self, adapter_id: str, limit: int = 10
    ) -> list[StepInfo]:
        data = await self._request(
            "GET",
            f"/adapters/{adapter_id}/steps/pending",
            params={"limit": str(limit)},
        )
        return [StepInfo(**s) for s in data["steps"]]

    async def get_step(self, step_id: str) -> StepInfo:
        data = await self._request("GET", f"/steps/{step_id}")
        return StepInfo(**data)

    async def claim_step(
        self, adapter_id: str, step_id: str, lease_ms: int = 120_000
    ) -> ClaimResult:
        data = await self._request(
            "POST",
            f"/adapters/{adapter_id}/steps/{step_id}/claim",
            json={"lease_ms": lease_ms},
        )
        return ClaimResult(**data)

    async def submit_step(
        self,
        adapter_id: str,
        step_id: str,
        *,
        chain_id: str,
        status: str = "completed",
        memo: str = "",
        artifacts: list[dict[str, Any]] | None = None,
        metrics: dict[str, Any] | None = None,
    ) -> SubmitResult:
        body: dict[str, Any] = {
            "step_id": step_id,
            "chain_id": chain_id,
            "status": status,
            "memo": memo,
            "artifacts": artifacts or [],
        }
        if metrics:
            body["metrics"] = metrics
        data = await self._request(
            "POST",
            f"/adapters/{adapter_id}/steps/{step_id}/submit",
            json=body,
        )
        return SubmitResult(**data)

    # ─── Metrics ───────────────────────────────────────────────

    async def metrics(self) -> Metrics:
        data = await self._request("GET", "/metrics")
        return Metrics(**data)
