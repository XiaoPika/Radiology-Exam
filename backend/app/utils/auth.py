"""Authentication utilities for the admin API.

JWT payload shape:
  {
    "sub": "<admin_user.id>",          # str of int
    "username": "<admin_user.username>",
    "is_superadmin": true | false,
    "exp": ...,
    "iat": ...,
  }

Backward-compat: the old single-admin token had "sub": "admin".  We still
accept it (treating it as superadmin) so existing sessions are not invalidated
immediately after the upgrade.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.admin_user import AdminUser

security_scheme = HTTPBearer()
# Use sha256_crypt to avoid passlib/bcrypt 5.x compatibility issues
pwd_context = CryptContext(schemes=["sha256_crypt"], deprecated="auto")


# ──────────────────────────────────────────────────────────────────────────────
# Password helpers
# ──────────────────────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ──────────────────────────────────────────────────────────────────────────────
# Token helpers
# ──────────────────────────────────────────────────────────────────────────────

def create_access_token(
    admin_id: int,
    username: str,
    is_superadmin: bool,
) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {
        "sub": str(admin_id),
        "username": username,
        "is_superadmin": is_superadmin,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(
    credentials: HTTPAuthorizationCredentials,
) -> dict:
    """Decode a JWT and return the admin claims without touching the database."""
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token, settings.secret_key, algorithms=[settings.algorithm]
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token无效或已过期",
        )

    sub = payload.get("sub")
    if sub is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token格式错误",
        )

    # Backward-compat: old token had sub="admin" (string, not numeric)
    if sub in ("admin", "user"):
        return {
            "admin_id": 1,          # superadmin always id=1
            "username": "admin",
            "is_superadmin": True,
        }

    try:
        admin_id = int(sub)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token格式错误",
        )

    return {
        "admin_id": admin_id,
        "username": payload.get("username", ""),
        "is_superadmin": bool(payload.get("is_superadmin", False)),
    }


async def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Validate JWT, confirm the admin is still active, and return current claims.

    The returned dict always contains:
      - ``admin_id``: int
      - ``username``: str
      - ``is_superadmin``: bool
    """
    payload = decode_access_token(credentials)
    result = await db.execute(
        select(AdminUser).where(AdminUser.id == payload["admin_id"])
    )
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="管理员账号不存在或已停用",
        )

    return {
        "admin_id": admin.id,
        "username": admin.username,
        "display_name": admin.display_name,
        "is_superadmin": bool(admin.is_superadmin),
    }


def require_superadmin(payload: dict = Depends(verify_token)) -> dict:
    """Dependency that requires the caller to be a superadmin."""
    if not payload.get("is_superadmin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅超级管理员可执行此操作",
        )
    return payload


# Keep old helper for backward compat (used nowhere new; safe to remove later)
def verify_admin_password(password: str) -> bool:
    return password == settings.admin_password
