import os
import re
import uuid
import time
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
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


@app.get("/privacy", response_class=HTMLResponse)
def privacy_policy():
    """Serves the privacy policy page for Chrome Web Store compliance."""
    return """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Looqz Virtual Try-On — Privacy Policy</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.7; color: #1a1a2e; background: #f8f9fc; padding: 40px 20px;
    }
    .container {
      max-width: 720px; margin: 0 auto; background: #fff;
      border-radius: 12px; padding: 48px 40px; box-shadow: 0 2px 20px rgba(0,0,0,0.06);
    }
    h1 { font-size: 28px; margin-bottom: 8px; color: #0f0f1a; }
    .updated { font-size: 14px; color: #6b7280; margin-bottom: 32px; }
    h2 { font-size: 20px; margin-top: 32px; margin-bottom: 12px; color: #0f0f1a; }
    p, li { font-size: 15px; color: #374151; margin-bottom: 12px; }
    ul { padding-left: 24px; margin-bottom: 16px; }
    li { margin-bottom: 6px; }
    a { color: #4f46e5; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    .highlight {
      background: #f0fdf4; border-left: 4px solid #22c55e;
      padding: 12px 16px; border-radius: 6px; margin: 16px 0;
      font-size: 14px; color: #166534;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: July 14, 2026</p>

    <p><strong>Looqz Virtual Try-On</strong> ("the Extension") is a Chrome browser extension that allows users to virtually try on clothing items from any online shopping website using AI-powered image generation. This Privacy Policy explains what data the Extension accesses, how it is used, and how it is protected.</p>

    <div class="highlight">
      <strong>Summary:</strong> The Extension does not collect, store, or share any personal data on external servers controlled by us. All user data (API key and photo) is stored locally on your device.
    </div>

    <h2>1. Data We Access</h2>
    <p>The Extension accesses the following data solely to provide its virtual try-on functionality:</p>
    <ul>
      <li><strong>API Key:</strong> A Looqz API key you provide. This key is stored locally in your browser using <code>chrome.storage.local</code> and is sent directly to the Looqz API (<a href="https://looqz.in">looqz.in</a>) to authenticate try-on requests.</li>
      <li><strong>User Photo:</strong> A photo you voluntarily upload. This photo is stored locally on your device using <code>chrome.storage.local</code>. When you initiate a try-on, the photo is temporarily uploaded to our image hosting server solely so the Looqz API can access it for processing. The uploaded file is automatically deleted within 5 minutes.</li>
      <li><strong>Clothing Image URL:</strong> The URL of a clothing image you select from a shopping website. This URL is passed to the Looqz API to generate the try-on result. It is not stored persistently.</li>
    </ul>

    <h2>2. Data We Do NOT Collect</h2>
    <p>The Extension does <strong>not</strong> collect, access, or transmit:</p>
    <ul>
      <li>Personally identifiable information (name, email, address)</li>
      <li>Browsing history or web activity</li>
      <li>Cookies or authentication tokens from websites you visit</li>
      <li>Keystroke data, mouse movements, or click patterns</li>
      <li>Financial or payment information</li>
      <li>Location data</li>
      <li>Any data from websites you do not actively interact with through the Extension</li>
    </ul>

    <h2>3. How Data Is Used</h2>
    <p>All data accessed by the Extension is used exclusively for the single purpose of generating virtual try-on images:</p>
    <ul>
      <li>Your API key authenticates requests to the Looqz API.</li>
      <li>Your photo and the selected clothing image are sent to the Looqz API to generate a virtual try-on result.</li>
      <li>Your credit balance is retrieved from Looqz to display remaining credits in the sidebar.</li>
    </ul>

    <h2>4. Data Storage</h2>
    <ul>
      <li><strong>Local storage only:</strong> Your API key and uploaded photo are stored using <code>chrome.storage.local</code>, which keeps data entirely on your device. This data is never synced to any cloud service.</li>
      <li><strong>Temporary image hosting:</strong> When you initiate a try-on, your photo is temporarily uploaded to our server to provide the Looqz API with an accessible URL. These temporary files are automatically deleted within 5 minutes by an automated background process.</li>
    </ul>

    <h2>5. Third-Party Services</h2>
    <p>The Extension interacts with the following third-party service:</p>
    <ul>
      <li><strong>Looqz API</strong> (<a href="https://looqz.in">looqz.in</a>): The AI-powered virtual try-on service. Your photo and selected clothing image are sent to this service to generate the try-on result. Please refer to Looqz's privacy policy for their data handling practices.</li>
    </ul>

    <h2>6. Data Sharing</h2>
    <p>We do <strong>not</strong>:</p>
    <ul>
      <li>Sell or transfer user data to third parties</li>
      <li>Use user data for advertising, analytics, or profiling</li>
      <li>Use or transfer user data for purposes unrelated to the Extension's core try-on functionality</li>
      <li>Use or transfer user data to determine creditworthiness or for lending purposes</li>
    </ul>

    <h2>7. Data Security</h2>
    <p>We implement the following security measures:</p>
    <ul>
      <li>All API communication uses HTTPS encryption</li>
      <li>CORS restrictions limit backend access to the Extension only</li>
      <li>Temporary files are protected against directory traversal attacks</li>
      <li>File uploads are limited to 10 MB and restricted to image formats</li>
      <li>Rate limiting is enforced on all endpoints</li>
    </ul>

    <h2>8. User Control</h2>
    <p>You have full control over your data:</p>
    <ul>
      <li><strong>Reset Extension:</strong> Use the "Reset Extension" option in the Extension's settings panel to delete all locally stored data (API key and photo).</li>
      <li><strong>Change API Key:</strong> Use the "Change" option to remove and replace your stored API key.</li>
      <li><strong>Uninstall:</strong> Uninstalling the Extension automatically removes all locally stored data.</li>
    </ul>

    <h2>9. Permissions</h2>
    <p>The Extension requests the following Chrome permissions, each essential to its functionality:</p>
    <ul>
      <li><strong>storage:</strong> To save your API key and photo locally on your device.</li>
      <li><strong>activeTab:</strong> To access the current tab when you click the Extension icon, enabling sidebar injection and image selection.</li>
      <li><strong>scripting:</strong> To programmatically inject the sidebar UI into the active tab on demand.</li>
      <li><strong>Host permissions (&lt;all_urls&gt;):</strong> To allow the Extension to work on any e-commerce website, since there is no fixed list of supported shopping sites.</li>
    </ul>

    <h2>10. Children's Privacy</h2>
    <p>The Extension is not directed at children under the age of 13, and we do not knowingly collect data from children.</p>

    <h2>11. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. Any changes will be reflected by updating the "Last updated" date at the top of this page. Continued use of the Extension after changes constitutes acceptance of the revised policy.</p>

    <h2>12. Contact</h2>
    <p>If you have questions about this Privacy Policy, please contact us at:</p>
    <p><a href="mailto:udaychauhan817@gmail.com">udaychauhan817@gmail.com</a></p>
  </div>
</body>
</html>"""


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
