import os
import zipfile
import tarfile
import shutil
import tempfile
from collections import defaultdict
from typing import Tuple, List, Dict, Any

import pydicom
from pydicom.uid import ExplicitVRLittleEndian
import numpy as np
from PIL import Image


def _assert_safe_extract_path(destination: str, member_name: str) -> None:
    dest_abs = os.path.abspath(destination)
    target_abs = os.path.abspath(os.path.join(dest_abs, member_name))
    if os.path.commonpath([dest_abs, target_abs]) != dest_abs:
        raise ValueError("压缩包包含非法路径")


def _safe_extract_zip(zf: zipfile.ZipFile, destination: str) -> None:
    for info in zf.infolist():
        if os.path.isabs(info.filename):
            raise ValueError("压缩包包含非法路径")
        _assert_safe_extract_path(destination, info.filename)
    zf.extractall(destination)


def _safe_extract_tar(tf: tarfile.TarFile, destination: str) -> None:
    for member in tf.getmembers():
        if os.path.isabs(member.name):
            raise ValueError("压缩包包含非法路径")
        if member.issym() or member.islnk() or member.isdev():
            raise ValueError("压缩包包含不支持的链接或设备文件")
        _assert_safe_extract_path(destination, member.name)
    tf.extractall(destination)


def _decode_dicom_text(value):
    """Decode DICOM text field with robust Chinese encoding handling.

    Many Chinese DICOM files lack a correct SpecificCharacterSet tag,
    causing pydicom to decode GBK/GB18030 bytes as Latin-1. This function
    detects and recovers such mis-decoded strings.

    Strategy:
      - If already a str with CJK chars or pure ASCII → use as-is
      - If mis-decoded (latin-1 garbled bytes) → re-encode to latin-1, decode as GBK
      - If raw bytes → try UTF-8 → GBK → latin-1 fallback
    """
    if value is None or value == "":
        return ""

    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            try:
                return value.decode("gbk")
            except UnicodeDecodeError:
                return value.decode("latin-1", errors="replace")

    if isinstance(value, str):
        if value.isascii():
            return value
        # Already contains CJK characters — pydicom decoded correctly
        if any(0x4E00 <= ord(c) <= 0x9FFF for c in value):
            return value
        # Looks like mis-decoded Latin-1 → try recovering as GBK
        try:
            recovered = value.encode("latin-1").decode("gbk")
            if any(0x4E00 <= ord(c) <= 0x9FFF for c in recovered):
                return recovered
        except Exception:
            pass
        return value

    return str(value)


class SeriesInfo:
    """Metadata for one DICOM series found during processing."""
    def __init__(self, series_uid: str, series_description: str, series_number: int):
        self.series_uid = series_uid
        self.series_description = series_description or f"序列 {series_number}"
        self.series_number = series_number
        self.files: list = []  # (filepath, ds) tuples


class DicomProcessor:
    """Process DICOM files: anonymize, convert to JPEG, group by series."""

    # Tags to CLEAR (anonymize)
    TAGS_TO_CLEAR = [
        (0x0010, 0x0010),  # PatientName
        (0x0010, 0x0020),  # PatientID
        (0x0010, 0x0030),  # PatientBirthDate
        (0x0008, 0x0050),  # AccessionNumber
        (0x0008, 0x0080),  # InstitutionName
        (0x0008, 0x0081),  # InstitutionAddress
        (0x0008, 0x1040),  # InstitutionalDepartmentName
        (0x0018, 0x1000),  # DeviceSerialNumber
        (0x0008, 0x0070),  # Manufacturer
        (0x0008, 0x1090),  # ManufacturerModelName
        (0x0008, 0x0020),  # StudyDate
        (0x0008, 0x0030),  # StudyTime
        (0x0008, 0x0021),  # SeriesDate
        (0x0008, 0x0031),  # SeriesTime
        (0x0008, 0x0023),  # ContentDate
        (0x0008, 0x0033),  # ContentTime
        (0x0008, 0x0022),  # AcquisitionDate
        (0x0008, 0x0032),  # AcquisitionTime
        (0x0010, 0x4000),  # PatientComments
        (0x0020, 0x0010),  # StudyID
        (0x0020, 0x0052),  # FrameOfReferenceUID
    ]

    def process_archive(self, archive_path: str, output_dir: str) -> Tuple[List[dict], dict]:
        """Process a zip/tar.gz of DICOM files, grouping by series. Returns (series_list, patient_metadata)."""
        extract_dir = tempfile.mkdtemp(prefix="dicom_extract_")
        try:
            if archive_path.lower().endswith('.zip'):
                with zipfile.ZipFile(archive_path, 'r') as zf:
                    _safe_extract_zip(zf, extract_dir)
            elif archive_path.lower().endswith(('.tar.gz', '.tgz')):
                with tarfile.open(archive_path, 'r:gz') as tf:
                    _safe_extract_tar(tf, extract_dir)
            else:
                try:
                    with zipfile.ZipFile(archive_path, 'r') as zf:
                        _safe_extract_zip(zf, extract_dir)
                except zipfile.BadZipFile:
                    raise ValueError("不支持的文件格式，请上传ZIP或TAR.GZ压缩包")

            dcm_files = []
            for root, dirs, files in os.walk(extract_dir):
                for f in sorted(files):
                    filepath = os.path.join(root, f)
                    if self._is_dicom(filepath):
                        dcm_files.append(filepath)

            if not dcm_files:
                raise ValueError("未找到有效的DICOM文件")

            return self._process_files_by_series(dcm_files, output_dir)

        finally:
            shutil.rmtree(extract_dir, ignore_errors=True)

    def process_single(self, file_path: str, output_dir: str) -> Tuple[List[dict], dict]:
        """Process a single DICOM file."""
        if not self._is_dicom(file_path):
            raise ValueError("不是有效的DICOM文件")
        return self._process_files_by_series([file_path], output_dir)

    def _is_dicom(self, filepath: str) -> bool:
        try:
            if os.path.basename(filepath).startswith('.'):
                return False
            if os.path.isdir(filepath):
                return False
            pydicom.dcmread(filepath, stop_before_pixels=True)
            return True
        except Exception:
            return False

    def _process_files_by_series(self, dcm_files: list, output_dir: str) -> Tuple[List[dict], dict]:
        """Sort DICOM files into series groups and process each."""
        # First pass: read headers and group by SeriesInstanceUID
        series_map: Dict[str, SeriesInfo] = {}
        series_counter = 0
        patient_metadata = {}

        for filepath in dcm_files:
            try:
                ds = pydicom.dcmread(filepath, stop_before_pixels=True)
                series_uid = getattr(ds, 'SeriesInstanceUID', 'unknown')
                raw_desc = getattr(ds, 'SeriesDescription', '') or ''
                series_desc = _decode_dicom_text(raw_desc)

                series_num = getattr(ds, 'SeriesNumber', 0) or 0

                if series_uid not in series_map:
                    series_counter += 1
                    series_map[series_uid] = SeriesInfo(
                        series_uid=series_uid,
                        series_description=series_desc,
                        series_number=series_num,
                    )

                series_map[series_uid].files.append((filepath, ds))

                # Extract patient metadata from first file
                if not patient_metadata:
                    raw_study = getattr(ds, 'StudyDescription', '') or ''
                    raw_sex = getattr(ds, 'PatientSex', '') or ''
                    raw_age = getattr(ds, 'PatientAge', '') or ''
                    patient_metadata = {
                        "patient_sex": _decode_dicom_text(raw_sex),
                        "patient_age": _decode_dicom_text(raw_age),
                        "study_description": _decode_dicom_text(raw_study),
                    }

            except Exception as e:
                print(f"Warning: Failed to read DICOM header {filepath}: {e}")
                continue

        if not series_map:
            raise ValueError("没有成功读取任何DICOM文件")

        # Sort series by SeriesNumber
        sorted_series = sorted(
            series_map.values(),
            key=lambda s: (s.series_number if s.series_number != 0 else 9999, s.series_description)
        )

        # Process each series
        series_results = []
        for idx, series_info in enumerate(sorted_series):
            series_folder_name = f"series_{idx}"
            series_dir = os.path.join(output_dir, series_folder_name)
            os.makedirs(os.path.join(series_dir, "frames"), exist_ok=True)
            os.makedirs(os.path.join(series_dir, "dicom"), exist_ok=True)

            files = self._sort_dicom_files(series_info.files)
            image_count = 0

            for frame_idx, (filepath, _header_ds) in enumerate(files):
                try:
                    ds = pydicom.dcmread(filepath)
                    ds = self._anonymize(ds)

                    # Save anonymized DICOM for Cornerstone to load via wadouri.
                    # Force ExplicitVR Little Endian for maximum browser compatibility —
                    # dicom-parser handles ImplicitVR but some codepaths differ, and
                    # ExplicitVR is the standard for data exchange.
                    dcm_path = os.path.join(series_dir, "dicom", f"{frame_idx}.dcm")
                    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
                    ds.save_as(dcm_path, write_like_original=False)

                    jwt_path = os.path.join(series_dir, "frames", f"{frame_idx}.jpg")
                    self._convert_to_jpeg(ds, jwt_path)
                    image_count += 1
                except Exception as e:
                    print(f"Warning: Failed to process {filepath}: {e}")
                    continue

            # Generate thumbnail from middle slice
            mid_slice = image_count // 2
            src_thumb = os.path.join(series_dir, "frames", f"{mid_slice}.jpg")
            dst_thumb = os.path.join(series_dir, "thumbnail.jpg")
            if os.path.exists(src_thumb):
                shutil.copy(src_thumb, dst_thumb)

            series_results.append({
                "sort_order": idx,
                "series_description": series_info.series_description,
                "series_folder": series_folder_name,
                "image_count": image_count,
                "thumbnail_url": "",  # filled by route layer
            })

        return series_results, patient_metadata

    def _sort_dicom_files(self, files: list) -> list:
        """Sort DICOM files by InstanceNumber/SliceLocation for correct stacking.
        `files` is a list of (filepath, header_ds) tuples."""
        def sort_key(fp_tuple):
            filepath, ds = fp_tuple[0], fp_tuple[1]
            try:
                if hasattr(ds, 'InstanceNumber') and ds.InstanceNumber is not None:
                    return (0, int(ds.InstanceNumber))
                if hasattr(ds, 'SliceLocation') and ds.SliceLocation is not None:
                    return (1, float(ds.SliceLocation))
                if hasattr(ds, 'ImagePositionPatient') and ds.ImagePositionPatient is not None:
                    return (2, float(ds.ImagePositionPatient[2]))
            except Exception:
                pass
            return (3, 0)
        return sorted(files, key=sort_key)

    def _anonymize(self, ds: pydicom.Dataset) -> pydicom.Dataset:
        for tag in self.TAGS_TO_CLEAR:
            if tag in ds:
                ds[tag].value = ""

        ds.StudyInstanceUID = pydicom.uid.generate_uid()
        ds.SeriesInstanceUID = pydicom.uid.generate_uid()
        ds.SOPInstanceUID = pydicom.uid.generate_uid()

        ds.add(pydicom.DataElement(
            (0x0012, 0x0063), 'LO', 'Radiology Exam System v1.0'
        ))
        return ds

    def _convert_to_jpeg(self, ds: pydicom.Dataset, output_path: str):
        pixel_array = ds.pixel_array.astype(np.float32)

        intercept = getattr(ds, 'RescaleIntercept', 0.0)
        slope = getattr(ds, 'RescaleSlope', 1.0)
        pixel_array = pixel_array * slope + intercept

        window_center = getattr(ds, 'WindowCenter', None)
        window_width = getattr(ds, 'WindowWidth', None)

        if window_center is not None and window_width is not None:
            if hasattr(window_center, '__len__') and not isinstance(window_center, str):
                wc = window_center[0] if len(window_center) > 0 else 40
                ww = window_width[0] if len(window_width) > 0 else 80
            elif isinstance(window_center, str):
                wc, ww = 40, 80
            else:
                wc = float(window_center)
                ww = float(window_width)
        else:
            p2, p98 = np.percentile(pixel_array, (2, 98))
            wc = (p2 + p98) / 2
            ww = p98 - p2

        if ww <= 0:
            ww = 1
        vmin = wc - ww / 2
        vmax = wc + ww / 2
        pixel_array = np.clip((pixel_array - vmin) / (vmax - vmin) * 255, 0, 255).astype(np.uint8)

        # MONOCHROME1: pixel 0 = white, increasing value = darker.
        # Standard DICOM display convention (and what radiologists expect) is
        # MONOCHROME2 (0 = black).  DR / CR images frequently use MONOCHROME1,
        # which causes the "bone is black, air is white" inversion.  Flip it.
        photometric = getattr(ds, 'PhotometricInterpretation', '') or ''
        if photometric.strip().upper() == 'MONOCHROME1':
            pixel_array = 255 - pixel_array

        img = Image.fromarray(pixel_array)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        img.save(output_path, 'JPEG', quality=85)
