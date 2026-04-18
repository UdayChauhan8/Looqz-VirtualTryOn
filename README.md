# Looqz Virtual Try-On

A production-quality Chrome extension and backend proxy for Looqz Virtual Try-On.
Built using Vanilla JS, Manifest V3, and a single-file FastAPI stateless proxy.

## Architecture
- **Frontend (Extension):** Native `chrome.storage.local` combined with DOM injection and manipulation.
- **Backend (Proxy):** FastAPI deployed on Render to bypass Chrome Extension Origin/CORS limitations. No database, no auth handling.

## 1. Local Setup - Backend Proxy

The FastAPI backend only has 6 dependencies and one file.

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Start the local server:
```bash
uvicorn main:app --reload
```
You can view the auto-generated Swagger documentation at `http://localhost:8000/docs`.

### Testing Proxy Endpoints
```bash
# Health check
curl http://localhost:8000/health

# Validate an API key
curl -X POST http://localhost:8000/validate-key \
  -H "Content-Type: application/json" \
  -d '{"api_key": "sk_live_your_key_here_32chars_long"}'

# Generate Try-on (multipart/form-data)
curl -X POST http://localhost:8000/generate \
  -F "api_key=sk_live_your_key_here_32chars_long" \
  -F "user_image=@/path/to/your/photo.jpg" \
  -F "product_image_url=https://example.com/jacket.jpg"
```

## 2. Local Setup - Chrome Extension

1. Go to `chrome://extensions` in Google Chrome or Edge.
2. Toggle on **Developer Mode** (top right corner).
3. Click **Load unpacked**.
4. Select the `extension/` folder from this repository.
5. Go to any shopping website (e.g., amazon.com, myntra.com).
6. Click the newly added **Looqz Virtual Try-On** icon in your toolbar.
7. Paste your `sk_live_...` API key.

## 3. Render Deployment (Backend)

1. Connect your GitHub repository to Render.
2. Create a new **Web Service**.
3. **Root Directory:** `backend`
4. **Build Command:** `pip install -r requirements.txt`
5. **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`

### Required Environment Variables

| Variable | Value | Purpose |
|---|---|---|
| `BACKEND_URL` | `https://your-app.onrender.com` | Constructs `/tmp-image/` URLs that Looqz fetches |
| `WHITELISTED_ORIGIN` | `https://your-app.onrender.com` | Sent as `Origin` header to the Looqz API |
| `LOOQZ_API_URL` | `https://www.looqz.in/api/v1/public/generate-image` | Looqz generation endpoint |
| `ALLOWED_EXTENSION_ID` | Your extension ID from `chrome://extensions` | Locks CORS to your extension only |

> **Important:** After deploying, update `PROXY_URL` and `VALIDATE_URL` in `extension/content.js` (lines 5-6) to your Render URL before publishing to the Chrome Web Store.
