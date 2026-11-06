from datetime import datetime

from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id", ondelete="CASCADE"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    dicom_folder: Mapped[str] = mapped_column(String(255), nullable=False)
    patient_sex: Mapped[str | None] = mapped_column(String(1))
    patient_age: Mapped[str | None] = mapped_column(String(10))
    study_description: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    exam = relationship("Exam", back_populates="cases")
    series = relationship("CaseSeries", back_populates="case", cascade="all, delete-orphan",
                          order_by="CaseSeries.sort_order")
    questions = relationship("Question", back_populates="case", cascade="all, delete-orphan",
                             order_by="Question.sort_order")
    answer_records = relationship("AnswerRecord", back_populates="case",
                                  cascade="all, delete-orphan")
