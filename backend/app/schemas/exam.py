from pydantic import BaseModel
from datetime import datetime
from typing import Optional


# --- Exam ---
class ExamCreate(BaseModel):
    title: str
    description: Optional[str] = None


class ExamUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class ExamResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    access_code: str
    is_published: bool
    case_count: int = 0
    question_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Series ---
class SeriesResponse(BaseModel):
    id: int
    sort_order: int
    series_description: str
    series_folder: str
    image_count: int
    thumbnail_url: Optional[str]

    class Config:
        from_attributes = True


# --- Case ---
class CaseResponse(BaseModel):
    id: int
    exam_id: int
    sort_order: int
    notes: Optional[str]
    study_description: Optional[str]
    patient_sex: Optional[str]
    patient_age: Optional[str]
    dicom_folder: str
    series: list[SeriesResponse] = []
    questions: list["QuestionResponse"] = []
    created_at: datetime

    class Config:
        from_attributes = True


# --- Question ---
class QuestionCreate(BaseModel):
    question_type: str
    question_text: str
    options: Optional[list[str]] = None
    correct_answer: str
    sort_order: int = 0


class QuestionUpdate(BaseModel):
    question_type: Optional[str] = None
    question_text: Optional[str] = None
    options: Optional[list[str]] = None
    correct_answer: Optional[str] = None
    sort_order: Optional[int] = None


class QuestionResponse(BaseModel):
    id: int
    case_id: int
    question_type: str
    question_text: str
    options: Optional[list[str]]
    sort_order: int

    class Config:
        from_attributes = True
