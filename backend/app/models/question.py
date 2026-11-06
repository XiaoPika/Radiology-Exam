from datetime import datetime

from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, Enum, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"))
    question_type: Mapped[str] = mapped_column(
        Enum("multiple_choice", "fill_blank", name="question_type_enum"), nullable=False
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    options: Mapped[str | None] = mapped_column(JSON)  # ["A. xxx", "B. xxx", ...]
    correct_answer: Mapped[str] = mapped_column(String(500), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    case = relationship("Case", back_populates="questions")
    answer_records = relationship("AnswerRecord", back_populates="question",
                                  cascade="all, delete-orphan")
