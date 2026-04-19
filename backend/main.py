import os
import re
import uuid
import time
import asyncio
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request, UploadFile, File, HTTPException
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
TMP_PREFIX       = "looqz-"
SWEEPER_MAX_AGE  = 300    # 5 minutes
SWEEPER_INTERVAL = 600    # 10 minutes

# Strict regex for /tmp-image/{filename} — blocks directory traversal.
SAFE_FILENAME_RE = re.compile(r"^[a-zA-Z0-9\-]+\.jpg$")

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
        "Secure image-upload proxy for the Looqz Virtual Try-On Chrome Extension. "
        "Receives image uploads, stores them temporarily in /tmp, and returns public "
        "URLs. The extension then calls the Looqz API directly from the browser."
    ),
    version="5.0.0",
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

def _stream_upload_to_tmp(upload: UploadFile) -> Path:
    """
    Streams an UploadFile to /tmp/looqz_vault/looqz-<uuid>.jpg in 8 KB chunks.
    Raises HTTP 413 if the file exceeds MAX_UPLOAD_BYTES.
    Returns the Path to the written file.
    """
    filename = f"{TMP_PREFIX}{uuid.uuid4()}.jpg"
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


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "service": "Looqz Extension Proxy",
        "status": "running",
        "version": "5.0.0",
        "cors_locked": bool(ALLOWED_EXTENSION_ID),
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


# ── Hardened temp image serving ───────────────────────────────────────────────
# The extension uploads images here. This route lets the Looqz API fetch them.
# ONLY serves files matching the strict naming pattern — no traversal possible.

@app.get("/tmp-image/{filename}")
async def serve_tmp_image(filename: str):
    """
    Serves a temporary image from /tmp/looqz_vault.
    - Strict regex: alphanumeric + dashes + .jpg only
    - Enforces looqz- prefix — can't serve arbitrary /tmp files
    - File auto-deleted by the sweeper within 5 minutes
    """
    if not SAFE_FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not filename.startswith(TMP_PREFIX):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    filepath = TMP_DIR / filename

    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="File not found.")

    return FileResponse(filepath, media_type="image/jpeg")


# ── Image upload endpoint ─────────────────────────────────────────────────────
# The extension uploads ONE image at a time. Backend saves it to /tmp and
# returns a public URL. The extension then calls the Looqz API directly
# from the browser (residential IP — bypasses Cloudflare naturally).

@app.post("/upload-image")
@limiter.limit("60/minute")
async def upload_image(
    request: Request,
    image: UploadFile = File(...),
):
    """
    Receives a single image upload, saves it to /tmp, returns its public URL.

    The Looqz API is called directly by the browser extension (background.js)
    using the returned URL. This avoids the Cloudflare 403 that occurs when
    server-side code on a datacenter IP tries to call the Looqz API.

    Response: { "url": "https://your-backend.onrender.com/tmp-image/looqz-xxx.jpg" }
    """
    try:
        path = _stream_upload_to_tmp(image)
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(status_code=500, content={"message": f"Upload failed: {e}"})

    # Dynamically build the absolute URL using the request
    # This safely prevents 'relative URL' errors if BACKEND_URL is misconfigured or empty
    base_url = str(request.base_url).rstrip('/')
    
    # Render routes via proxy, so if it's on Render or forwarded via HTTPS, strictly force https://
    if "onrender.com" in base_url or request.headers.get("x-forwarded-proto") == "https":
        base_url = base_url.replace("http://", "https://")
        
    # If for some reason base_url is still empty, fall back to backend config
    if not base_url:
        base_url = BACKEND_URL.rstrip('/')

    url = f"{base_url}/tmp-image/{path.name}"
    return {"url": url}
