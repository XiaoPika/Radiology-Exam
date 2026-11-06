import io
import os
import tarfile
import tempfile
import unittest
import zipfile

from fastapi import HTTPException

from app.routes.admin import _clean_upload_filename
from app.routes.dicom import _series_dir
from app.services.dicom_processor import _safe_extract_tar, _safe_extract_zip


class SecurityRegressionTests(unittest.TestCase):
    def test_upload_filename_is_reduced_to_basename(self):
        self.assertEqual(_clean_upload_filename("../../evil.dcm"), "evil.dcm")
        self.assertEqual(_clean_upload_filename(r"C:\tmp\scan.dcm"), "scan.dcm")
        self.assertEqual(_clean_upload_filename(".."), "upload")

    def test_zip_path_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = os.path.join(tmp, "bad.zip")
            with zipfile.ZipFile(archive, "w") as zf:
                zf.writestr("../evil.dcm", b"not a dicom")
            with zipfile.ZipFile(archive, "r") as zf:
                with self.assertRaises(ValueError):
                    _safe_extract_zip(zf, os.path.join(tmp, "extract"))

    def test_tar_path_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = os.path.join(tmp, "bad.tar.gz")
            payload = b"not a dicom"
            with tarfile.open(archive, "w:gz") as tf:
                info = tarfile.TarInfo("../evil.dcm")
                info.size = len(payload)
                tf.addfile(info, io.BytesIO(payload))
            with tarfile.open(archive, "r:gz") as tf:
                with self.assertRaises(ValueError):
                    _safe_extract_tar(tf, os.path.join(tmp, "extract"))

    def test_dicom_route_rejects_unsafe_case_folder(self):
        with self.assertRaises(HTTPException):
            _series_dir("../case_bad", 0)
        with self.assertRaises(HTTPException):
            _series_dir("case_valid", -1)


if __name__ == "__main__":
    unittest.main()
