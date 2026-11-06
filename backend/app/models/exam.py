import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Text, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    access_code: Mapped[str] = mapped_column(
        String(32), unique=True, nullable=False, default=lambda: uuid.uuid4().hex[:8]
    )
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    # creator_id = None means "migrated legacy exam (owned by superadmin)"
    creator_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True
    )
    # share_token: when set, allows public read-only access to the statistics page
    share_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    cases = relationship("Case", back_populates="exam", cascade="all, delete-orphan",
                         order_by="Case.sort_order")
    answer_sessions = relationship("AnswerSession", back_populates="exam",
                                   cascade="all, delete-orphan")
    creator = relationship("AdminUser", back_populates="exams", foreign_keys=[creator_id])
