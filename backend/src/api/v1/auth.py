"""
auth.py — JWT Authentication API
Signup, login, and user context validation.
"""
import uuid
import datetime
import hashlib
import jwt
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from src.db.session import get_db
from src.db.models import UserEntity

from src.config import settings

router = APIRouter(prefix="/auth", tags=["Authentication"])

SECRET_KEY = settings.JWT_SECRET_KEY or "truviq_redteam_dev_jwt_key"
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 72


class SignupRequest(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = ""


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user_optional(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> Optional[UserEntity]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            return None
        return db.query(UserEntity).filter(UserEntity.id == user_id).first()
    except Exception:
        return None


def get_current_user_required(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> UserEntity:
    user = get_current_user_optional(authorization, db)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication credentials required")
    return user


@router.post("/signup", response_model=AuthResponse)
async def signup(req: SignupRequest, db: Session = Depends(get_db)):
    existing = db.query(UserEntity).filter(UserEntity.email == req.email.lower().strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists")

    user_id = str(uuid.uuid4())
    pw_hash = hash_password(req.password)
    user = UserEntity(
        id=user_id,
        email=req.email.lower().strip(),
        password_hash=pw_hash,
        full_name=req.full_name or req.email.split("@")[0].capitalize(),
    )
    db.add(user)
    db.commit()

    token = create_access_token(user_id, user.email)
    return AuthResponse(
        access_token=token,
        user=UserResponse(id=user.id, email=user.email, full_name=user.full_name)
    )


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest, db: Session = Depends(get_db)):
    pw_hash = hash_password(req.password)
    user = db.query(UserEntity).filter(
        UserEntity.email == req.email.lower().strip(),
        UserEntity.password_hash == pw_hash
    ).first()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(user.id, user.email)
    return AuthResponse(
        access_token=token,
        user=UserResponse(id=user.id, email=user.email, full_name=user.full_name)
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: UserEntity = Depends(get_current_user_required)):
    return UserResponse(id=user.id, email=user.email, full_name=user.full_name)
