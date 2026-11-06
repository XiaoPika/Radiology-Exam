import json
import shutil
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Form, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.exam import Exam as ExamModel
from app.models.case import Case as CaseModel
from app.models.case_series import CaseSeries
from app.models.question import Question as QuestionModel
from app.models.user import User as UserModel
from app.models.answer_session import AnswerSession
from app.models.answer_record import AnswerRecord

router = APIRouter()

async def _finalize_session(session: AnswerSession, db: AsyncSession) -> dict:
    """Submit a session: compute score and mark submitted_at. Returns summary."""
    records_result = await db.execute(
        select(AnswerRecord).where(AnswerRecord.session_id == session.id)
    )
    records = records_result.scalars().all()

    total_answered = len(records)
    correct = sum(1 for r in records if r.is_correct)

    q_count_result = await db.execute(
        select(func.count(QuestionModel.id))
        .join(CaseModel, QuestionModel.case_id == CaseModel.id)
        .where(CaseModel.exam_id == session.exam_id)
    )
    total_questions = q_count_result.scalar() or 0

    score_pct = round(correct / total_questions * 100, 2) if total_questions > 0 else 0

    session.submitted_at = datetime.now()
    session.total_score = correct
    session.total_questions = total_questions
    session.score_percentage = score_pct
    await db.flush()

    return {
        "session_id": session.id,
        "total_score": correct,
        "total_answered": total_answered,
        "total_questions": total_questions,
        "score_percentage": score_pct,
        "submitted_at": session.submitted_at.isoformat(),
    }


@router.get("/{access_code}")
async def get_exam_info(
    access_code: str,
    db: AsyncSession = Depends(get_db),
):
    """Get exam info by access code (public endpoint)."""
    result = await db.execute(
        select(ExamModel).where(ExamModel.access_code == access_code)
    )
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在或链接无效")
    if not exam.is_published:
        raise HTTPException(status_code=403, detail="该考试尚未发布")

    # Count cases
    case_count_result = await db.execute(
        select(func.count(CaseModel.id)).where(CaseModel.exam_id == exam.id)
    )
    case_count = case_count_result.scalar()
    question_count_result = await db.execute(
        select(func.count(QuestionModel.id))
        .join(CaseModel, QuestionModel.case_id == CaseModel.id)
        .where(CaseModel.exam_id == exam.id)
    )
    question_count = question_count_result.scalar()

    return {
        "id": exam.id,
        "title": exam.title,
        "description": exam.description,
        "access_code": exam.access_code,
        "case_count": case_count,
        "question_count": question_count,
    }


@router.post("/{access_code}/register")
async def register_user(
    access_code: str,
    name: str = Form(...),
    department: str = Form(None),
    employee_id: str = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Register user / resume an in-progress session for an exam.

    Behaviour:
      - If a session with this name already exists and is SUBMITTED → 409
        (cannot retake without admin invalidating).
      - If an in-progress (unsubmitted) session exists → return the existing
        session_id so the user keeps answering from where they were.
      - Otherwise create a new user + session.
    """
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="姓名不能为空")

    result = await db.execute(
        select(ExamModel).where(ExamModel.access_code == access_code)
    )
    exam = result.scalar_one_or_none()
    if not exam or not exam.is_published:
        raise HTTPException(status_code=404, detail="考试不存在或未发布")

    # Look for any existing session for this name + exam
    existing_result = await db.execute(
        select(AnswerSession, UserModel)
        .join(UserModel, AnswerSession.user_id == UserModel.id)
        .where(
            UserModel.name == name.strip(),
            AnswerSession.exam_id == exam.id,
        )
    )
    rows = existing_result.all()

    submitted_session = None
    inprogress_session = None
    user_for_resume = None
    for sess, usr in rows:
        if sess.submitted_at is not None:
            submitted_session = sess
            break
        if inprogress_session is None:
            inprogress_session = sess
            user_for_resume = usr

    if submitted_session is not None:
        raise HTTPException(
            status_code=409,
            detail="您已经完成了答题，如需重新答题，请联系管理员处理"
        )

    if inprogress_session is not None:
        # Resume — optionally update department/employee_id if provided now
        if department is not None:
            user_for_resume.department = department.strip() if department else None
        if employee_id is not None:
            user_for_resume.employee_id = employee_id.strip() if employee_id else None
        await db.flush()
        return {
            "session_id": inprogress_session.id,
            "user_id": user_for_resume.id,
            "user_name": user_for_resume.name,
            "exam_id": exam.id,
            "exam_title": exam.title,
            "is_completed": False,
            "resumed": True,
        }

    # Create user
    user = UserModel(
        name=name.strip(),
        department=department.strip() if department else None,
        employee_id=employee_id.strip() if employee_id else None,
    )
    db.add(user)
    await db.flush()

    # Create session
    session = AnswerSession(
        user_id=user.id,
        exam_id=exam.id,
        access_code=access_code,
    )
    db.add(session)
    await db.flush()
    await db.refresh(session)

    return {
        "session_id": session.id,
        "user_id": user.id,
        "user_name": user.name,
        "exam_id": exam.id,
        "exam_title": exam.title,
        "is_completed": False,
    }


@router.get("/{access_code}/cases")
async def get_exam_cases(
    access_code: str,
    db: AsyncSession = Depends(get_db),
):
    """Get all cases for an exam (without answers - for user viewing)."""
    result = await db.execute(
        select(ExamModel).where(ExamModel.access_code == access_code)
    )
    exam = result.scalar_one_or_none()
    if not exam or not exam.is_published:
        raise HTTPException(status_code=404, detail="考试不存在或未发布")

    cases_result = await db.execute(
        select(CaseModel)
        .where(CaseModel.exam_id == exam.id)
        .order_by(CaseModel.sort_order)
    )
    cases = cases_result.scalars().all()

    case_list = []
    for case in cases:
        series_result = await db.execute(
            select(CaseSeries)
            .where(CaseSeries.case_id == case.id)
            .order_by(CaseSeries.sort_order)
        )
        series_list = [
            {
                "id": s.id,
                "sort_order": s.sort_order,
                "series_description": s.series_description,
                "series_folder": s.series_folder,
                "image_count": s.image_count,
                "thumbnail_url": s.thumbnail_url,
            }
            for s in series_result.scalars().all()
        ]

        q_result = await db.execute(
            select(QuestionModel)
            .where(QuestionModel.case_id == case.id)
            .order_by(QuestionModel.sort_order)
        )
        questions = q_result.scalars().all()

        case_list.append({
            "id": case.id,
            "sort_order": case.sort_order,
            "notes": case.notes,
            "study_description": case.study_description,
            "patient_sex": case.patient_sex,
            "patient_age": case.patient_age,
            "dicom_folder": case.dicom_folder,
            "series": series_list,
            "questions": [
                {
                    "id": q.id,
                    "question_type": q.question_type,
                    "question_text": q.question_text,
                    "options": q.options,
                    "sort_order": q.sort_order,
                    "is_multi": len(_split_answers(q.correct_answer or "")) > 1,
                }
                for q in questions
            ],
        })

    return {"cases": case_list, "total": len(case_list)}


@router.get("/{access_code}/cases/{case_id}")
async def get_case_detail(
    access_code: str,
    case_id: int,
    session_id: int = None,
    db: AsyncSession = Depends(get_db),
):
    """Get case detail with questions, DICOM info, and locked previous answers.

    Returned answers carry ``locked: true`` once they have been saved for the
    case, so the frontend renders them read-only.
    """
    result = await db.execute(
        select(ExamModel).where(ExamModel.access_code == access_code)
    )
    exam = result.scalar_one_or_none()
    if not exam or not exam.is_published:
        raise HTTPException(status_code=404, detail="考试不存在或未发布")

    sess_result = await db.execute(
        select(AnswerSession).where(AnswerSession.id == session_id)
    )
    session = sess_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.exam_id != exam.id or session.access_code != access_code:
        raise HTTPException(status_code=404, detail="会话不存在")

    # If already submitted, signal completion so the client shows the result.
    if session.submitted_at is not None:
        raise HTTPException(status_code=409, detail="该答卷已提交，无法继续答题")

    case_result = await db.execute(
        select(CaseModel).where(
            CaseModel.id == case_id,
            CaseModel.exam_id == exam.id,
        )
    )
    case = case_result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    series_result = await db.execute(
        select(CaseSeries)
        .where(CaseSeries.case_id == case.id)
        .order_by(CaseSeries.sort_order)
    )
    series_list = [
        {
            "id": s.id,
            "sort_order": s.sort_order,
            "series_description": s.series_description,
            "series_folder": s.series_folder,
            "image_count": s.image_count,
            "thumbnail_url": s.thumbnail_url,
        }
        for s in series_result.scalars().all()
    ]

    q_result = await db.execute(
        select(QuestionModel)
        .where(QuestionModel.case_id == case.id)
        .order_by(QuestionModel.sort_order)
    )
    questions = q_result.scalars().all()

    # Get existing saved answers for this case (these are LOCKED once saved)
    answers_result = await db.execute(
        select(AnswerRecord).where(
            AnswerRecord.session_id == session_id,
            AnswerRecord.case_id == case_id,
        )
    )
    existing_answers = answers_result.scalars().all()
    answers_map = {ar.question_id: ar.user_answer for ar in existing_answers}
    case_has_saved = len(existing_answers) > 0

    return {
        "id": case.id,
        "notes": case.notes,
        "study_description": case.study_description,
        "patient_sex": case.patient_sex,
        "patient_age": case.patient_age,
        "dicom_folder": case.dicom_folder,
        "series": series_list,
        "answers_locked": case_has_saved,
        "questions": [
            {
                "id": q.id,
                "question_type": q.question_type,
                "question_text": q.question_text,
                "options": q.options,
                "sort_order": q.sort_order,
                "previous_answer": answers_map.get(q.id),
                "locked": q.id in answers_map,
                # Whether this question is multi-select. Derived from the
                # cardinality of correct_answer split on the Chinese semicolon —
                # exposes only the count, never the answer itself, so it's safe
                # to ship to the candidate UI.
                "is_multi": len(_split_answers(q.correct_answer or "")) > 1,
            }
            for q in questions
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Answer grading
#
# A question's `correct_answer` may contain one or more correct answers,
# separated by the full-width Chinese semicolon "；" (U+FF1B). Both half-width
# ";" and full-width "；" are tolerated as separators on input.
#
#   multiple_choice (set-equality): the user must select exactly the full set
#     of correct options. The user's answer is likewise stored as a "；"-joined
#     string (e.g. "A；C"). Order is irrelevant — we compare sets after
#     normalising case.
#   fill_blank (any-match): the user's answer is correct if it matches ANY
#     one of the correct answers (case-insensitive, trimmed).
#
# Legacy single-answer data (no separator) degrades to the original behaviour:
# a one-element set, so set-equality / any-match both reduce to a plain compare.
# ─────────────────────────────────────────────────────────────────────────────
def _split_answers(raw: str) -> list[str]:
    """Split a `；`/`;`-joined answer string into trimmed, non-empty parts."""
    parts = raw.replace(";", "；").split("；")
    return [p.strip() for p in parts if p.strip()]


def _check_answer(question, user_answer: str) -> bool:
    correct_set = _split_answers(question.correct_answer or "")
    if question.question_type == "fill_blank":
        u = user_answer.strip().lower()
        return any(u == c.strip().lower() for c in correct_set)
    # multiple_choice — set equality, order-independent, uppercase compare
    user_set = {c.strip().upper() for c in _split_answers(user_answer) if c.strip()}
    correct = {c.strip().upper() for c in correct_set}
    return user_set == correct


@router.post("/{access_code}/cases/{case_id}/answer")
async def submit_case_answer(
    access_code: str,
    case_id: int,
    session_id: int = Form(...),
    answers: str = Form(None),  # JSON string like '{"qid": "answer"}'
    db: AsyncSession = Depends(get_db),
):
    """Save answers for a case (one case = one lock-step).

    Once a case has been saved, subsequent saves for that case are rejected
    (409) — answers are immutable after the user moves to the next case.
    Empty/blank answers are recorded as unanswered (is_correct=None).
    """
    if answers:
        try:
            answers_dict = json.loads(answers)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="答案格式无效")
    else:
        answers_dict = {}

    exam_result = await db.execute(
        select(ExamModel).where(ExamModel.access_code == access_code)
    )
    exam = exam_result.scalar_one_or_none()
    if not exam or not exam.is_published:
        raise HTTPException(status_code=404, detail="考试不存在或未发布")

    sess_result = await db.execute(
        select(AnswerSession).where(AnswerSession.id == session_id)
    )
    session = sess_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.exam_id != exam.id or session.access_code != access_code:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.submitted_at is not None:
        raise HTTPException(status_code=409, detail="该答卷已提交，无法保存答案")

    # Verify case belongs to this exam
    case_result = await db.execute(
        select(CaseModel).where(CaseModel.id == case_id)
    )
    case = case_result.scalar_one_or_none()
    if not case or case.exam_id != exam.id:
        raise HTTPException(status_code=404, detail="病例不存在")

    # Reject if this case was already saved (locked) → answers are immutable
    existing = (await db.execute(
        select(AnswerRecord).where(
            AnswerRecord.session_id == session_id,
            AnswerRecord.case_id == case_id,
        )
    )).scalars().all()
    if existing:
        raise HTTPException(
            status_code=409, detail="该病例答案已提交，不可修改"
        )

    if answers_dict:
        for q_id, user_answer in answers_dict.items():
            q_result = await db.execute(
                select(QuestionModel).where(QuestionModel.id == int(q_id))
            )
            question = q_result.scalar_one_or_none()
            if not question:
                continue
            # Only save questions that belong to this case
            if question.case_id != case_id:
                continue

            is_correct = None
            if user_answer and user_answer.strip():
                is_correct = _check_answer(question, user_answer)

            record = AnswerRecord(
                session_id=session_id,
                case_id=case_id,
                question_id=int(q_id),
                user_answer=user_answer if user_answer else None,
                is_correct=is_correct,
            )
            db.add(record)

    # Mark progress
    session.last_progress_at = datetime.now()
    await db.flush()
    return {"message": "答案已保存"}


@router.post("/{access_code}/submit")
async def submit_exam(
    access_code: str,
    session_id: int = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """Submit entire exam and calculate score."""
    sess_result = await db.execute(
        select(AnswerSession).where(AnswerSession.id == session_id)
    )
    session = sess_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.access_code != access_code:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.submitted_at is not None:
        # Idempotent — return existing summary
        return {
            "session_id": session.id,
            "total_score": session.total_score,
            "total_answered": 0,
            "total_questions": session.total_questions,
            "score_percentage": float(session.score_percentage or 0),
            "submitted_at": session.submitted_at.isoformat(),
        }

    summary = await _finalize_session(session, db)
    return {
        **summary,
        "records": [
            {
                "question_id": r.question_id,
                "case_id": r.case_id,
                "user_answer": r.user_answer,
                "is_correct": r.is_correct,
            }
            for r in (await db.execute(
                select(AnswerRecord).where(AnswerRecord.session_id == session_id)
            )).scalars().all()
        ],
    }


@router.get("/session/{session_id}/result")
async def get_result(
    session_id: int,
    access_code: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Get exam result for a session."""
    sess_result = await db.execute(
        select(AnswerSession).where(AnswerSession.id == session_id)
    )
    session = sess_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if not access_code or session.access_code != access_code:
        raise HTTPException(status_code=404, detail="会话不存在")

    if not session.submitted_at:
        raise HTTPException(status_code=400, detail="考试尚未提交")

    user_result = await db.execute(
        select(UserModel).where(UserModel.id == session.user_id)
    )
    user = user_result.scalar_one_or_none()

    exam_result = await db.execute(
        select(ExamModel).where(ExamModel.id == session.exam_id)
    )
    exam = exam_result.scalar_one_or_none()

    records_result = await db.execute(
        select(AnswerRecord).where(AnswerRecord.session_id == session_id)
    )
    records = records_result.scalars().all()

    return {
        "session_id": session.id,
        "user_name": user.name if user else "",
        "exam_title": exam.title if exam else "",
        "total_score": session.total_score,
        "total_questions": session.total_questions,
        "score_percentage": session.score_percentage,
        "started_at": session.started_at.isoformat() if session.started_at else "",
        "submitted_at": session.submitted_at.isoformat() if session.submitted_at else "",
        "records": [
            {
                "question_id": r.question_id,
                "case_id": r.case_id,
                "user_answer": r.user_answer,
                "is_correct": r.is_correct,
            }
            for r in records
        ],
    }
