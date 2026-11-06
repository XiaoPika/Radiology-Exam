"""Admin API routes.

Authentication model:
  - POST /login          → verify username + password → JWT
  - Superadmin can see / manage ALL exams and all admin users.
  - Regular admin can only see / manage exams they created.
"""

import os
import uuid
import shutil
import tempfile

from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.config import settings
from app.database import get_db
from app.utils.auth import (
    verify_token,
    require_superadmin,
    create_access_token,
    hash_password,
    verify_password,
)
from app.services.dicom_processor import DicomProcessor
from app.models.admin_user import AdminUser
from app.models.exam import Exam as ExamModel
from app.models.case import Case as CaseModel
from app.models.case_series import CaseSeries
from app.models.system_setting import SystemSetting

router = APIRouter()

# Key controlling self-service admin registration (boolean "true"/"false").
REGISTRATION_OPEN_KEY = "admin_registration_open"


def _clean_upload_filename(filename: str | None, fallback: str = "upload") -> str:
    name = (filename or fallback).replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not name or name in {".", ".."}:
        return fallback
    return name


def _upload_tmp_path(upload_dir: str, prefix: str, filename: str | None) -> str:
    return os.path.join(upload_dir, f"{prefix}_{_clean_upload_filename(filename)}")


async def _get_bool_setting(db: AsyncSession, key: str, default: bool = False) -> bool:
    """Read a boolean system setting from the KV table."""
    row = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    s = row.scalar_one_or_none()
    if s is None:
        return default
    return s.value.strip().lower() in ("1", "true", "yes", "on")


async def _set_bool_setting(db: AsyncSession, key: str, value: bool) -> None:
    """Upsert a boolean system setting."""
    row = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    s = row.scalar_one_or_none()
    val = "true" if value else "false"
    if s is None:
        db.add(SystemSetting(key=key, value=val))
    else:
        s.value = val
    await db.flush()


# ─────────────────────────────────────────────────────────────────────────────
# Public admin self-registration (open/closed controlled by superadmin)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/register")
async def public_register_admin(
    username: str = Form(...),
    display_name: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """Self-service admin registration.

    Open only when superadmin has enabled the toggle (default: closed).
    Newly registered admins are regular admins (is_superadmin=False),
    can only see/modify exams they themselves create.
    """
    open_flag = await _get_bool_setting(db, REGISTRATION_OPEN_KEY, default=False)
    if not open_flag:
        raise HTTPException(status_code=403, detail="管理员自助注册功能已关闭，请联系超管")

    username = username.strip()
    display_name = display_name.strip()
    if not username or not display_name:
        raise HTTPException(status_code=400, detail="用户名和显示名称不能为空")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少6位")

    existing = await db.execute(select(AdminUser).where(AdminUser.username == username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="用户名已存在")
    if username.lower() in ("admin", "user", "root", settings.admin_username.lower()):
        raise HTTPException(status_code=400, detail="该用户名为保留账号")

    user = AdminUser(
        username=username,
        display_name=display_name,
        hashed_password=hash_password(password),
        is_superadmin=False,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "message": "注册成功，请使用该账号登录",
    }


@router.get("/registration")
async def get_registration_status(db: AsyncSession = Depends(get_db)):
    """Public: report whether self-registration is open (used by login page)."""
    return {"open": await _get_bool_setting(db, REGISTRATION_OPEN_KEY, default=False)}


@router.put("/registration")
async def set_registration_status(
    open_flag: bool = Form(..., alias="open"),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_superadmin),
):
    """Superadmin-only: hot-toggle the self-registration switch."""
    await _set_bool_setting(db, REGISTRATION_OPEN_KEY, bool(open_flag))
    return {"open": bool(open_flag), "message": "注册开关已更新"}


# ─────────────────────────────────────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/login")
async def admin_login(
    username: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """Login with username + password; returns JWT."""
    result = await db.execute(
        select(AdminUser).where(AdminUser.username == username)
    )
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_active:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not verify_password(password, admin.hashed_password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_access_token(admin.id, admin.username, admin.is_superadmin)
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": admin.username,
        "display_name": admin.display_name,
        "is_superadmin": admin.is_superadmin,
    }


@router.get("/verify")
async def verify(payload: dict = Depends(verify_token)):
    """Verify admin token is still valid."""
    return {
        "valid": True,
        "admin_id": payload["admin_id"],
        "username": payload["username"],
        "is_superadmin": payload["is_superadmin"],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Admin user management (superadmin only)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/users")
async def list_admin_users(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_superadmin),
):
    """List all admin users (superadmin only)."""
    result = await db.execute(select(AdminUser).order_by(AdminUser.id))
    users = result.scalars().all()
    return {
        "users": [
            {
                "id": u.id,
                "username": u.username,
                "display_name": u.display_name,
                "is_superadmin": u.is_superadmin,
                "is_active": u.is_active,
                "created_at": u.created_at.isoformat(),
            }
            for u in users
        ]
    }


@router.post("/users")
async def create_admin_user(
    username: str = Form(...),
    display_name: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_superadmin),
):
    """Create a new admin user (superadmin only)."""
    existing = await db.execute(select(AdminUser).where(AdminUser.username == username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="用户名已存在")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少6位")

    user = AdminUser(
        username=username,
        display_name=display_name,
        hashed_password=hash_password(password),
        is_superadmin=False,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "is_superadmin": user.is_superadmin,
        "is_active": user.is_active,
    }


@router.put("/users/{user_id}")
async def update_admin_user(
    user_id: int,
    display_name: Optional[str] = Form(None),
    password: Optional[str] = Form(None),
    is_active: Optional[bool] = Form(None),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_superadmin),
):
    """Update an admin user (superadmin only)."""
    result = await db.execute(select(AdminUser).where(AdminUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.is_superadmin and not payload["is_superadmin"]:
        raise HTTPException(status_code=403, detail="不能修改超级管理员")

    if display_name is not None:
        user.display_name = display_name.strip()
    if password is not None:
        if len(password) < 6:
            raise HTTPException(status_code=400, detail="密码至少6位")
        user.hashed_password = hash_password(password)
    if is_active is not None:
        if user.is_superadmin or user.username in ("admin", "user", settings.admin_username):
            raise HTTPException(status_code=400, detail="不能禁用超级管理员账号")
        user.is_active = is_active

    await db.flush()
    return {"message": "更新成功"}


@router.delete("/users/{user_id}")
async def delete_admin_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_superadmin),
):
    """Delete an admin user (superadmin only). Cannot delete root admin."""
    result = await db.execute(select(AdminUser).where(AdminUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.username == "admin":
        raise HTTPException(status_code=400, detail="不能删除根管理员账号")

    await db.delete(user)
    await db.flush()
    return {"message": "删除成功"}


# ─────────────────────────────────────────────────────────────────────────────
# Exam CRUD
# ─────────────────────────────────────────────────────────────────────────────

def _exam_visible(exam: ExamModel, payload: dict) -> bool:
    """Return True if the exam is visible to the current admin."""
    if payload["is_superadmin"]:
        return True
    # creator_id=None means migrated legacy exam → owned by superadmin, not visible to sub-admins
    return exam.creator_id == payload["admin_id"]


def _require_exam_access(exam: ExamModel, payload: dict):
    if not _exam_visible(exam, payload):
        raise HTTPException(status_code=403, detail="无权访问此考试")


@router.post("/exams")
async def create_exam(
    title: str = Form(...),
    description: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    """Create a new exam."""
    exam = ExamModel(
        title=title,
        description=description,
        access_code=uuid.uuid4().hex[:8],
        creator_id=payload["admin_id"],
    )
    db.add(exam)
    await db.flush()
    await db.refresh(exam)
    return _exam_to_dict(exam, case_count=0, question_count=0, creator_name="")


@router.get("/exams")
async def list_exams(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    """List exams.  Superadmin sees all; regular admin sees only own exams."""
    from app.models.question import Question as QuestionModel

    query = select(ExamModel).order_by(ExamModel.created_at.desc())
    if not payload["is_superadmin"]:
        query = query.where(ExamModel.creator_id == payload["admin_id"])

    result = await db.execute(query)
    exams = result.scalars().all()

    # Bulk-fetch creator display names for superadmin view
    creator_map: dict[int, str] = {}
    if payload["is_superadmin"]:
        creator_ids = {e.creator_id for e in exams if e.creator_id}
        if creator_ids:
            cr_result = await db.execute(
                select(AdminUser).where(AdminUser.id.in_(creator_ids))
            )
            for u in cr_result.scalars().all():
                creator_map[u.id] = u.display_name

    exam_list = []
    for exam in exams:
        case_result = await db.execute(
            select(func.count(CaseModel.id)).where(CaseModel.exam_id == exam.id)
        )
        case_count = case_result.scalar() or 0

        q_result = await db.execute(
            select(func.count(QuestionModel.id))
            .join(CaseModel, QuestionModel.case_id == CaseModel.id)
            .where(CaseModel.exam_id == exam.id)
        )
        question_count = q_result.scalar() or 0

        creator_name = creator_map.get(exam.creator_id, "") if exam.creator_id else "（原始管理员）"
        exam_list.append(_exam_to_dict(exam, case_count, question_count, creator_name))

    return {"exams": exam_list, "total": len(exam_list)}


@router.get("/exams/{exam_id}")
async def get_exam(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    """Get exam detail with cases, series and questions."""
    from app.models.question import Question as QuestionModel

    result = await db.execute(select(ExamModel).where(ExamModel.id == exam_id))
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    _require_exam_access(exam, payload)

    cases_result = await db.execute(
        select(CaseModel).where(CaseModel.exam_id == exam_id).order_by(CaseModel.sort_order)
    )
    cases = cases_result.scalars().all()

    case_list = []
    total_questions = 0
    for case in cases:
        series_result = await db.execute(
            select(CaseSeries).where(CaseSeries.case_id == case.id).order_by(CaseSeries.sort_order)
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
            select(QuestionModel).where(QuestionModel.case_id == case.id).order_by(QuestionModel.sort_order)
        )
        questions = q_result.scalars().all()
        total_questions += len(questions)

        case_list.append({
            "id": case.id,
            "exam_id": case.exam_id,
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
                    "case_id": q.case_id,
                    "question_type": q.question_type,
                    "question_text": q.question_text,
                    "options": q.options,
                    "correct_answer": q.correct_answer,
                    "sort_order": q.sort_order,
                }
                for q in questions
            ],
            "created_at": case.created_at.isoformat(),
        })

    return {
        "id": exam.id,
        "title": exam.title,
        "description": exam.description,
        "access_code": exam.access_code,
        "is_published": exam.is_published,
        "case_count": len(case_list),
        "question_count": total_questions,
        "cases": case_list,
        "created_at": exam.created_at.isoformat(),
        "updated_at": exam.updated_at.isoformat(),
    }


@router.put("/exams/{exam_id}")
async def update_exam(
    exam_id: int,
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    result = await db.execute(select(ExamModel).where(ExamModel.id == exam_id))
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    _require_exam_access(exam, payload)
    if title is not None:
        exam.title = title
    if description is not None:
        exam.description = description
    await db.flush()
    return {"message": "更新成功"}


@router.delete("/exams/{exam_id}")
async def delete_exam(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    result = await db.execute(select(ExamModel).where(ExamModel.id == exam_id))
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    _require_exam_access(exam, payload)

    # Physically release DICOM storage for every case under this exam *before*
    # the DB rows are cascade-deleted (cases hold the dicom_folder names).
    cases_result = await db.execute(
        select(CaseModel).where(CaseModel.exam_id == exam_id)
    )
    for case in cases_result.scalars().all():
        dicom_path = os.path.join("/data/dicom", case.dicom_folder)
        if os.path.exists(dicom_path):
            shutil.rmtree(dicom_path, ignore_errors=True)

    await db.delete(exam)
    await db.flush()
    return {"message": "删除成功"}


@router.put("/exams/{exam_id}/publish")
async def toggle_publish(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    result = await db.execute(select(ExamModel).where(ExamModel.id == exam_id))
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    _require_exam_access(exam, payload)
    exam.is_published = not exam.is_published
    await db.flush()
    return {"is_published": exam.is_published, "message": "发布状态已更新"}


# ─────────────────────────────────────────────────────────────────────────────
# DICOM / Case upload
# ─────────────────────────────────────────────────────────────────────────────

async def _get_exam_or_403(exam_id: int, db, payload):
    result = await db.execute(select(ExamModel).where(ExamModel.id == exam_id))
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    _require_exam_access(exam, payload)
    return exam


@router.post("/exams/{exam_id}/cases")
async def add_case(
    exam_id: int,
    dicom_file: UploadFile = File(...),
    notes: str = Form(""),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    """Add a new case with DICOM upload."""
    await _get_exam_or_403(exam_id, db, payload)

    filename = _clean_upload_filename(dicom_file.filename)
    sort_result = await db.execute(
        select(func.max(CaseModel.sort_order)).where(CaseModel.exam_id == exam_id)
    )
    max_order = sort_result.scalar() or 0

    case_uuid = uuid.uuid4().hex
    case_folder = f"case_{case_uuid}"
    dicom_dir = os.path.join("/data/dicom", case_folder)

    tmp_path = _upload_tmp_path("/data/uploads", case_uuid, filename)
    os.makedirs("/data/uploads", exist_ok=True)
    with open(tmp_path, "wb") as f:
        content = await dicom_file.read()
        f.write(content)

    processor = DicomProcessor()
    try:
        if filename.lower().endswith('.dcm'):
            series_results, patient_metadata = processor.process_single(tmp_path, dicom_dir)
        else:
            series_results, patient_metadata = processor.process_archive(tmp_path, dicom_dir)
    except Exception as e:
        if os.path.exists(dicom_dir):
            shutil.rmtree(dicom_dir)
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise HTTPException(status_code=400, detail=f"DICOM处理失败: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    case = CaseModel(
        exam_id=exam_id,
        sort_order=max_order + 1,
        notes=notes if notes else None,
        dicom_folder=case_folder,
        study_description=patient_metadata.get("study_description"),
        patient_sex=patient_metadata.get("patient_sex"),
        patient_age=patient_metadata.get("patient_age"),
    )
    db.add(case)
    await db.flush()
    await db.refresh(case)

    series_list = []
    for series_data in series_results:
        thumbnail_url = f"/api/dicom/{case_folder}/series/{series_data['sort_order']}/thumbnail"
        series = CaseSeries(
            case_id=case.id,
            sort_order=series_data["sort_order"],
            series_description=series_data["series_description"],
            series_folder=series_data["series_folder"],
            image_count=series_data["image_count"],
            thumbnail_url=thumbnail_url,
        )
        db.add(series)
        await db.flush()
        await db.refresh(series)
        series_list.append({
            "id": series.id,
            "sort_order": series.sort_order,
            "series_description": series.series_description,
            "series_folder": series.series_folder,
            "image_count": series.image_count,
            "thumbnail_url": series.thumbnail_url,
        })

    return {
        "id": case.id,
        "exam_id": case.exam_id,
        "sort_order": case.sort_order,
        "notes": case.notes,
        "patient_sex": case.patient_sex,
        "patient_age": case.patient_age,
        "study_description": case.study_description,
        "dicom_folder": case.dicom_folder,
        "series": series_list,
        "message": "病例上传成功",
    }


@router.post("/exams/{exam_id}/cases/multi")
async def add_case_multi_files(
    exam_id: int,
    dicom_files: List[UploadFile] = File(...),
    notes: str = Form(""),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    await _get_exam_or_403(exam_id, db, payload)

    sort_result = await db.execute(
        select(func.max(CaseModel.sort_order)).where(CaseModel.exam_id == exam_id)
    )
    max_order = sort_result.scalar() or 0

    case_uuid = uuid.uuid4().hex
    case_folder = f"case_{case_uuid}"
    dicom_dir = os.path.join("/data/dicom", case_folder)

    extract_dir = tempfile.mkdtemp(prefix="multi_dicom_")
    dcm_paths = []
    try:
        for f in dicom_files:
            fname = _clean_upload_filename(f.filename, "upload.dcm")
            tpath = os.path.join(extract_dir, f"{len(dcm_paths)}_{fname}")
            content = await f.read()
            with open(tpath, "wb") as fh:
                fh.write(content)
            dcm_paths.append(tpath)

        processor = DicomProcessor()
        series_results, patient_metadata = processor._process_files_by_series(dcm_paths, dicom_dir)

        case = CaseModel(
            exam_id=exam_id,
            sort_order=max_order + 1,
            notes=notes if notes else None,
            dicom_folder=case_folder,
            study_description=patient_metadata.get("study_description"),
            patient_sex=patient_metadata.get("patient_sex"),
            patient_age=patient_metadata.get("patient_age"),
        )
        db.add(case)
        await db.flush()
        await db.refresh(case)

        series_list = []
        for series_data in series_results:
            thumbnail_url = f"/api/dicom/{case_folder}/series/{series_data['sort_order']}/thumbnail"
            series = CaseSeries(
                case_id=case.id,
                sort_order=series_data["sort_order"],
                series_description=series_data["series_description"],
                series_folder=series_data["series_folder"],
                image_count=series_data["image_count"],
                thumbnail_url=thumbnail_url,
            )
            db.add(series)
            await db.flush()
            await db.refresh(series)
            series_list.append({
                "id": series.id,
                "sort_order": series.sort_order,
                "series_description": series.series_description,
                "series_folder": series.series_folder,
                "image_count": series.image_count,
                "thumbnail_url": series.thumbnail_url,
            })

        return {
            "id": case.id,
            "exam_id": case.exam_id,
            "sort_order": case.sort_order,
            "notes": case.notes,
            "patient_sex": case.patient_sex,
            "patient_age": case.patient_age,
            "study_description": case.study_description,
            "dicom_folder": case.dicom_folder,
            "series": series_list,
            "message": "病例上传成功",
        }
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)


@router.post("/cases/{case_id}/append-dicom")
async def append_dicom_to_case(
    case_id: int,
    dicom_files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    result = await db.execute(select(CaseModel).where(CaseModel.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    # Verify exam ownership
    exam_result = await db.execute(select(ExamModel).where(ExamModel.id == case.exam_id))
    exam = exam_result.scalar_one_or_none()
    if exam:
        _require_exam_access(exam, payload)

    dicom_dir = os.path.join("/data/dicom", case.dicom_folder)
    if not os.path.exists(dicom_dir):
        raise HTTPException(status_code=404, detail="DICOM数据目录不存在")

    existing_max = 0
    for item in os.listdir(dicom_dir):
        if item.startswith("series_") and os.path.isdir(os.path.join(dicom_dir, item)):
            try:
                n = int(item.split("_")[1])
                if n > existing_max:
                    existing_max = n
            except ValueError:
                pass

    extract_dir = tempfile.mkdtemp(prefix="append_dicom_")
    try:
        dcm_paths = []
        for f in dicom_files:
            fname = _clean_upload_filename(f.filename, "upload.dcm")
            tpath = os.path.join(extract_dir, f"{len(dcm_paths)}_{fname}")
            content = await f.read()
            with open(tpath, "wb") as fh:
                fh.write(content)
            dcm_paths.append(tpath)

        processor = DicomProcessor()
        series_results, _ = processor._process_files_by_series(dcm_paths, dicom_dir)

        new_series_list = []
        for series_data in series_results:
            new_idx = existing_max + 1 + len(new_series_list)
            old_folder = series_data["series_folder"]
            new_folder = f"series_{new_idx}"

            old_path = os.path.join(dicom_dir, old_folder)
            new_path = os.path.join(dicom_dir, new_folder)
            if old_path != new_path and os.path.exists(old_path):
                if os.path.exists(new_path):
                    shutil.rmtree(new_path)
                os.rename(old_path, new_path)
                series_data["series_folder"] = new_folder

            sort_result = await db.execute(
                select(func.max(CaseSeries.sort_order)).where(CaseSeries.case_id == case_id)
            )
            max_sort = sort_result.scalar() or -1

            thumbnail_url = f"/api/dicom/{case.dicom_folder}/series/{new_idx}/thumbnail"
            series = CaseSeries(
                case_id=case.id,
                sort_order=max_sort + 1,
                series_description=series_data["series_description"],
                series_folder=new_folder,
                image_count=series_data["image_count"],
                thumbnail_url=thumbnail_url,
            )
            db.add(series)
            await db.flush()
            await db.refresh(series)
            new_series_list.append({
                "id": series.id,
                "sort_order": series.sort_order,
                "series_description": series.series_description,
                "series_folder": series.series_folder,
                "image_count": series.image_count,
                "thumbnail_url": series.thumbnail_url,
            })

        return {
            "id": case.id,
            "message": "DICOM序列追加成功",
            "new_series": new_series_list,
        }
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)


@router.post("/exams/{exam_id}/cases/draft")
async def add_case_draft(
    exam_id: int,
    notes: str = Form(""),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    await _get_exam_or_403(exam_id, db, payload)

    sort_result = await db.execute(
        select(func.max(CaseModel.sort_order)).where(CaseModel.exam_id == exam_id)
    )
    max_order = sort_result.scalar() or 0

    case_uuid = uuid.uuid4().hex
    case_folder = f"case_{case_uuid}"
    os.makedirs(os.path.join("/data/dicom", case_folder), exist_ok=True)

    case = CaseModel(
        exam_id=exam_id,
        sort_order=max_order + 1,
        notes=notes if notes else None,
        dicom_folder=case_folder,
    )
    db.add(case)
    await db.flush()
    await db.refresh(case)
    return {
        "id": case.id,
        "exam_id": case.exam_id,
        "sort_order": case.sort_order,
        "notes": case.notes,
        "dicom_folder": case.dicom_folder,
        "series": [],
        "message": "空白病例已创建",
    }


@router.put("/cases/{case_id}")
async def update_case(
    case_id: int,
    notes: Optional[str] = Form(None),
    sort_order: Optional[int] = Form(None),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    result = await db.execute(select(CaseModel).where(CaseModel.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    exam_result = await db.execute(select(ExamModel).where(ExamModel.id == case.exam_id))
    exam = exam_result.scalar_one_or_none()
    if exam:
        _require_exam_access(exam, payload)
    if notes is not None:
        case.notes = notes
    if sort_order is not None:
        case.sort_order = sort_order
    await db.flush()
    return {"message": "更新成功"}


@router.delete("/cases/{case_id}")
async def delete_case(
    case_id: int,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    result = await db.execute(select(CaseModel).where(CaseModel.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    exam_result = await db.execute(select(ExamModel).where(ExamModel.id == case.exam_id))
    exam = exam_result.scalar_one_or_none()
    if exam:
        _require_exam_access(exam, payload)

    dicom_path = os.path.join("/data/dicom", case.dicom_folder)
    if os.path.exists(dicom_path):
        shutil.rmtree(dicom_path)

    await db.delete(case)
    await db.flush()
    return {"message": "删除成功"}


@router.delete("/series/{series_id}")
async def delete_series(
    series_id: int,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    result = await db.execute(select(CaseSeries).where(CaseSeries.id == series_id))
    series = result.scalar_one_or_none()
    if not series:
        raise HTTPException(status_code=404, detail="序列不存在")

    case_result = await db.execute(select(CaseModel).where(CaseModel.id == series.case_id))
    case = case_result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    exam_result = await db.execute(select(ExamModel).where(ExamModel.id == case.exam_id))
    exam = exam_result.scalar_one_or_none()
    if exam:
        _require_exam_access(exam, payload)

    count_result = await db.execute(
        select(func.count(CaseSeries.id)).where(CaseSeries.case_id == series.case_id)
    )
    remaining = count_result.scalar() or 0
    if remaining <= 1:
        raise HTTPException(
            status_code=400,
            detail="不能删除最后一个序列，请至少保留一个序列或直接删除整个病例"
        )

    series_path = os.path.join("/data/dicom", case.dicom_folder, series.series_folder)
    if os.path.exists(series_path):
        shutil.rmtree(series_path)

    await db.delete(series)
    await db.flush()
    return {"message": "序列已删除"}


# ─────────────────────────────────────────────────────────────────────────────
# Question management
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/cases/{case_id}/questions")
async def add_question(
    case_id: int,
    question_type: str = Form(...),
    question_text: str = Form(...),
    correct_answer: str = Form(...),
    options: Optional[str] = Form(None),
    sort_order: int = Form(0),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    import json
    from app.models.question import Question as QuestionModel

    result = await db.execute(select(CaseModel).where(CaseModel.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    exam_result = await db.execute(select(ExamModel).where(ExamModel.id == case.exam_id))
    exam = exam_result.scalar_one_or_none()
    if exam:
        _require_exam_access(exam, payload)

    parsed_options = None
    if options:
        try:
            parsed_options = json.loads(options)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="选项格式无效，需要JSON数组")

    question = QuestionModel(
        case_id=case_id,
        question_type=question_type,
        question_text=question_text,
        options=parsed_options,
        correct_answer=correct_answer,
        sort_order=sort_order,
    )
    db.add(question)
    await db.flush()
    await db.refresh(question)
    return {
        "id": question.id,
        "case_id": question.case_id,
        "question_type": question.question_type,
        "question_text": question.question_text,
        "options": question.options,
        "correct_answer": question.correct_answer,
        "sort_order": question.sort_order,
    }


@router.put("/questions/{question_id}")
async def update_question(
    question_id: int,
    question_type: Optional[str] = Form(None),
    question_text: Optional[str] = Form(None),
    correct_answer: Optional[str] = Form(None),
    options: Optional[str] = Form(None),
    sort_order: Optional[int] = Form(None),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    import json
    from app.models.question import Question as QuestionModel

    result = await db.execute(select(QuestionModel).where(QuestionModel.id == question_id))
    question = result.scalar_one_or_none()
    if not question:
        raise HTTPException(status_code=404, detail="题目不存在")

    # Verify ownership via case → exam chain
    case_result = await db.execute(select(CaseModel).where(CaseModel.id == question.case_id))
    case = case_result.scalar_one_or_none()
    if case:
        exam_result = await db.execute(select(ExamModel).where(ExamModel.id == case.exam_id))
        exam = exam_result.scalar_one_or_none()
        if exam:
            _require_exam_access(exam, payload)

    if question_type is not None:
        question.question_type = question_type
    if question_text is not None:
        question.question_text = question_text
    if correct_answer is not None:
        question.correct_answer = correct_answer
    if options is not None:
        try:
            question.options = json.loads(options)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="选项格式无效")
    if sort_order is not None:
        question.sort_order = sort_order

    await db.flush()
    return {"message": "更新成功"}


@router.delete("/questions/{question_id}")
async def delete_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    from app.models.question import Question as QuestionModel

    result = await db.execute(select(QuestionModel).where(QuestionModel.id == question_id))
    question = result.scalar_one_or_none()
    if not question:
        raise HTTPException(status_code=404, detail="题目不存在")

    case_result = await db.execute(select(CaseModel).where(CaseModel.id == question.case_id))
    case = case_result.scalar_one_or_none()
    if case:
        exam_result = await db.execute(select(ExamModel).where(ExamModel.id == case.exam_id))
        exam = exam_result.scalar_one_or_none()
        if exam:
            _require_exam_access(exam, payload)

    await db.delete(question)
    await db.flush()
    return {"message": "删除成功"}


# ─────────────────────────────────────────────────────────────────────────────
# Statistics share-token management
# ─────────────────────────────────────────────────────────────────────────────

@router.put("/exams/{exam_id}/share-token")
async def manage_share_token(
    exam_id: int,
    action: str = Form(...),  # "generate" | "revoke"
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(verify_token),
):
    """Generate or revoke the public statistics share token for an exam."""
    result = await db.execute(select(ExamModel).where(ExamModel.id == exam_id))
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在")
    _require_exam_access(exam, payload)

    if action == "generate":
        import secrets
        exam.share_token = secrets.token_urlsafe(32)
    elif action == "revoke":
        exam.share_token = None
    else:
        raise HTTPException(status_code=400, detail="action 必须是 generate 或 revoke")

    await db.flush()
    return {"share_token": exam.share_token, "message": "操作成功"}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _exam_to_dict(exam: ExamModel, case_count: int, question_count: int, creator_name: str) -> dict:
    return {
        "id": exam.id,
        "title": exam.title,
        "description": exam.description,
        "access_code": exam.access_code,
        "is_published": exam.is_published,
        "case_count": case_count,
        "question_count": question_count,
        "creator_id": exam.creator_id,
        "creator_name": creator_name,
        "share_token": exam.share_token,
        "created_at": exam.created_at.isoformat(),
        "updated_at": exam.updated_at.isoformat(),
    }
