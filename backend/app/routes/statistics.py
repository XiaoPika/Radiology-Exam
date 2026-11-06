from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Form, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, text, case

from app.database import get_db
from app.utils.auth import decode_access_token, verify_token
from app.models.admin_user import AdminUser
from app.models.exam import Exam as ExamModel
from app.models.case import Case as CaseModel
from app.models.question import Question as QuestionModel
from app.models.answer_session import AnswerSession
from app.models.answer_record import AnswerRecord
from app.models.user import User as UserModel

router = APIRouter()

_opt_bearer = HTTPBearer(auto_error=False)


def _can_access_exam(exam: ExamModel, payload: dict) -> bool:
    if payload.get("is_superadmin"):
        return True
    return exam.creator_id == payload.get("admin_id")


async def _current_admin_payload(
    credentials: HTTPAuthorizationCredentials,
    db: AsyncSession,
) -> dict:
    payload = decode_access_token(credentials)
    result = await db.execute(
        select(AdminUser).where(AdminUser.id == payload["admin_id"])
    )
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_active:
        raise HTTPException(status_code=401, detail="管理员账号不存在或已停用")
    return {
        "admin_id": admin.id,
        "username": admin.username,
        "display_name": admin.display_name,
        "is_superadmin": bool(admin.is_superadmin),
    }


async def _require_exam_access(
    exam_id: int,
    db: AsyncSession,
    payload: dict,
) -> ExamModel:
    result = await db.execute(select(ExamModel).where(ExamModel.id == exam_id))
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    if not _can_access_exam(exam, payload):
        raise HTTPException(status_code=403, detail="无权访问此考试")
    return exam


async def verify_stats_access(
    exam_id: int,
    share_token: Optional[str] = Query(None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_opt_bearer),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Allow access if caller has a valid JWT *or* a valid share_token for this exam.

    Returns a dict with at least {"readonly": bool}.
    """
    # 1. Try share_token (public read-only)
    if share_token:
        result = await db.execute(
            select(ExamModel).where(
                ExamModel.id == exam_id,
                ExamModel.share_token == share_token,
            )
        )
        exam = result.scalar_one_or_none()
        if exam:
            return {"readonly": True, "admin_id": None, "is_superadmin": False}
        raise HTTPException(status_code=403, detail="分享token无效或已过期")

    # 2. Fall back to JWT
    if credentials is None:
        raise HTTPException(status_code=401, detail="需要登录或提供分享token")

    payload = await _current_admin_payload(credentials, db)
    await _require_exam_access(exam_id, db, payload)
    return {**payload, "readonly": False}


@router.delete("/invalidate/{session_id}")
async def invalidate_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    """Delete a session and its answers, allowing user to re-take exam."""
    sess = await db.execute(select(AnswerSession).where(AnswerSession.id == session_id))
    session = sess.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    await _require_exam_access(session.exam_id, db, payload)
    await db.delete(session)
    await db.flush()
    return {"message": "已作废"}


@router.put("/edit-user/{user_id}")
async def edit_user(
    user_id: int,
    name: str = Form(None),
    department: str = Form(None),
    employee_id: str = Form(None),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    """Edit user information."""
    u = await db.execute(select(UserModel).where(UserModel.id == user_id))
    user = u.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not payload.get("is_superadmin"):
        exams_result = await db.execute(
            select(ExamModel)
            .join(AnswerSession, AnswerSession.exam_id == ExamModel.id)
            .where(AnswerSession.user_id == user_id)
        )
        exams = exams_result.scalars().all()
        if not exams or any(not _can_access_exam(exam, payload) for exam in exams):
            raise HTTPException(status_code=403, detail="无权修改该考生信息")
    if name is not None:
        user.name = name.strip()
    if department is not None:
        user.department = department.strip() if department else None
    if employee_id is not None:
        user.employee_id = employee_id.strip() if employee_id else None
    await db.flush()
    return {"message": "用户信息已更新"}


# ============================================================
# Overview
# ============================================================

@router.get("/{exam_id}/overview")
async def get_overview(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(verify_stats_access),
):
    """Rich overview: participants, score distribution, pass rates, etc."""
    # Aggregate session stats
    agg_result = await db.execute(
        select(
            func.count(AnswerSession.id).label("total"),
            func.avg(AnswerSession.score_percentage).label("avg_score"),
            func.max(AnswerSession.score_percentage).label("max_score"),
            func.min(AnswerSession.score_percentage).label("min_score"),
            func.stddev(AnswerSession.score_percentage).label("stddev_score"),
        ).where(
            and_(
                AnswerSession.exam_id == exam_id,
                AnswerSession.submitted_at.isnot(None),
            )
        )
    )
    agg = agg_result.one()

    total_participants = agg.total or 0
    avg_score = round(float(agg.avg_score or 0), 1)
    max_score = round(float(agg.max_score or 0), 1)
    min_score = round(float(agg.min_score or 0), 1)
    stddev_score = round(float(agg.stddev_score or 0), 1)

    # Average duration
    dur_result = await db.execute(
        text("""
            SELECT AVG(TIMESTAMPDIFF(SECOND, started_at, submitted_at))
            FROM answer_sessions
            WHERE exam_id = :exam_id AND submitted_at IS NOT NULL
        """),
        {"exam_id": exam_id},
    )
    avg_seconds = dur_result.scalar() or 0

    # Total questions
    total_q_result = await db.execute(
        select(func.count(QuestionModel.id))
        .join(CaseModel, QuestionModel.case_id == CaseModel.id)
        .where(CaseModel.exam_id == exam_id)
    )
    total_questions = total_q_result.scalar() or 0

    # Score distribution buckets (avoid 'pass'/'fail' — Python keywords)
    dist_result = await db.execute(
        text("""
            SELECT
                SUM(CASE WHEN score_percentage >= 90 THEN 1 ELSE 0 END) AS d_excellent,
                SUM(CASE WHEN score_percentage >= 80 AND score_percentage < 90 THEN 1 ELSE 0 END) AS d_good,
                SUM(CASE WHEN score_percentage >= 60 AND score_percentage < 80 THEN 1 ELSE 0 END) AS d_passing,
                SUM(CASE WHEN score_percentage < 60 THEN 1 ELSE 0 END) AS d_failing
            FROM answer_sessions
            WHERE exam_id = :exam_id AND submitted_at IS NOT NULL
        """),
        {"exam_id": exam_id},
    )
    buckets = dist_result.one()
    d_excellent = buckets.d_excellent or 0
    d_good = buckets.d_good or 0
    d_passing = buckets.d_passing or 0
    d_failing = buckets.d_failing or 0
    pass_count = d_excellent + d_good + d_passing

    return {
        "total_participants": total_participants,
        "total_questions": total_questions,
        "avg_score": avg_score,
        "max_score": max_score,
        "min_score": min_score,
        "stddev_score": stddev_score,
        "avg_duration_seconds": int(avg_seconds),
        "avg_duration_minutes": round(avg_seconds / 60, 1),
        "score_distribution": {
            "excellent": d_excellent,
            "good": d_good,
            "pass": d_passing,
            "fail": d_failing,
        },
        "pass_rate": round(pass_count / total_participants * 100, 1) if total_participants > 0 else 0,
        "pass_count": pass_count,
    }


# ============================================================
# Per-question with rich context
# ============================================================

@router.get("/{exam_id}/per-question")
async def get_per_question_stats(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(verify_stats_access),
):
    """Per-question stats with case context and answer distribution."""
    questions_result = await db.execute(
        select(QuestionModel)
        .join(CaseModel, QuestionModel.case_id == CaseModel.id)
        .where(CaseModel.exam_id == exam_id)
        .order_by(CaseModel.sort_order, QuestionModel.sort_order)
    )
    questions = questions_result.scalars().all()

    stats = []
    for q in questions:
        correct_result = await db.execute(
            select(func.count(AnswerRecord.id)).where(
                and_(AnswerRecord.question_id == q.id, AnswerRecord.is_correct == True)
            )
        )
        correct_count = correct_result.scalar() or 0

        incorrect_result = await db.execute(
            select(func.count(AnswerRecord.id)).where(
                and_(AnswerRecord.question_id == q.id, AnswerRecord.is_correct == False)
            )
        )
        incorrect_count = incorrect_result.scalar() or 0

        skip_result = await db.execute(
            select(func.count(AnswerRecord.id)).where(
                and_(AnswerRecord.question_id == q.id, AnswerRecord.is_correct.is_(None))
            )
        )
        skip_count = skip_result.scalar() or 0

        total = correct_count + incorrect_count + skip_count
        error_rate = round(incorrect_count / total * 100, 1) if total > 0 else 0
        accuracy = round(correct_count / total * 100, 1) if total > 0 else 0

        # Wrong answer distribution
        wrong_answers_result = await db.execute(
            select(AnswerRecord.user_answer, func.count(AnswerRecord.id).label("cnt"))
            .where(
                and_(
                    AnswerRecord.question_id == q.id,
                    AnswerRecord.is_correct == False,
                )
            )
            .group_by(AnswerRecord.user_answer)
            .order_by(func.count(AnswerRecord.id).desc())
        )
        wrong_dist = [
            {"answer": row.user_answer or "(空)", "count": row.cnt}
            for row in wrong_answers_result.fetchall()
        ]

        case_result = await db.execute(select(CaseModel).where(CaseModel.id == q.case_id))
        case = case_result.scalar_one_or_none()

        # Difficulty rating
        if total > 0:
            if accuracy >= 80:
                difficulty = "简单"
            elif accuracy >= 50:
                difficulty = "中等"
            else:
                difficulty = "困难"
        else:
            difficulty = "—"

        stats.append({
            "question_id": q.id,
            "question_text": q.question_text,
            "question_type": q.question_type,
            "case_id": q.case_id,
            "case_sort_order": case.sort_order if case else 0,
            "case_study": case.study_description if case else "",
            "correct_answer": q.correct_answer,
            "correct_count": correct_count,
            "incorrect_count": incorrect_count,
            "skip_count": skip_count,
            "total_responses": total,
            "error_rate": error_rate,
            "accuracy": accuracy,
            "difficulty": difficulty,
            "wrong_answer_distribution": wrong_dist,
        })

    return {"questions": stats}


# ============================================================
# Per-user with richer data
# ============================================================

@router.get("/{exam_id}/per-user")
async def get_per_user_stats(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(verify_stats_access),
):
    """Per-user with case-level breakdown and speed metrics."""
    sessions_result = await db.execute(
        select(AnswerSession, UserModel)
        .join(UserModel, AnswerSession.user_id == UserModel.id)
        .where(
            and_(
                AnswerSession.exam_id == exam_id,
                AnswerSession.submitted_at.isnot(None),
            )
        )
        .order_by(AnswerSession.score_percentage.desc())
    )
    sessions = sessions_result.all()

    # Pre-fetch all answer records for this exam
    all_records_result = await db.execute(
        select(AnswerRecord)
        .where(AnswerRecord.session_id.in_([s.id for s, _ in sessions]))
    )
    all_records = all_records_result.scalars().all()
    records_by_session = {}
    for r in all_records:
        records_by_session.setdefault(r.session_id, []).append(r)

    # Pre-fetch question info
    questions_result = await db.execute(
        select(QuestionModel, CaseModel.sort_order, CaseModel.study_description)
        .join(CaseModel, QuestionModel.case_id == CaseModel.id)
        .where(CaseModel.exam_id == exam_id)
    )
    q_rows = questions_result.fetchall()
    q_info = {}
    for q, case_order, case_study in q_rows:
        q_info[q.id] = {"case_order": case_order, "case_study": case_study, "answer": q.correct_answer}

    users = []
    for rank, (session, user) in enumerate(sessions, 1):
        duration_seconds = (
            (session.submitted_at - session.started_at).total_seconds()
            if session.submitted_at and session.started_at else 0
        )
        records = records_by_session.get(session.id, [])

        # Case-level breakdown
        case_groups = {}
        for r in records:
            ci = q_info.get(r.question_id, {})
            key = ci.get("case_order", r.case_id)
            case_groups.setdefault(key, {"correct": 0, "wrong": 0, "skip": 0})
            if r.is_correct is True:
                case_groups[key]["correct"] += 1
            elif r.is_correct is False:
                case_groups[key]["wrong"] += 1
            else:
                case_groups[key]["skip"] += 1

        case_breakdown = []
        for case_idx in sorted(case_groups.keys()):
            g = case_groups[case_idx]
            total_c = g["correct"] + g["wrong"] + g["skip"]
            pct = round(g["correct"] / total_c * 100, 1) if total_c > 0 else 0
            case_breakdown.append({
                "case_id": case_idx,
                "correct": g["correct"],
                "wrong": g["wrong"],
                "skip": g["skip"],
                "total": total_c,
                "pct": pct,
            })

        records_data = []
        for r in records:
            info = q_info.get(r.question_id, {})
            records_data.append({
                "question_id": r.question_id,
                "case_id": r.case_id,
                "case_sort_order": info.get("case_order", r.case_id),
                "user_answer": r.user_answer,
                "is_correct": r.is_correct,
                "correct_answer": info.get("answer", ""),
            })

        # Speed per question (assuming serial answering, approximate)
        # If answered all in one session, compute relative speed
        total_questions = len(records)
        speed_per_q = round(duration_seconds / total_questions, 1) if total_questions > 0 else 0

        users.append({
            "rank": rank,
            "user_id": user.id,
            "user_name": user.name,
            "department": user.department,
            "employee_id": user.employee_id,
            "session_id": session.id,
            "score": session.total_score,
            "total": session.total_questions,
            "percentage": float(session.score_percentage or 0),
            "duration_seconds": int(duration_seconds),
            "duration_minutes": round(duration_seconds / 60, 1),
            "speed_per_question_sec": speed_per_q,
            "submitted_at": session.submitted_at.isoformat() if session.submitted_at else "",
            "case_breakdown": case_breakdown,
            "records": records_data,
        })

    return {"users": users}


# ============================================================
# Time distribution (richer)
# ============================================================

@router.get("/{exam_id}/time-distribution")
async def get_time_distribution(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(verify_stats_access),
):
    """Time distribution with granular buckets and correlation hints."""
    duration_result = await db.execute(
        text("""
            SELECT TIMESTAMPDIFF(SECOND, started_at, submitted_at)
            FROM answer_sessions
            WHERE exam_id = :exam_id AND submitted_at IS NOT NULL
        """),
        {"exam_id": exam_id},
    )
    durations_seconds = [row[0] for row in duration_result.fetchall()]

    ranges = [
        {"label": "<2分钟", "min_min": 0, "max_min": 2},
        {"label": "2-5分钟", "min_min": 2, "max_min": 5},
        {"label": "5-10分钟", "min_min": 5, "max_min": 10},
        {"label": "10-15分钟", "min_min": 10, "max_min": 15},
        {"label": "15-25分钟", "min_min": 15, "max_min": 25},
        {"label": ">25分钟", "min_min": 25, "max_min": 999},
    ]
    distribution = []
    for r in ranges:
        cnt = sum(1 for d in durations_seconds if r["min_min"] * 60 <= (d or 0) < r["max_min"] * 60)
        distribution.append({"range_label": r["label"], "count": cnt})

    return {
        "distribution": distribution,
        "total_respondents": len(durations_seconds),
    }


# ============================================================
# Comprehensive exam analysis (NEW!)
# ============================================================

@router.get("/{exam_id}/case-analysis")
async def get_case_analysis(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(verify_stats_access),
):
    """Per-case aggregated analysis: which cases were hardest."""
    cases_result = await db.execute(
        select(CaseModel)
        .where(CaseModel.exam_id == exam_id)
        .order_by(CaseModel.sort_order)
    )
    cases = cases_result.scalars().all()

    case_stats = []
    for case in cases:
        q_result = await db.execute(
            select(QuestionModel).where(QuestionModel.case_id == case.id)
        )
        questions = q_result.scalars().all()
        q_ids = [q.id for q in questions]

        correct = 0
        incorrect = 0
        skipped = 0
        if q_ids:
            c_result = await db.execute(
                select(func.count(AnswerRecord.id)).where(
                    and_(AnswerRecord.question_id.in_(q_ids), AnswerRecord.is_correct == True)
                )
            )
            correct = c_result.scalar() or 0
            w_result = await db.execute(
                select(func.count(AnswerRecord.id)).where(
                    and_(AnswerRecord.question_id.in_(q_ids), AnswerRecord.is_correct == False)
                )
            )
            incorrect = w_result.scalar() or 0
            s_result = await db.execute(
                select(func.count(AnswerRecord.id)).where(
                    and_(AnswerRecord.question_id.in_(q_ids), AnswerRecord.is_correct.is_(None))
                )
            )
            skipped = s_result.scalar() or 0

        total = correct + incorrect + skipped
        accuracy = round(correct / total * 100, 1) if total > 0 else 0

        case_stats.append({
            "case_id": case.id,
            "sort_order": case.sort_order,
            "notes": case.notes,
            "study_description": case.study_description,
            "question_count": len(questions),
            "correct": correct,
            "incorrect": incorrect,
            "skipped": skipped,
            "total_responses": total,
            "accuracy": accuracy,
        })

    return {"cases": case_stats}
