import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db, async_session
from app.routes import admin, exam, dicom, statistics


async def _ensure_root_admin():
    """Create the root superadmin account (default: user/admin) if it doesn't exist yet."""
    from sqlalchemy import select
    from app.models.admin_user import AdminUser
    from app.utils.auth import hash_password, verify_password
    from app.config import settings

    root_username = settings.admin_username
    root_password = settings.admin_password

    async with async_session() as session:
        result = await session.execute(
            select(AdminUser).where(AdminUser.username == root_username)
        )
        existing = result.scalar_one_or_none()
        if existing is None:
            root = AdminUser(
                username=root_username,
                display_name="超级管理员",
                hashed_password=hash_password(root_password),
                is_superadmin=True,
                is_active=True,
            )
            session.add(root)
            await session.commit()
            print(f"[startup] Root superadmin account '{root_username}' created.")
        else:
            changed = False
            if not existing.is_superadmin:
                existing.is_superadmin = True
                changed = True
            if not verify_password(root_password, existing.hashed_password):
                existing.hashed_password = hash_password(root_password)
                changed = True
                print(f"[startup] Root superadmin password for '{root_username}' synced from env.")
            if changed:
                await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: init DB tables
    os.makedirs("/data/dicom", exist_ok=True)
    os.makedirs("/data/uploads", exist_ok=True)
    await init_db()
    await _ensure_root_admin()
    yield


app = FastAPI(
    title="医学影像问卷系统 API",
    description="Radiology Exam Questionnaire System",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(exam.router, prefix="/api/exam", tags=["Exam"])
app.include_router(dicom.router, prefix="/api/dicom", tags=["DICOM"])
app.include_router(statistics.router, prefix="/api/admin/statistics", tags=["Statistics"])


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "message": "Radiology Exam System API is running"}
