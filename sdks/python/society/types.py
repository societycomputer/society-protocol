"""Society Protocol type definitions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class HealthStatus:
    status: str
    version: str
    adapters: int
    timestamp: int


@dataclass
class StepInfo:
    step_id: str
    chain_id: str
    kind: str
    title: str
    description: str | None = None
    status: str | None = None
    assignee_did: str | None = None
    depends_on: list[str] = field(default_factory=list)
    requirements: dict[str, Any] | None = None
    timeout_ms: int | None = None


@dataclass
class AdapterInfo:
    adapter_id: str
    display_name: str
    runtime: str
    kinds: list[str]
    specialties: list[str] = field(default_factory=list)
    active_tasks: int = 0
    health: str = "healthy"
    last_heartbeat: int | None = None


@dataclass
class AdapterRegistration:
    adapter_id: str
    status: str
    message: str


@dataclass
class ClaimResult:
    status: str
    step_id: str
    chain_id: str
    lease_expires_at: int


@dataclass
class SubmitResult:
    status: str
    step_id: str
    chain_id: str


@dataclass
class Artifact:
    artifact_id: str
    artifact_type: str
    content_hash: str
    size_bytes: int
    encoding: Literal["utf8", "base64", "binary"] = "utf8"
    content: str | None = None
    uri: str | None = None
    metadata: dict[str, Any] | None = None


@dataclass
class Metrics:
    total_adapters: int = 0
    healthy_adapters: int = 0
    degraded_adapters: int = 0
    total_active_tasks: int = 0
    total_completed_tasks: int = 0
    steps_claimed: int = 0
