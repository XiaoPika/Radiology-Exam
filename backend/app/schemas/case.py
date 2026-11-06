from pydantic import BaseModel
from typing import Optional


class CaseUpdate(BaseModel):
    notes: Optional[str] = None
    sort_order: Optional[int] = None
