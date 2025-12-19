"""
Security utilities: password hashing and JWT auth.

- Passwords are hashed as:  salt$sha256(salt + password)
- Tokens are JWT (HS256) signed with env var JWT_SECRET_KEY.
"""

import os
import time
import hmac
import hashlib
import secrets
from typing import Optional, Dict, Any

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .database import get_db
from .models import User


def get_jwt_secret() -> str:
    return os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-change-me")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return f"{salt}${digest}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        salt, digest = password_hash.split("$", 1)
    except ValueError:
        return False
    computed = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return hmac.compare_digest(computed, digest)


def create_access_token(
    user_id: str,
    role: str,
    expires_in_seconds: int = 60 * 60 * 24 * 7,  # 7 days
) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + expires_in_seconds,
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm="HS256")


def decode_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


security = HTTPBearer()
optional_security = HTTPBearer(auto_error=False)


def get_current_user(
    db: Session = Depends(get_db),
    creds: HTTPAuthorizationCredentials = Depends(security),
) -> User:
    payload = decode_token(creds.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def get_optional_user(
    db: Session = Depends(get_db),
    creds: HTTPAuthorizationCredentials | None = Depends(optional_security),
) -> Optional[User]:
    if not creds:
        return None
    payload = decode_token(creds.credentials)
    user_id = payload.get("sub")
    if not user_id:
        return None
    return db.query(User).filter(User.id == user_id).first()


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
