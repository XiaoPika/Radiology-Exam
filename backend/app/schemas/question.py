from pydantic import BaseModel
from typing import Optional


class QuestionCreate(BaseModel):
    question_type: str  # multiple_choice | fill_blank
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
