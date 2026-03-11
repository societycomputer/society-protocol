"""Tests for Society Protocol Python SDK."""

import pytest
import httpx
import respx

from society import (
    Client,
    AsyncClient,
    SocietyError,
    HealthStatus,
    AdapterRegistration,
    StepInfo,
    ClaimResult,
    SubmitResult,
    AdapterInfo,
    Metrics,
)


BASE = "http://localhost:8080"


# ─── Sync Client Tests ────────────────────────────────────────────


class TestSyncClient:
    def test_health(self):
        with respx.mock:
            respx.get(f"{BASE}/health").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "status": "ok",
                        "version": "society-1.0.0",
                        "adapters": 3,
                        "timestamp": 1700000000,
                    },
                )
            )
            with Client(BASE) as client:
                result = client.health()
                assert isinstance(result, HealthStatus)
                assert result.status == "ok"
                assert result.adapters == 3

    def test_register_adapter(self):
        with respx.mock:
            respx.post(f"{BASE}/adapters/register").mock(
                return_value=httpx.Response(
                    201,
                    json={
                        "adapter_id": "adapter_123",
                        "status": "registered",
                        "message": "Adapter registered successfully",
                    },
                )
            )
            with Client(BASE) as client:
                reg = client.register(
                    display_name="TestAgent",
                    runtime="custom",
                    kinds=["task", "review"],
                    specialties=["nlp"],
                )
                assert isinstance(reg, AdapterRegistration)
                assert reg.adapter_id == "adapter_123"
                assert reg.status == "registered"

    def test_api_key_header(self):
        with respx.mock:
            route = respx.get(f"{BASE}/health").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "status": "ok",
                        "version": "society-1.0.0",
                        "adapters": 0,
                        "timestamp": 1700000000,
                    },
                )
            )
            with Client(BASE, api_key="secret-key") as client:
                client.health()
                assert route.called
                req = route.calls[0].request
                assert req.headers["X-API-Key"] == "secret-key"

    def test_list_adapters(self):
        with respx.mock:
            respx.get(f"{BASE}/adapters").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "adapters": [
                            {
                                "adapter_id": "a1",
                                "display_name": "Agent1",
                                "runtime": "custom",
                                "kinds": ["task"],
                                "specialties": ["nlp"],
                                "active_tasks": 1,
                                "health": "healthy",
                            }
                        ],
                        "total": 1,
                    },
                )
            )
            with Client(BASE) as client:
                adapters = client.list_adapters()
                assert len(adapters) == 1
                assert isinstance(adapters[0], AdapterInfo)
                assert adapters[0].display_name == "Agent1"

    def test_poll_pending_steps(self):
        with respx.mock:
            respx.get(f"{BASE}/adapters/a1/steps/pending").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "steps": [
                            {
                                "step_id": "s1",
                                "chain_id": "c1",
                                "kind": "task",
                                "title": "Analyze data",
                            }
                        ],
                        "adapter": {"id": "a1", "active_tasks": 0, "health": "healthy"},
                    },
                )
            )
            with Client(BASE) as client:
                steps = client.poll_pending("a1", limit=5)
                assert len(steps) == 1
                assert isinstance(steps[0], StepInfo)
                assert steps[0].step_id == "s1"
                assert steps[0].kind == "task"

    def test_claim_step(self):
        with respx.mock:
            respx.post(f"{BASE}/adapters/a1/steps/s1/claim").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "status": "claimed",
                        "step_id": "s1",
                        "chain_id": "c1",
                        "lease_expires_at": 1700120000,
                    },
                )
            )
            with Client(BASE) as client:
                claim = client.claim_step("a1", "s1", lease_ms=60_000)
                assert isinstance(claim, ClaimResult)
                assert claim.status == "claimed"

    def test_submit_step(self):
        with respx.mock:
            respx.post(f"{BASE}/adapters/a1/steps/s1/submit").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "status": "submitted",
                        "step_id": "s1",
                        "chain_id": "c1",
                    },
                )
            )
            with Client(BASE) as client:
                result = client.submit_step(
                    "a1", "s1",
                    chain_id="c1",
                    status="completed",
                    memo="Analysis complete",
                    artifacts=[],
                )
                assert isinstance(result, SubmitResult)
                assert result.status == "submitted"

    def test_heartbeat(self):
        with respx.mock:
            respx.post(f"{BASE}/adapters/a1/heartbeat").mock(
                return_value=httpx.Response(
                    200,
                    json={"status": "ok", "timestamp": 1700000000},
                )
            )
            with Client(BASE) as client:
                result = client.heartbeat("a1", active_tasks=2, queue_depth=5)
                assert result["status"] == "ok"

    def test_metrics(self):
        with respx.mock:
            respx.get(f"{BASE}/metrics").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "total_adapters": 5,
                        "healthy_adapters": 4,
                        "degraded_adapters": 1,
                        "total_active_tasks": 10,
                        "total_completed_tasks": 100,
                        "steps_claimed": 3,
                    },
                )
            )
            with Client(BASE) as client:
                m = client.metrics()
                assert isinstance(m, Metrics)
                assert m.total_adapters == 5
                assert m.healthy_adapters == 4

    def test_error_handling(self):
        with respx.mock:
            respx.get(f"{BASE}/adapters/invalid").mock(
                return_value=httpx.Response(
                    404, json={"error": "Adapter not found"}
                )
            )
            with Client(BASE) as client:
                with pytest.raises(SocietyError) as exc_info:
                    client.get_adapter("invalid")
                assert exc_info.value.status_code == 404
                assert "Adapter not found" in exc_info.value.detail

    def test_get_step(self):
        with respx.mock:
            respx.get(f"{BASE}/steps/s1").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "step_id": "s1",
                        "chain_id": "c1",
                        "kind": "task",
                        "title": "Summarize",
                        "status": "proposed",
                        "depends_on": ["s0"],
                    },
                )
            )
            with Client(BASE) as client:
                step = client.get_step("s1")
                assert step.step_id == "s1"
                assert step.depends_on == ["s0"]

    def test_context_manager(self):
        with respx.mock:
            respx.get(f"{BASE}/health").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "status": "ok",
                        "version": "society-1.0.0",
                        "adapters": 0,
                        "timestamp": 0,
                    },
                )
            )
            with Client(BASE) as client:
                client.health()
            # Client should be closed after context manager exits


# ─── Async Client Tests ───────────────────────────────────────────


class TestAsyncClient:
    @pytest.mark.asyncio
    async def test_health(self):
        with respx.mock:
            respx.get(f"{BASE}/health").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "status": "ok",
                        "version": "society-1.0.0",
                        "adapters": 2,
                        "timestamp": 1700000000,
                    },
                )
            )
            async with AsyncClient(BASE) as client:
                result = await client.health()
                assert isinstance(result, HealthStatus)
                assert result.adapters == 2

    @pytest.mark.asyncio
    async def test_register_and_poll(self):
        with respx.mock:
            respx.post(f"{BASE}/adapters/register").mock(
                return_value=httpx.Response(
                    201,
                    json={
                        "adapter_id": "adapter_async",
                        "status": "registered",
                        "message": "OK",
                    },
                )
            )
            respx.get(f"{BASE}/adapters/adapter_async/steps/pending").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "steps": [
                            {
                                "step_id": "s2",
                                "chain_id": "c2",
                                "kind": "review",
                                "title": "Review analysis",
                            }
                        ],
                        "adapter": {
                            "id": "adapter_async",
                            "active_tasks": 0,
                            "health": "healthy",
                        },
                    },
                )
            )
            async with AsyncClient(BASE) as client:
                reg = await client.register(
                    display_name="AsyncAgent",
                    kinds=["review"],
                )
                assert reg.adapter_id == "adapter_async"

                steps = await client.poll_pending("adapter_async")
                assert len(steps) == 1
                assert steps[0].kind == "review"

    @pytest.mark.asyncio
    async def test_full_workflow(self):
        with respx.mock:
            respx.post(f"{BASE}/adapters/register").mock(
                return_value=httpx.Response(
                    201,
                    json={
                        "adapter_id": "a_wf",
                        "status": "registered",
                        "message": "OK",
                    },
                )
            )
            respx.get(f"{BASE}/adapters/a_wf/steps/pending").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "steps": [
                            {
                                "step_id": "s_wf",
                                "chain_id": "c_wf",
                                "kind": "task",
                                "title": "Process data",
                            }
                        ],
                        "adapter": {
                            "id": "a_wf",
                            "active_tasks": 0,
                            "health": "healthy",
                        },
                    },
                )
            )
            respx.post(f"{BASE}/adapters/a_wf/steps/s_wf/claim").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "status": "claimed",
                        "step_id": "s_wf",
                        "chain_id": "c_wf",
                        "lease_expires_at": 1700120000,
                    },
                )
            )
            respx.post(f"{BASE}/adapters/a_wf/steps/s_wf/submit").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "status": "submitted",
                        "step_id": "s_wf",
                        "chain_id": "c_wf",
                    },
                )
            )
            respx.post(f"{BASE}/adapters/a_wf/heartbeat").mock(
                return_value=httpx.Response(
                    200, json={"status": "ok", "timestamp": 1700000000}
                )
            )

            async with AsyncClient(BASE) as client:
                # Register
                reg = await client.register(display_name="WorkflowAgent", kinds=["task"])
                assert reg.adapter_id == "a_wf"

                # Poll
                steps = await client.poll_pending("a_wf")
                assert len(steps) == 1

                # Claim
                claim = await client.claim_step("a_wf", "s_wf")
                assert claim.status == "claimed"

                # Submit
                result = await client.submit_step(
                    "a_wf", "s_wf",
                    chain_id="c_wf",
                    status="completed",
                    memo="Data processed successfully",
                )
                assert result.status == "submitted"

                # Heartbeat
                hb = await client.heartbeat("a_wf", active_tasks=0)
                assert hb["status"] == "ok"

    @pytest.mark.asyncio
    async def test_error_handling(self):
        with respx.mock:
            respx.post(f"{BASE}/adapters/a1/steps/s1/claim").mock(
                return_value=httpx.Response(
                    409,
                    json={
                        "error": "Step already claimed",
                        "claimed_by": "other_adapter",
                    },
                )
            )
            async with AsyncClient(BASE) as client:
                with pytest.raises(SocietyError) as exc_info:
                    await client.claim_step("a1", "s1")
                assert exc_info.value.status_code == 409

    @pytest.mark.asyncio
    async def test_metrics(self):
        with respx.mock:
            respx.get(f"{BASE}/metrics").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "total_adapters": 10,
                        "healthy_adapters": 8,
                        "degraded_adapters": 2,
                        "total_active_tasks": 15,
                        "total_completed_tasks": 200,
                        "steps_claimed": 5,
                    },
                )
            )
            async with AsyncClient(BASE) as client:
                m = await client.metrics()
                assert m.total_adapters == 10
                assert m.total_completed_tasks == 200
