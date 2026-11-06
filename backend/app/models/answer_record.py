from datetime import datetime

from sqlalchemy import String, Integer, DateTime, ForeignKey, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AnswerRecord(Base):
    __tablename__ = "answer_records"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("answer_sessions.id", ondelete="CASCADE")
    )
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"))
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"))
    user_answer: Mapped[str | None] = mapped_column(String(500))
    is_correct: Mapped[bool | None] = mapped_column(Boolean)
    answered_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    session = relationship("AnswerSession", back_populates="answer_records")
    case = relationship("Case", back_populates="answer_records")
    question = relationship("Question", back_populates="answer_records")
