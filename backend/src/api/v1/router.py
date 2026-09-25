"""
router.py — Unified Platform API v1 router.
Aggregates all route modules from registry and red-teaming systems.
"""
from fastapi import APIRouter

from src.api.v1.registry import router as registry_router
from src.api.v1.unified_register import router as unified_register_router
from src.api.v1.version_webhook import router as version_webhook_router
from src.api.v1.agents import router as agents_router
from src.api.v1.registered_agents import router as registered_agents_router
from src.api.v1.redteam_stream import router as stream_router
from src.api.v1.batch import router as batch_router
from src.api.v1.exports import router as exports_router
from src.api.v1.notifications import router as notifications_router
from src.api.v1.threat_models import router as threat_models_router
from src.api.v1.auth import router as auth_router

api_v1_router = APIRouter()

# Registry routes (prefix-free, mounted at root level)
api_v1_router.include_router(registry_router)

# Unified register + version events
api_v1_router.include_router(unified_register_router)
api_v1_router.include_router(version_webhook_router)

# Red-team routes
api_v1_router.include_router(agents_router)
api_v1_router.include_router(registered_agents_router)
api_v1_router.include_router(stream_router)
api_v1_router.include_router(batch_router)
api_v1_router.include_router(exports_router)
api_v1_router.include_router(notifications_router)
api_v1_router.include_router(threat_models_router)
api_v1_router.include_router(auth_router)
