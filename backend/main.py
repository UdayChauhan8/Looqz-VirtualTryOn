import os
import re
import uuid
import time
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

BACKEND_URL          = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
ALLOWED_EXTENSION_ID = os.getenv("ALLOWED_EXTENSION_ID", "")

# Upload constraints
MAX_UPLOAD_BYTES = 10 * 1024 * 1024   # 10 MB hard cap per file
TMP_DIR          = Path("/tmp/looqz_vault")
SWEEPER_MAX_AGE  = 300    # 5 minutes
SWEEPER_INTERVAL = 600    # 10 minutes

# Strict regex for /tmp-image/{filename} — blocks directory traversal.
# Only matches files that our upload endpoint could have created.
SAFE_FILENAME_RE = re.compile(r"^looqz-(user|cloth)-[a-zA-Z0-9\-]+\.jpg$")

# ── Background sweeper ────────────────────────────────────────────────────────
# Daemon thread that purges orphaned /tmp files older than 5 minutes.

def _sweeper_loop():
    """Runs forever in a daemon thread. Scans looqz_vault for orphaned temp images."""
    while True:
        time.sleep(SWEEPER_INTERVAL)
        try:
            now = time.time()
            count = 0
            for f in TMP_DIR.glob("*.jpg"):
                try:
                    if now - f.stat().st_mtime > SWEEPER_MAX_AGE:
                        f.unlink(missing_ok=True)
                        count += 1
                except Exception:
                    pass
            if count:
                print(f"[Looqz sweeper] Purged {count} orphaned temp file(s).")
        except Exception as e:
            print(f"[Looqz sweeper] Error during sweep: {e}")


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app):
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[Looqz] Vault directory ready: {TMP_DIR}")
    t = threading.Thread(target=_sweeper_loop, daemon=True)
    t.start()
    print("[Looqz] Background sweeper started (interval=10min, max_age=5min).")
    yield
    # Nothing to clean up — daemon thread dies with the process.


# ── App ───────────────────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Looqz Extension Proxy",
    description=(
        "Secure image-hosting proxy for the Looqz Virtual Try-On Chrome Extension. "
        "Receives image uploads, stores them temporarily in /tmp, and returns public "
        "URLs. The extension calls the Looqz API directly from the browser."
    ),
    version="7.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Production: locked to chrome-extension://<your_extension_id>
# Local dev:  falls back to * when ALLOWED_EXTENSION_ID is not set

allowed_origins = (
    [f"chrome-extension://{ALLOWED_EXTENSION_ID}"]
    if ALLOWED_EXTENSION_ID
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _stream_upload_to_tmp(upload: UploadFile, prefix: str = "looqz-") -> Path:
    """
    Streams an UploadFile to /tmp/looqz_vault/<prefix><uuid>.jpg in 8 KB chunks.
    Raises HTTP 413 if the file exceeds MAX_UPLOAD_BYTES.
    Returns the Path to the written file.
    """
    filename = f"{prefix}{uuid.uuid4()}.jpg"
    dest = TMP_DIR / filename

    written = 0
    with open(dest, "wb") as f:
        while True:
            chunk = upload.file.read(8192)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                f.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"Upload exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
                )
            f.write(chunk)

    return dest


def _cleanup(path: Path):
    """Silently deletes a temp file. Sweeper catches anything missed."""
    try:
        path.unlink(missing_ok=True)
    except Exception:
        pass


def _build_base_url(request: Request) -> str:
    """Build the absolute public base URL from the incoming request."""
    base_url = str(request.base_url).rstrip('/')

    # Render routes via proxy — force https if behind reverse proxy
    if "onrender.com" in base_url or request.headers.get("x-forwarded-proto") == "https":
        base_url = base_url.replace("http://", "https://")

    # Fallback to env config
    if not base_url:
        base_url = BACKEND_URL.rstrip('/')

    return base_url


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "service": "Looqz Extension Proxy",
        "status": "running",
        "version": "7.0.0",
        "cors_locked": bool(ALLOWED_EXTENSION_ID),
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


# ── Hardened temp image serving ───────────────────────────────────────────────
# The extension uploads images here. This route lets the Looqz API fetch them.
# ONLY serves files matching the strict naming pattern — no traversal possible.

@app.api_route("/tmp-image/{filename}", methods=["GET", "HEAD"])
async def serve_tmp_image(filename: str):
    """
    Serves a temporary image from /tmp/looqz_vault.
    - Strict regex: only looqz-(user|cloth)-<uuid>.jpg
    - Can't serve arbitrary /tmp files — regex enforces our naming pattern
    - File auto-deleted by the sweeper within 5 minutes
    """
    if not SAFE_FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    filepath = TMP_DIR / filename

    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="File not found.")

    return FileResponse(filepath, media_type="image/jpeg")


# ── Image upload endpoint ─────────────────────────────────────────────────────
# Accepts both images in a single request (1 round trip instead of 2).
# The extension then calls the Looqz API directly from the browser.

@app.post("/upload")
@limiter.limit("60/minute")
async def upload(
    request: Request,
    user_image: UploadFile = File(...),
    cloth_image: UploadFile = File(None),
    cloth_image_url: str = Form(None),
):
    """
    Accepts user photo + cloth image in a single request, returns public URLs.

    - user_image: required, binary upload (the user's photo)
    - cloth_image: optional, binary upload (if extension fetched the cloth image)
    - cloth_image_url: optional, string (if CORS blocked the fetch — echo back as-is)

    At least one of cloth_image or cloth_image_url must be provided.

    Response:
    {
        "user_image_url": "https://your-backend.onrender.com/tmp-image/looqz-user-xxx.jpg",
        "cloth_image_url": "https://your-backend.onrender.com/tmp-image/looqz-cloth-xxx.jpg"
    }
    """
    if not cloth_image and not cloth_image_url:
        raise HTTPException(
            status_code=400,
            detail="Provide either cloth_image (file) or cloth_image_url (string).",
        )

    # Upload user photo
    try:
        user_path = _stream_upload_to_tmp(user_image, prefix="looqz-user-")
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(status_code=500, content={"message": f"User image upload failed: {e}"})

    base_url = _build_base_url(request)
    result = {"user_image_url": f"{base_url}/tmp-image/{user_path.name}"}

    # Upload cloth image (binary) or echo URL (string passthrough)
    if cloth_image:
        try:
            cloth_path = _stream_upload_to_tmp(cloth_image, prefix="looqz-cloth-")
            result["cloth_image_url"] = f"{base_url}/tmp-image/{cloth_path.name}"
        except HTTPException:
            raise
        except Exception as e:
            # Clean up user image if cloth upload fails
            _cleanup(user_path)
            return JSONResponse(status_code=500, content={"message": f"Cloth image upload failed: {e}"})
    else:
        # CORS blocked the cloth fetch — pass the original URL through
        result["cloth_image_url"] = cloth_image_url

    return result
