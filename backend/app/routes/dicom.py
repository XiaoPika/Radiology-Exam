from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
import os
import hashlib
import email.utils
import stat as stat_module
import re

from app.database import get_db

router = APIRouter()

_CASE_FOLDER_RE = re.compile(r"^case_[A-Za-z0-9_-]+$")


def _series_dir(case_folder: str, series_index: int) -> str:
    if not _CASE_FOLDER_RE.fullmatch(case_folder or "") or series_index < 0:
        raise HTTPException(status_code=404, detail="序列数据不存在")
    return os.path.join("/data/dicom", case_folder, f"series_{series_index}")


def _conditional_file_response(
    request: Request,
    path: str,
    media_type: str,
) -> Response:
    """Serve a static DICOM frame/thumbnail with long-cache + conditional-GET (304).

    Frames/thumbnails are immutable per path (we never overwrite a frame in
    place — a series is deleted and re-uploaded wholesale), so it's safe to
    cache aggressively *and* honor If-None-Match / If-Modified-Since so a
    revalidation produces an empty 304 instead of re-transmitting the body.

    Starlette's FileResponse sets Last-Modified/ETag when given stat_result,
    but it does NOT short-circuit a matching conditional request to a 304 —
    it still streams the file. So we do the comparison ourselves first.
    """
    try:
        st = os.stat(path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="文件不存在")
    if not stat_module.S_ISREG(st.st_mode):
        raise HTTPException(status_code=404, detail="文件不存在")

    last_modified = email.utils.formatdate(st.st_mtime, usegmt=True)
    etag = '"' + hashlib.md5(f"{path}:{st.st_mtime_ns}:{st.st_size}".encode()).hexdigest() + '"'
    cache_headers = {
        "Cache-Control": "public, max-age=86400",
        "Last-Modified": last_modified,
        "ETag": etag,
    }

    inm = request.headers.get("if-none-match")
    ims = request.headers.get("if-modified-since")
    matches_etag = inm is not None and (inm == etag or inm == "*")
    matches_lm = False
    if ims is not None:
        try:
            matches_lm = email.utils.parsedate_to_datetime(ims).timestamp() >= int(st.st_mtime)
        except (TypeError, ValueError):
            matches_lm = False

    if matches_etag or matches_lm:
        return Response(status_code=304, headers=cache_headers)

    return FileResponse(
        path,
        media_type=media_type,
        headers=cache_headers,
        stat_result=st,
        method=request.method,
    )


def _ensure_dicom_available(series_dir: str, frame_index: int) -> str | None:
    """Return the path to the pre-saved anonymized .dcm for this frame, or None."""
    if frame_index < 0:
        return None
    dicom_path = os.path.join(series_dir, "dicom", f"{frame_index}.dcm")
    if os.path.exists(dicom_path):
        return dicom_path
    return None


@router.get("/{case_folder}/series/{series_index}/metadata")
async def get_series_metadata(
    case_folder: str,
    series_index: int,
):
    """Get DICOM series metadata."""
    dicom_dir = _series_dir(case_folder, series_index)

    if not os.path.exists(dicom_dir):
        raise HTTPException(status_code=404, detail="序列数据不存在")

    frames_dir = os.path.join(dicom_dir, "frames")
    image_count = 0
    if os.path.exists(frames_dir):
        image_count = len([f for f in os.listdir(frames_dir) if f.endswith('.jpg')])

    return {
        "case_folder": case_folder,
        "series_index": series_index,
        "image_count": image_count,
    }


@router.get("/{case_folder}/series/{series_index}/images")
async def get_series_image_list(
    case_folder: str,
    series_index: int,
):
    """Get list of frame image URLs for a specific series."""
    frames_dir = os.path.join(_series_dir(case_folder, series_index), "frames")

    if not os.path.exists(frames_dir):
        raise HTTPException(status_code=404, detail="序列数据不存在")

    files = sorted(
        [f for f in os.listdir(frames_dir) if f.endswith('.jpg')],
        key=lambda x: int(x.rsplit('.', 1)[0])
    )

    return {
        "images": [
            f"/api/dicom/{case_folder}/series/{series_index}/frame/{f.rsplit('.', 1)[0]}"
            for f in files
        ],
        "count": len(files),
    }


@router.get("/{case_folder}/series/{series_index}/frame/{frame_index}")
async def get_series_frame(
    request: Request,
    case_folder: str,
    series_index: int,
    frame_index: int,
):
    """Serve a single DICOM frame as a valid DICOM P10 file for Cornerstone.

    Serves the pre-saved anonymized .dcm directly, with long-cache +
    conditional-GET (304) so repeat visits cost no bandwidth.
    """
    series_dir = _series_dir(case_folder, series_index)

    filepath = _ensure_dicom_available(series_dir, frame_index)
    if not filepath:
        raise HTTPException(status_code=404, detail=f"DICOM帧 {frame_index} 不存在")

    return _conditional_file_response(request, filepath, "application/dicom")


@router.get("/{case_folder}/series/{series_index}/thumbnail")
async def get_series_thumbnail(
    request: Request,
    case_folder: str,
    series_index: int,
):
    """Serve the thumbnail for a specific series (with 304 support)."""
    dicom_dir = _series_dir(case_folder, series_index)
    filepath = os.path.join(dicom_dir, "thumbnail.jpg")

    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="缩略图不存在")

    return _conditional_file_response(request, filepath, "image/jpeg")


# === Legacy endpoints for single-series backward compat ===

@router.get("/{case_folder}/metadata")
async def get_dicom_metadata(case_folder: str):
    """Get metadata for the first series (legacy)."""
    return await get_series_metadata(case_folder, 0)


@router.get("/{case_folder}/images")
async def get_image_list(case_folder: str):
    """Get images for the first series (legacy)."""
    return await get_series_image_list(case_folder, 0)


@router.get("/{case_folder}/frame/{frame_index}")
async def get_frame(request: Request, case_folder: str, frame_index: int):
    """Get frame from the first series (legacy)."""
    return await get_series_frame(request, case_folder, 0, frame_index)


@router.get("/{case_folder}/thumbnail")
async def get_thumbnail(request: Request, case_folder: str):
    """Get thumbnail from the first series (legacy)."""
    return await get_series_thumbnail(request, case_folder, 0)
