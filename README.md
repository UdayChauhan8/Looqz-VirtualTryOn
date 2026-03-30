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
# Health checks
curl http://localhost:8000/health

# Generate Try-on
curl -X POST http://localhost:8000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "sk_live_your_key",
    "product_image_url": "https://example.com/jacket.jpg",
    "user_image_url": "https://example.com/person.jpg"
  }'
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
3. **Build Command:** `pip install -r backend/requirements.txt`
4. **Start Command:** `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
5. **Environment Variables:**
   - `WHITELISTED_ORIGIN`: Your Render deployment URL (`https://your-app.onrender.com`)
   - `LOOQZ_API_URL`: `https://looqz.in/api/v1/public/generate-image`

Make sure to update `PROXY_URL` in `extension/content.js` to match your newly deployed URL before compiling/zipping your extension for the Chrome Web Store.
