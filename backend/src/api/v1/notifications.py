"""
notifications.py — Threat Alerts & Notifications API
Lists threats, detailed vulnerability failure breakdowns, and status updates.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from src.db.session import get_db
from src.db.models import NotificationEntity, SessionEntity, AttackTranscriptEntity, RegisteredAgentEntity
from src.api.v1.auth import get_current_user_optional

router = APIRouter(prefix="/notifications", tags=["Threat Notifications"])


class NotificationDTO(BaseModel):
    id: str
    agent_id: str
    session_id: str
    agent_name: str
    severity: str
    title: str
    message: str
    failed_vulnerabilities: List[str]
    confidence_score: Optional[float]
    is_read: bool
    created_at: str


@router.get("", response_model=List[NotificationDTO])
async def list_notifications(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """Lists all threat notifications ordered by newest first.
    Scoped by user_id when JWT is provided."""
    query = db.query(NotificationEntity)
    if current_user:
        query = query.filter(NotificationEntity.user_id == current_user.id)

    notifications = query.order_by(
        NotificationEntity.created_at.desc()
    ).all()

    return [
        NotificationDTO(
            id=n.id,
            agent_id=n.agent_id,
            session_id=n.session_id,
            agent_name=n.agent_name,
            severity=n.severity,
            title=n.title,
            message=n.message,
            failed_vulnerabilities=n.failed_vulnerabilities or [],
            confidence_score=n.confidence_score,
            is_read=n.is_read,
            created_at=n.created_at.isoformat(),
        )
        for n in notifications
    ]


@router.get("/{notification_id}")
async def get_notification_detail(notification_id: str, db: Session = Depends(get_db)):
    """Returns detailed threat report for a notification including failed vulnerability transcripts."""
    notif = db.query(NotificationEntity).filter(NotificationEntity.id == notification_id).first()
    if not notif:
        raise HTTPException(404, "Notification not found")

    # Fetch failed transcripts for this session
    failed_transcripts = db.query(AttackTranscriptEntity).filter(
        AttackTranscriptEntity.session_id == notif.session_id,
        AttackTranscriptEntity.passed == False
    ).all()

    agent = db.query(RegisteredAgentEntity).filter(RegisteredAgentEntity.id == notif.agent_id).first()

    return {
        "notification": {
            "id": notif.id,
            "agent_id": notif.agent_id,
            "session_id": notif.session_id,
            "agent_name": notif.agent_name,
            "severity": notif.severity,
            "title": notif.title,
            "message": notif.message,
            "failed_vulnerabilities": notif.failed_vulnerabilities or [],
            "confidence_score": notif.confidence_score,
            "is_read": notif.is_read,
            "created_at": notif.created_at.isoformat(),
        },
        "agent": {
            "name": agent.name if agent else notif.agent_name,
            "target_url": agent.target_url if agent else "Unknown",
            "domain": agent.domain if agent else "general",
            "sensitivity": agent.sensitivity if agent else "high",
        },
        "failed_probes_count": len(failed_transcripts),
        "failed_transcripts": [
            {
                "id": t.id,
                "framework": t.framework,
                "vulnerability": t.vulnerability,
                "attack_method": t.attack_method,
                "input_prompt": t.input_prompt,
                "target_response": t.target_response,
                "evaluator_score": t.evaluator_score,
                "verdict": t.verdict,
                "reasoning": t.reasoning,
            }
            for t in failed_transcripts
        ],
    }


@router.patch("/{notification_id}/read")
async def mark_as_read(notification_id: str, db: Session = Depends(get_db)):
    """Marks a notification as read."""
    notif = db.query(NotificationEntity).filter(NotificationEntity.id == notification_id).first()
    if not notif:
        raise HTTPException(404, "Notification not found")

    notif.is_read = True
    db.commit()
    return {"status": "success", "id": notification_id, "is_read": True}
