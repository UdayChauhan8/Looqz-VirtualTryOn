import os
import re
import uuid
import time
import shutil
import asyncio
import threading
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

LOOQZ_API_URL      = os.getenv("LOOQZ_API_URL", "https://www.looqz.in/api/v1/public/generate-image")
WHITELISTED_ORIGIN = os.getenv("WHITELISTED_ORIGIN", "http://127.0.0.1:8000")
BACKEND_URL        = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

# Chrome Extension ID — locks CORS so only your extension can talk to this server.
# Set this in Render Environment Variables. Leave empty for local dev (falls back to *).
ALLOWED_EXTENSION_ID = os.getenv("ALLOWED_EXTENSION_ID", "")

# Upload constraints
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB hard cap per file
TMP_DIR          = Path("/tmp/looqz_vault")   # isolated subdirectory — not bare /tmp
TMP_PREFIX       = "looqz-"                    # all temp files start with this
SWEEPER_MAX_AGE  = 300               # 5 minutes — anything older gets swept
SWEEPER_INTERVAL = 600               # 10 minutes between sweeper runs

# Strict Looqz API key format: sk_live_ followed by exactly 32 alphanumeric chars.
# Blocks oversized/malformed strings before any CPU or disk work happens.
API_KEY_RE = re.compile(r"^sk_live_[a-zA-Z0-9]{32}$")

# Strict regex for /tmp-image/{filename} — blocks directory traversal.
# Only allows: alphanumeric, dashes, must end in .jpg. No slashes, dots, or backslashes.
SAFE_FILENAME_RE = re.compile(r"^[a-zA-Z0-9\-]+\.jpg$")

# ── Thread pool ───────────────────────────────────────────────────────────────
# Clamped to 3 workers — Render free tier has 0.1 vCPU and 512 MB RAM.
# This prevents CPU thrashing from too many concurrent requests.post calls.
executor = ThreadPoolExecutor(max_workers=3)

# ── App ───────────────────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Looqz Extension Proxy",
    description="Secure multipart proxy for the Looqz Virtual Try-On Chrome Extension.",
    version="4.0.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS lockdown ─────────────────────────────────────────────────────────────
# Production: locked to chrome-extension://<your_extension_id>
# Local dev:  falls back to * when ALLOWED_EXTENSION_ID is not set
allowed_origins = []
if ALLOWED_EXTENSION_ID:
    allowed_origins.append(f"chrome-extension://{ALLOWED_EXTENSION_ID}")
else:
    allowed_origins.append("*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ── Background sweeper ───────────────────────────────────────────────────────
# Daemon thread that wakes every 10 minutes and purges any .jpg file inside
# /tmp/looqz_vault older than 5 minutes. This is the infra-level failsafe —
# if a request crashes, times out, or the user disconnects mid-generation,
# the finally: block might not run. The sweeper guarantees disk doesn't fill.

def _sweeper_loop():
    """Runs forever in a daemon thread. Scans looqz_vault for orphaned temp images."""
    while True:
        time.sleep(SWEEPER_INTERVAL)
        try:
            now = time.time()
            count = 0
            for f in TMP_DIR.glob("*.jpg"):
                try:
                    age = now - f.stat().st_mtime
                    if age > SWEEPER_MAX_AGE:
                        f.unlink(missing_ok=True)
                        count += 1
                except Exception:
                    pass
            if count:
                print(f"[Looqz sweeper] Purged {count} orphaned temp file(s).")
        except Exception as e:
            print(f"[Looqz sweeper] Error during sweep: {e}")


@app.on_event("startup")
def start_sweeper():
    # Ensure the vault directory exists (Render wipes /tmp on each deploy)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[Looqz] Vault directory ready: {TMP_DIR}")

    t = threading.Thread(target=_sweeper_loop, daemon=True)
    t.start()
    print("[Looqz] Background sweeper started (interval=10min, max_age=5min).")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _stream_upload_to_tmp(upload: UploadFile) -> Path:
    """
    Streams an UploadFile to /tmp/looqz_vault/looqz-<uuid>.jpg using constant memory.
    Raises HTTPException if the file exceeds MAX_UPLOAD_BYTES.
    Returns the Path to the written file.
    """
    filename = f"{TMP_PREFIX}{uuid.uuid4()}.jpg"
    dest = TMP_DIR / filename

    written = 0
    with open(dest, "wb") as f:
        while True:
            chunk = upload.file.read(8192)  # 8 KB chunks — constant memory
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                # Clean up the partial file and reject
                f.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"Upload exceeds {MAX_UPLOAD_BYTES // (1024*1024)} MB limit."
                )
            f.write(chunk)

    return dest


def _tmp_file_to_url(filepath: Path) -> str:
    """Constructs a public URL for a /tmp file served by our /tmp-image route."""
    return f"{BACKEND_URL.rstrip('/')}/tmp-image/{filepath.name}"


def _call_looqz(api_key: str, product_url: str, user_url: str) -> requests.Response:
    """
    Calls the Looqz generation API. Runs in the clamped thread pool.
    Both product_url and user_url must be publicly fetchable at call time.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": WHITELISTED_ORIGIN,
        "Referer": WHITELISTED_ORIGIN + "/",
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        ),
    }
    payload = {
        "product_image_url": product_url,
        "user_image_url": user_url,
    }
    return requests.post(
        LOOQZ_API_URL,
        headers=headers,
        json=payload,
        timeout=(10, 90),
        allow_redirects=True,
    )


def _cleanup_files(paths: list[Path]):
    """Silently deletes a list of temp files. Safe to call multiple times."""
    for p in paths:
        try:
            p.unlink(missing_ok=True)
        except Exception:
            pass  # sweeper will catch it later


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "service": "Looqz Extension Proxy",
        "status": "running",
        "version": "4.0.0",
        "cors_locked": bool(ALLOWED_EXTENSION_ID),
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


# ── Hardened temp image serving ───────────────────────────────────────────────
# The Looqz API needs to fetch our uploaded images. This route serves them
# from /tmp — but ONLY files matching the strict naming pattern.

@app.get("/tmp-image/{filename}")
async def serve_tmp_image(filename: str):
    """
    Serves a temporary image from /tmp.
    Hardened against directory traversal:
    - Strict regex: only alphanumeric + dashes + .jpg
    - Rejects any slash, backslash, or dot-dot sequence
    - Only serves files with the looqz- prefix
    """
    # Block traversal attempts
    if not SAFE_FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    # Enforce our prefix — prevents serving arbitrary /tmp files
    if not filename.startswith(TMP_PREFIX):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    filepath = TMP_DIR / filename

    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="File not found.")

    return FileResponse(filepath, media_type="image/jpeg")


# ── Key validation ────────────────────────────────────────────────────────────

class ValidateKeyRequest(BaseModel):
    api_key: str


@app.post("/validate-key")
@limiter.limit("10/minute")
async def validate_key(request: Request, body: ValidateKeyRequest):
    """
    Lightweight API key check. Sends a minimal test request to Looqz with
    placeholder images. Returns 200 (accepted) or 401 (invalid key).
    This endpoint accepts JSON so it remains simple — no binary uploads needed.
    """
    if not API_KEY_RE.match(body.api_key):
        return JSONResponse(status_code=400, content={"message": "Invalid key format. Expected: sk_live_ + 32 alphanumeric characters."})

    loop = asyncio.get_event_loop()
    try:
        response = await loop.run_in_executor(
            executor,
            _call_looqz,
            body.api_key,
            "https://placehold.co/150x200/png",
            "https://placehold.co/150x200/png",
        )
    except requests.exceptions.ConnectionError as e:
        return JSONResponse(status_code=503, content={"message": f"Connection to Looqz failed: {str(e)[:120]}"})
    except Exception as e:
        return JSONResponse(status_code=503, content={"message": str(e)})

    try:
        data = response.json()
    except Exception:
        data = {}

    return JSONResponse(status_code=response.status_code, content=data)


# ── Main generation endpoint ─────────────────────────────────────────────────

@app.post("/generate")
@limiter.limit("30/minute")
async def generate(
    request: Request,
    # ── Form fields ──────────────────────────────────────────────────────────
    api_key: str = Form(...),
    # ── File uploads ─────────────────────────────────────────────────────────
    user_image: UploadFile = File(...),
    product_image: UploadFile = File(None),       # Binary cloth (optional)
    product_image_url: str = Form(None),           # URL fallback (optional)
):
    """
    Secure multipart try-on endpoint.

    The caller (background.js) always uploads the user photo as a binary file.
    For the cloth image it sends EITHER a binary file (product_image) OR a raw
    URL string (product_image_url) depending on whether it could fetch the
    cloth image from the CDN without a CORS error.

    Pipeline:
      1. Validate API key format.
      2. Stream binary uploads to /tmp (constant memory, 10 MB cap).
      3. For product_image_url: pass it directly to Looqz unchanged.
         No download. No middleman. Zero wasted bandwidth.
      4. Call Looqz API via the clamped thread pool (max 3 workers).
      5. finally: block deletes /tmp files even on crash/timeout.
         Sweeper daemon catches any orphans the finally misses.
    """

    # Validate key format early — rejects malformed/oversized keys before any disk I/O
    if not API_KEY_RE.match(api_key):
        return JSONResponse(status_code=400, content={
            "message": "Invalid API key format. Expected: sk_live_ + 32 alphanumeric characters."
        })

    # Validate that exactly one cloth source was provided
    if product_image is None and not product_image_url:
        return JSONResponse(status_code=400, content={
            "message": "Provide either product_image (file) or product_image_url (string)."
        })

    tmp_files: list[Path] = []
    loop = asyncio.get_event_loop()

    try:
        # ── Step 1: Stream user photo to /tmp ────────────────────────────────
        user_path = _stream_upload_to_tmp(user_image)
        tmp_files.append(user_path)
        user_url = _tmp_file_to_url(user_path)

        # ── Step 2: Handle cloth image ────────────────────────────────────────
        if product_image is not None:
            # Binary path: stream to /tmp, construct public URL
            cloth_path = _stream_upload_to_tmp(product_image)
            tmp_files.append(cloth_path)
            cloth_url = _tmp_file_to_url(cloth_path)
        else:
            # URL fallback path: pass the original URL directly to Looqz.
            # No download. Looqz's servers fetch it themselves.
            cloth_url = product_image_url

        # ── Step 3: Call Looqz API via clamped thread pool ────────────────────
        response = await loop.run_in_executor(
            executor, _call_looqz, api_key, cloth_url, user_url
        )

    except HTTPException:
        # Re-raise FastAPI exceptions (e.g. 413 from _stream_upload_to_tmp)
        raise
    except requests.exceptions.ConnectTimeout:
        return JSONResponse(status_code=504, content={
            "message": "Could not connect to Looqz servers (timeout)."
        })
    except requests.exceptions.ReadTimeout:
        return JSONResponse(status_code=504, content={
            "message": "Looqz AI generation timed out after 90s. Please try again."
        })
    except requests.exceptions.ConnectionError as e:
        return JSONResponse(status_code=503, content={
            "message": f"Connection to Looqz failed: {str(e)[:200]}"
        })
    except Exception as e:
        import traceback
        return JSONResponse(status_code=500, content={
            "message": f"Proxy error: {str(e)}",
            "detail": traceback.format_exc()[:400],
        })
    finally:
        # ── Always clean up /tmp files ────────────────────────────────────────
        # Runs even on timeout, crash, or client disconnect.
        # The sweeper daemon is the second line of defense for anything missed.
        _cleanup_files(tmp_files)

    # ── Handle Looqz error responses ──────────────────────────────────────────
    if not response.ok:
        try:
            err_body = response.json()
            if not isinstance(err_body, dict):
                err_body = {"data": err_body}
        except Exception:
            err_body = {"message": f"Looqz error {response.status_code}: {response.text[:200]}"}
        return JSONResponse(status_code=response.status_code, content=err_body)

    # ── Parse and return the success response ─────────────────────────────────
    try:
        return response.json()
    except Exception:
        return JSONResponse(status_code=502, content={
            "message": f"Looqz returned non-JSON: {response.text[:200]}"
        })
