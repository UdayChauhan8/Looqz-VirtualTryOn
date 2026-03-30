import os
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

load_dotenv()

LOOQZ_API_URL = os.getenv("LOOQZ_API_URL", "https://looqz.in/api/v1/public/generate-image")
WHITELISTED_ORIGIN = os.getenv("WHITELISTED_ORIGIN", "https://your-app.onrender.com")

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Looqz Extension Proxy",
    description="Minimal CORS proxy for the Looqz Virtual Try-On Chrome Extension.",
    version="1.0.0"
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Chrome extensions don't send predictable origins
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ── Request / Response shapes ──────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    api_key: str
    product_image_url: str
    user_image_url: str

    @field_validator("api_key")
    @classmethod
    def validate_key_format(cls, v: str) -> str:
        if not v.startswith("sk_live_"):
            raise ValueError("API key must start with sk_live_")
        if len(v) != 40:
            raise ValueError("API key must be exactly 40 characters")
        return v


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    """Health check and service info."""
    return {
        "service": "Looqz Extension Proxy",
        "status": "running",
        "docs": "/docs",
        "purpose": "CORS proxy — forwards requests to Looqz API with whitelisted origin"
    }


@app.get("/health")
def health():
    """Simple health check for Render uptime monitoring."""
    return {"status": "healthy"}


@app.post("/generate")
@limiter.limit("30/minute")
async def generate(request: Request, body: GenerateRequest):
    """
    Forward a virtual try-on request to the Looqz API.

    The extension cannot call Looqz directly because chrome-extension:// origins
    are not whitelisted. This proxy sends the request from a stable HTTPS origin
    that IS whitelisted on Looqz's servers.

    Returns the Looqz API response unchanged, including rate limit headers.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                LOOQZ_API_URL,
                headers={
                    "Authorization": f"Bearer {body.api_key}",
                    "Content-Type": "application/json",
                    "Origin": WHITELISTED_ORIGIN,
                },
                json={
                    "product_image_url": body.product_image_url,
                    "user_image_url": body.user_image_url,
                }
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail={
                    "error": "timeout",
                    "message": "Looqz API did not respond in time. Try again.",
                    "type": "timeout_error"
                }
            )
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "network_error",
                    "message": "Could not reach Looqz servers.",
                    "type": "server_error"
                }
            )

    # Pass through Looqz error responses as-is with their status codes
    if not response.is_success:
        raise HTTPException(
            status_code=response.status_code,
            detail=response.json()
        )

    # Return Looqz response data + relevant headers for credits display
    data = response.json()

    # Attach credits info to response body for extension to read
    data["credits_remaining"] = response.headers.get("X-RateLimit-Remaining")
    data["credits_limit"] = response.headers.get("X-RateLimit-Limit")
    data["credits_reset"] = response.headers.get("X-RateLimit-Reset")

    return data
