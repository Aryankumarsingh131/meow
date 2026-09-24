"""T16: inspect an uploaded object before it can become available.

api-contracts.md "Asset and job contracts": JPEG/PNG allowlist, max 5 MiB and
16 megapixels before decoding; lab PDF max 10 MiB with a page limit. Validate
magic bytes and decoder output, not filename/MIME alone.

security-and-privacy.md: "malware scan for lab documents". No scanner exists in
this deployment, so a PDF that passes every structural check is QUARANTINED,
never made available. That is a real blocker, not a pass.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from typing import Literal

from PIL import Image

IMAGE_TYPES = ("image/jpeg", "image/png")
PDF_TYPE = "application/pdf"
MEDIA_TYPES = (*IMAGE_TYPES, PDF_TYPE)

MAX_BYTES = {"image/jpeg": 5 * 1024 * 1024, "image/png": 5 * 1024 * 1024, PDF_TYPE: 10 * 1024 * 1024}
MAX_PIXELS = 16_000_000
#: Provisional engineering limit (the contract leaves the number to T16).
MAX_PDF_PAGES = 20

_JPEG_MAGIC = b"\xff\xd8\xff"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_PNG_END = b"\x00\x00\x00\x00IEND\xaeB`\x82"
_PDF_ACTIVE = re.compile(rb"/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b")
_PDF_PAGE = re.compile(rb"/Type\s*/Page(?!s)\b")


@dataclass(frozen=True)
class Inspection:
    outcome: Literal["available", "quarantined", "rejected"]
    reason: str | None = None


def _reject(reason: str) -> Inspection:
    return Inspection("rejected", reason)


def _inspect_image(data: bytes, media_type: str) -> Inspection:
    magic, fmt = (_JPEG_MAGIC, "JPEG") if media_type == "image/jpeg" else (_PNG_MAGIC, "PNG")
    if not data.startswith(magic):
        return _reject("magic_mismatch")
    # Bytes after the format's end marker are how polyglots (JPEG+ZIP,
    # PNG+HTML) hide a second file; decoders ignore them, so check here.
    if media_type == "image/jpeg" and not data.endswith(b"\xff\xd9"):
        return _reject("trailing_or_truncated_data")
    if media_type == "image/png" and not data.endswith(_PNG_END):
        return _reject("trailing_or_truncated_data")
    try:
        with Image.open(io.BytesIO(data)) as header:
            if header.format != fmt:
                return _reject("decoder_format_mismatch")
            width, height = header.size
            # Before decoding: a tiny file can declare a huge canvas.
            if width * height > MAX_PIXELS:
                return _reject("too_many_pixels")
            header.verify()
        with Image.open(io.BytesIO(data)) as full:
            full.load()  # the decoder must produce every pixel
    except Exception:
        return _reject("decode_failed")
    return Inspection("available")


def _inspect_pdf(data: bytes) -> Inspection:
    if not data.startswith(b"%PDF-1."):
        return _reject("magic_mismatch")
    if b"%%EOF" not in data[-1024:]:
        return _reject("trailing_or_truncated_data")
    if _PDF_ACTIVE.search(data):
        return _reject("active_content")
    pages = len(_PDF_PAGE.findall(data))
    if pages == 0:
        return _reject("no_pages")
    if pages > MAX_PDF_PAGES:
        return _reject("too_many_pages")
    # ponytail: regex page count is a pre-filter only; a real PDF parser and a
    # malware scanner are needed before any lab document can be released.
    return Inspection("quarantined", "malware_scan_unavailable")


def inspect(data: bytes, media_type: str) -> Inspection:
    if media_type not in MEDIA_TYPES:
        return _reject("media_type_not_allowed")
    if not data:
        return _reject("empty")
    if len(data) > MAX_BYTES[media_type]:
        return _reject("too_large")
    return _inspect_pdf(data) if media_type == PDF_TYPE else _inspect_image(data, media_type)
