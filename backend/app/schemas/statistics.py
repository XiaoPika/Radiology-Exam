from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class OverviewStats(BaseModel):
    total_participants: int
    total_questions: int
    avg_score: float
    max_score: int
    min_score: int
    avg_duration_minutes: float


class PerQuestionStats(BaseModel):
    question_id: int
    question_text: str
    case_id: int
    correct_count: int
    incorrect_count: int
    skip_count: int
    error_rate: float


class PerUserStats(BaseModel):
    user_id: int
    user_name: str
    department: Optional[str]
    score: int
    total: int
    percentage: float
    duration_minutes: float
    submitted_at: Optional[datetime]


class TimeDistribution(BaseModel):
    range_label: str  # "0-5min", "5-10min" etc
    count: int
