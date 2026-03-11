"""Society Protocol Python SDK.

Usage:
    from society import Client, AsyncClient

    # Sync
    client = Client("http://localhost:8080", api_key="my-key")
    print(client.health())

    # Async
    async with AsyncClient("http://localhost:8080") as client:
        print(await client.health())
"""

from .client import AsyncClient, Client, SocietyError
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

__version__ = "1.0.0"
__all__ = [
    "Client",
    "AsyncClient",
    "SocietyError",
    "HealthStatus",
    "StepInfo",
    "AdapterInfo",
    "AdapterRegistration",
    "ClaimResult",
    "SubmitResult",
    "Artifact",
    "Metrics",
]
