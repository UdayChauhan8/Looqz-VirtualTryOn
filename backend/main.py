import os
import uuid
import asyncio
import requests
import boto3
from botocore.config import Config
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, Request, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

LOOQZ_API_URL      = os.getenv("LOOQZ_API_URL", "https://www.looqz.in/api/v1/public/generate-image")
WHITELISTED_ORIGIN = os.getenv("WHITELISTED_ORIGIN", "http://127.0.0.1:8000")

R2_ACCOUNT_ID      = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID   = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_KEY      = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET          = os.getenv("R2_BUCKET_NAME", "looqz-tryon-temp")
PRESIGN_TTL        = int(os.getenv("PRESIGN_TTL_SECONDS", "300"))   # 5 minutes

# ── R2 / S3 client ────────────────────────────────────────────────────────────
# Cloudflare R2 is S3-compatible. To switch to AWS S3, remove `endpoint_url`.
# The client is None when env vars are not configured (local dev without R2).

def _make_r2_client():
    if not all([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_KEY]):
        return None
    return boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )

r2 = _make_r2_client()

# Thread pool — sync boto3 / requests calls run here, never blocking the loop
executor = ThreadPoolExecutor(max_workers=10)

# ── App ───────────────────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Looqz Extension Proxy",
    description="Secure multipart proxy for the Looqz Virtual Try-On Chrome Extension.",
    version="3.0.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ── R2 helpers (run in thread pool) ──────────────────────────────────────────

def _upload_bytes_to_r2(data: bytes, key: str, content_type: str = "image/jpeg") -> str:
    """
    Streams bytes into the private R2 bucket under the given key.
    Returns the key so the caller can generate a pre-signed URL or delete it.
    Raises if the client is not configured or upload fails.
    """
    if r2 is None:
        raise RuntimeError("R2 client not configured. Set R2_* env vars.")
    r2.put_object(
        Bucket=R2_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key


def _generate_presigned_url(key: str) -> str:
    """
    Generates a temporary GET URL for a private R2 object.
    Expires in PRESIGN_TTL seconds (default 5 minutes).
    After that the URL is permanently dead — the Looqz API will have
    already downloaded the image long before expiry.
    """
    if r2 is None:
        raise RuntimeError("R2 client not configured.")
    return r2.generate_presigned_url(
        "get_object",
        Params={"Bucket": R2_BUCKET, "Key": key},
        ExpiresIn=PRESIGN_TTL,
    )


def _delete_r2_objects(keys: list[str]) -> None:
    """
    Deletes one or more objects from R2.
    Called via FastAPI BackgroundTasks so it runs AFTER the HTTP response
    is sent to the client — zero added latency for the user.
    The R2 bucket also has a 24-hour lifecycle rule as an infra-level
    failsafe in case this call is skipped (e.g. server crash).
    """
    if r2 is None:
        return
    for key in keys:
        try:
            r2.delete_object(Bucket=R2_BUCKET, Key=key)
        except Exception as e:
            print(f"[Looqz] R2 delete failed for {key}: {e}")


# ── Looqz API caller (sync, runs in thread pool) ─────────────────────────────

def _call_looqz(api_key: str, product_url: str, user_url: str) -> requests.Response:
    """
    Calls the Looqz generation API.
    Both product_url and user_url must be publicly fetchable at call time.
    When using R2, these are pre-signed URLs that expire in 5 minutes.
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


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "service": "Looqz Extension Proxy",
        "status": "running",
        "version": "3.0.0",
        "r2_configured": r2 is not None,
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


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
    if not body.api_key.startswith("sk_live_"):
        return JSONResponse(status_code=400, content={"message": "Invalid key format."})

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


@app.post("/generate")
@limiter.limit("30/minute")
async def generate(
    request: Request,
    background_tasks: BackgroundTasks,
    # ── Form fields ──────────────────────────────────────────────────────────
    api_key: str = Form(...),
    # ── File uploads (optional — exactly one of the two cloth fields present)
    user_image: UploadFile = File(...),
    product_image: UploadFile = File(None),     # Blob path
    product_image_url: str = Form(None),         # URL fallback path
):
    """
    Secure multipart try-on endpoint.

    The caller (background.js) always uploads the user photo as a binary file.
    For the cloth image it sends EITHER a binary file (product_image) OR a raw
    URL string (product_image_url) depending on whether it could fetch the
    cloth image from the CDN without a CORS error.

    This endpoint:
      1. Validates the API key format.
      2. Streams both binary uploads directly into the private R2 bucket
         (UUID object keys — cannot be guessed).
      3. Generates pre-signed GET URLs (5-minute TTL).
      4. Forwards the pre-signed URLs to the Looqz API.
      5. Queues background deletion of the R2 objects (non-blocking —
         response is returned to the client before deletion runs).
    """

    # Validate key format early — avoids unnecessary R2 writes
    if not api_key.startswith("sk_live_"):
        return JSONResponse(status_code=400, content={
            "message": "Invalid API key format. Must start with sk_live_"
        })

    # Validate that exactly one cloth source was provided
    if product_image is None and not product_image_url:
        return JSONResponse(status_code=400, content={
            "message": "Provide either product_image (file) or product_image_url (string)."
        })

    loop = asyncio.get_event_loop()
    uploaded_keys: list[str] = []

    try:
        # ── Step 1: Upload user photo to R2 ──────────────────────────────────
        user_bytes = await user_image.read()
        user_key = f"user/{uuid.uuid4()}.jpg"

        await loop.run_in_executor(
            executor, _upload_bytes_to_r2, user_bytes, user_key,
            user_image.content_type or "image/jpeg"
        )
        uploaded_keys.append(user_key)

        user_presigned_url = await loop.run_in_executor(
            executor, _generate_presigned_url, user_key
        )

        # ── Step 2: Handle cloth image ────────────────────────────────────────
        if product_image is not None:
            # Binary path: upload to R2, generate pre-signed URL
            cloth_bytes = await product_image.read()
            cloth_key = f"cloth/{uuid.uuid4()}.jpg"

            await loop.run_in_executor(
                executor, _upload_bytes_to_r2, cloth_bytes, cloth_key,
                product_image.content_type or "image/jpeg"
            )
            uploaded_keys.append(cloth_key)

            cloth_url = await loop.run_in_executor(
                executor, _generate_presigned_url, cloth_key
            )
        else:
            # URL fallback path: pass raw URL directly — no R2 upload needed
            cloth_url = product_image_url

        # ── Step 3: Call Looqz API ────────────────────────────────────────────
        response = await loop.run_in_executor(
            executor, _call_looqz, api_key, cloth_url, user_presigned_url
        )

    except RuntimeError as e:
        # R2 not configured — surface a clear error during local dev
        return JSONResponse(status_code=503, content={"message": str(e)})
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
        # ── Step 4: Queue non-blocking R2 cleanup ─────────────────────────────
        # BackgroundTasks runs AFTER FastAPI sends the response — zero latency
        # impact on the user. The R2 bucket lifecycle rule (24h) is the
        # infra-level failsafe if this code path is skipped (e.g. OOM crash).
        if uploaded_keys:
            background_tasks.add_task(_delete_r2_objects, uploaded_keys)

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
