from datetime import datetime

from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CaseSeries(Base):
    """Represents one DICOM series within a case. A case can have multiple series."""

    __tablename__ = "case_series"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    series_description: Mapped[str | None] = mapped_column(String(255))
    series_folder: Mapped[str] = mapped_column(String(255), nullable=False)
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    thumbnail_url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    case = relationship("Case", back_populates="series")
