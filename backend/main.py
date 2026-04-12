import os
import asyncio
import requests
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

load_dotenv()

LOOQZ_API_URL = os.getenv("LOOQZ_API_URL", "https://www.looqz.in/api/v1/public/generate-image")
WHITELISTED_ORIGIN = os.getenv("WHITELISTED_ORIGIN", "http://127.0.0.1:8000")

# Thread pool for running sync requests without blocking the event loop
executor = ThreadPoolExecutor(max_workers=10)

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Looqz Extension Proxy",
    description="Minimal CORS proxy for the Looqz Virtual Try-On Chrome Extension.",
    version="2.0.0"
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ── Request shape ───────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    api_key: str
    product_image_url: str
    user_image_url: str

    @field_validator("api_key")
    @classmethod
    def validate_key_format(cls, v: str) -> str:
        if not v.startswith("sk_live_"):
            raise ValueError("API key must start with sk_live_")
        return v


# ── Sync request function (runs in thread pool) ─────────────────────────────────

def _call_looqz(api_key: str, product_url: str, user_url: str) -> requests.Response:
    """
    Synchronous function that calls Looqz API using requests.
    Runs in a thread pool to avoid blocking the async event loop.
    Uses connect timeout=10s and read timeout=90s (AI generation is slow).
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": WHITELISTED_ORIGIN,
        "Referer": WHITELISTED_ORIGIN + "/",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    }
    payload = {
        "product_image_url": product_url,
        "user_image_url": user_url,
    }
    # requests timeout=(connect_timeout, read_timeout)
    return requests.post(
        LOOQZ_API_URL,
        headers=headers,
        json=payload,
        timeout=(10, 90),
        allow_redirects=True,
    )


# ── Routes ──────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "service": "Looqz Extension Proxy",
        "status": "running",
        "version": "2.0.0",
        "purpose": "CORS proxy — forwards requests to Looqz API with whitelisted origin"
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/generate")
@limiter.limit("30/minute")
async def generate(request: Request, body: GenerateRequest):
    """
    Forward a virtual try-on request to the Looqz API using requests in a thread pool.
    This avoids the httpx async timeout bug with Cloudflare keep-alive connections.
    """
    loop = asyncio.get_event_loop()
    try:
        # Run the blocking request in a thread pool
        response = await loop.run_in_executor(
            executor,
            _call_looqz,
            body.api_key,
            body.product_image_url,
            body.user_image_url,
        )

    except requests.exceptions.ConnectTimeout:
        return JSONResponse(status_code=504, content={
            "message": "Could not connect to Looqz servers (timeout). Check your internet connection."
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
            "message": f"Proxy error: {str(e)}\n\n{traceback.format_exc()[:400]}"
        })

    # Handle non-200 responses from Looqz
    if not response.ok:
        try:
            err_content = response.json()
        except Exception:
            err_content = {"message": f"Looqz error {response.status_code}: {response.text[:200]}"}
        return JSONResponse(status_code=response.status_code, content=err_content)

    # Parse and enrich the success response
    try:
        data = response.json()
    except Exception:
        return JSONResponse(status_code=502, content={
            "message": f"Looqz returned non-JSON response: {response.text[:200]}"
        })

    data["credits_remaining"] = response.headers.get("X-RateLimit-Remaining")
    data["credits_limit"] = response.headers.get("X-RateLimit-Limit")
    data["credits_reset"] = response.headers.get("X-RateLimit-Reset")

    return data
