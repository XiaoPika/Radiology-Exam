from datetime import datetime

from sqlalchemy import String, Integer, DateTime, ForeignKey, func, DECIMAL
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AnswerSession(Base):
    __tablename__ = "answer_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"))
    access_code: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_progress_at: Mapped[datetime | None] = mapped_column(
        DateTime, onupdate=func.now()
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    total_score: Mapped[int | None] = mapped_column(Integer)
    total_questions: Mapped[int | None] = mapped_column(Integer)
    score_percentage: Mapped[float | None] = mapped_column(DECIMAL(5, 2))

    user = relationship("User", back_populates="answer_sessions")
    exam = relationship("Exam", back_populates="answer_sessions")
    answer_records = relationship("AnswerRecord", back_populates="session",
                                  cascade="all, delete-orphan")
