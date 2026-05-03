# Looqz Virtual Try-On

A Chrome extension that lets you virtually try on clothes from **any** shopping website using AI. Browse Amazon, Myntra, or any e-commerce site — pick a product, upload your photo, and see how it looks on you.

## How It Works

1. **Upload your photo** — taken once, saved locally on your device
2. **Pick a clothing item** — click any product image on the page
3. **See your look** — AI generates a realistic try-on image in seconds

## For Users

### Installation

1. Install **Looqz Virtual Try-On** from the [Chrome Web Store](#)
2. Go to [looqz.in](https://looqz.in) and sign up for an account
3. Navigate to **Developer** → **Create API Key** → select **Chrome Extension**
4. Copy your API key (`sk_live_...`)

### Usage

1. Visit any shopping website (Amazon, Myntra, Flipkart, etc.)
2. Click the **Looqz** icon in your Chrome toolbar → sidebar opens
3. Paste your API key → click **Save & Start**
4. Upload your photo (drag & drop or click to browse)
5. Pick a clothing item:
   - The extension auto-detects the main product image, **or**
   - Click **Pick from Website** → click any image on the page
6. Click **✨ Try On!**
7. View the result with the Before/After slider
8. **Download** or **Share** your look

> 🔒 Your API key and photos are stored **only on your device** — never on our servers.

---

## For Developers

### Architecture (v7)

```
Chrome Extension                    Render Proxy              Looqz API
┌──────────────┐                 ┌──────────────┐        ┌──────────────┐
│ background.js│──POST /upload──►│   main.py    │        │  looqz.in    │
│              │                 │  (images     │        │              │
│              │                 │   only)      │◄───────│  Fetches     │
│              │──POST /api/v1──────────────────────────►│  images      │
│              │  generate-image │              │        │  from Render  │
└──────────────┘  (direct call)  └──────────────┘        └──────────────┘
```

- **Extension** calls the Looqz API **directly** from the user's browser (residential IP bypasses Cloudflare)
- **Render proxy** only hosts temporary images — it never talks to the Looqz API
- Images are auto-deleted after 5 minutes by a background sweeper

### Project Structure

```
Looqz/
├── extension/
│   ├── manifest.json      # MV3 manifest — permissions & entry points
│   ├── background.js      # Service worker — API orchestration
│   ├── content.js         # Sidebar UI — injected into web pages
│   ├── content.css        # Sidebar styling — dark theme
│   ├── picker.js          # Image selection overlay
│   └── icons/             # Extension icons (16, 48, 128px)
│
├── backend/
│   ├── main.py            # FastAPI server — image hosting only
│   ├── requirements.txt   # Python dependencies
│   └── .env.example       # Environment variable template
│
├── .gitignore
└── README.md
```

### Local Setup — Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload
```

API docs at `http://localhost:8000/docs`

#### Testing Endpoints

```bash
# Health check
curl http://localhost:8000/health

# Upload images (returns public URLs)
curl -X POST http://localhost:8000/upload \
  -F "user_image=@photo.jpg" \
  -F "cloth_image=@shirt.jpg"

# Verify /upload exists
curl http://localhost:8000/
# → {"service":"Looqz Extension Proxy","version":"7.0.0",...}
```

### Local Setup — Chrome Extension

1. Go to `chrome://extensions` in Chrome
2. Toggle on **Developer Mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Visit any shopping website → click the Looqz toolbar icon

### Render Deployment

1. Connect your GitHub repository to [Render](https://render.com)
2. Create a new **Web Service**
3. **Root Directory:** `backend`
4. **Build Command:** `pip install -r requirements.txt`
5. **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`

#### Environment Variables

| Variable | Value | Purpose |
|---|---|---|
| `BACKEND_URL` | `https://your-app.onrender.com` | Constructs public `/tmp-image/` URLs |
| `ALLOWED_EXTENSION_ID` | Your Chrome Web Store extension ID | Locks CORS to your extension only |

> After deploying, update `PROXY_URL` in `extension/content.js` (line 6) to your Render URL.

### Security

| Layer | Protection |
|---|---|
| API Key | Bearer token authentication (Looqz API) |
| Domain Whitelist | Chrome extension ID as allowed Origin |
| CORS | Render locked to extension ID only |
| Rate Limiting | 60 req/min on both Render and Looqz |
| File Security | Strict regex blocks directory traversal |
| Disk Protection | Sweeper deletes temp files after 5 min |
| Upload Limit | 10 MB per file, enforced mid-stream |

## Tech Stack

- **Extension:** Vanilla JS, Manifest V3, Chrome APIs
- **Backend:** Python, FastAPI, Uvicorn
- **Hosting:** Render (free tier)
- **AI:** Looqz Virtual Try-On API
