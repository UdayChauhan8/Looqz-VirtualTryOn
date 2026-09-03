# Looqz Virtual Try-On

A Chrome extension that lets you virtually try on clothes from **any** shopping website using AI. Browse any e-commerce site — pick a product, upload your photo, and see how it looks on you in seconds.

## How It Works

1. **Upload your photo** — taken once, saved locally on your device
2. **Pick a clothing item** — click any product image on the page (or auto-detected)
3. **See your look** — AI generates a realistic try-on image in seconds
4. **Compare** — drag the Before/After slider to see the difference

---

## Getting Started

### Step 1: Install the Extension

Install **Looqz Virtual Try-On** from the [Chrome Web Store](https://chromewebstore.google.com/detail/looqz-virtual-try-on/hellloagipopgbgabmifdjolaokfpkba?hl=en-GB&authuser=0).

### Step 2: Create Your API Key

1. Go to [looqz.in](https://looqz.in) and create an account
2. Navigate to **Developer** → **API Keys** → click **Create API Key**
3. Enter a name for your key (e.g., "My Extension")
4. In **Domain Configuration**, select **Custom**
5. In the **Allowed Domains** field, enter your extension ID:
   ```
   (shown inside the extension's setup screen — click the copy button)
   ```
   > **How to find your Extension ID:** Open `chrome://extensions/` → find "Looqz Virtual Try-On" → the ID is shown below the extension name.
6. Click **Create** and copy your API key (`sk_live_...`)

### Step 3: Start Using It

1. Visit any shopping website
2. Click the **Looqz** icon in your Chrome toolbar — a sidebar will open
3. Paste your API key → click **Connect**
4. Upload your photo (drag & drop or click to browse)
5. Pick a clothing item:
   - The extension **auto-detects** the main product image on the page, **or**
   - Click **Pick garment** → click any image on the page manually
6. Click **✨ Try it on**
7. View the result with the interactive Before/After slider
8. **Download** or **Copy link** to share your look

> 🔒 **Privacy:** Your API key and photos are stored **only on your device** — never sent to our servers except during the try-on request.

---

## For Developers

### Architecture (v7)

The extension uses a direct two-step architecture:

```
Chrome Extension (content.js / background.js)
        │
        ├─ Step 1: POST /upload (multipart) ──► Render Proxy (main.py)
        │                                              │
        │          ◄── { user_image_url,               └──► Google Cloud Storage
        │                cloth_image_url }
        │
        └─ Step 2: POST /api/v1/public/generate-image ──► https://looqz.in
                   Bearer <api_key>
                   { product_image_url, user_image_url,
                     product_page_url, product_title }
```

- **Extension** calls the Looqz API **directly** from the user's browser (residential IP bypasses Cloudflare)
- **Render proxy** only hosts temporary images in Google Cloud Storage — it never touches the Looqz API
- **Service worker** (`background.js`) handles all network requests, storage bridging, and downloads

### Project Structure

```
Looqz/
├── extension/
│   ├── manifest.json      # MV3 manifest — permissions & entry points (v1.2.1)
│   ├── background.js      # Service worker — API orchestration, storage bridge
│   ├── content.js         # Sidebar UI — injected into web pages, SPA self-healing
│   ├── content.css        # Sidebar styling — dark theme
│   ├── picker.js          # Image selection overlay
│   └── icons/             # Extension icons (16, 48, 128px) + looqzicon.png
│
├── backend/
│   ├── main.py            # FastAPI proxy — GCS upload, /upload endpoint, /privacy
│   ├── requirements.txt   # Python dependencies
│   └── .env.example       # Environment variable template
│
├── .gitignore
└── README.md
```

### Key Features (v7)

| Feature | Details |
|---|---|
| **Auto-detect garment** | `picker.js` scans the page for the main product image automatically on open |
| **Direct API call** | `background.js` sends multipart/form-data to Looqz directly — no server middleman |
| **CORS fallback** | If cloth image fetch fails (CORS), URL is passed as string instead of binary |
| **SPA self-healing** | `MutationObserver` detects when React/Next.js SPAs wipe the DOM and auto-restores the sidebar |
| **Auto-upright fix** | Detects and corrects horizontally-rotated AI output when the user photo is portrait |
| **Credit badge** | Real-time credit balance fetched from the Looqz dashboard and shown in the sidebar header |
| **Image downscale** | User photos are resized to max 1024px / JPEG 82% before upload (~150 KB payload) |
| **PING pattern** | Bulletproof tab injection — PING before inject prevents duplicate scripts on re-click |

### Security

| Layer | Protection |
|---|---|
| API Key | Bearer token authentication (Looqz API) |
| Domain Whitelist | Extension ID as allowed Origin hostname |
| CORS | Render proxy locked to `chrome-extension://<extension_id>` |
| Rate Limiting | 60 req/min on the `/upload` proxy endpoint |
| Upload Limit | 10 MB per file, enforced by the backend |
| Permissions | `storage`, `activeTab`, `scripting`, `downloads` — no broad host access beyond try-on |

### Environment Variables (backend)

| Variable | Description |
|---|---|
| `BACKEND_URL` | Public URL of the Render proxy (used for self-reference) |
| `ALLOWED_EXTENSION_ID` | Your Chrome extension ID — locks CORS to your extension only |
| `GCS_BUCKET_NAME` | Google Cloud Storage bucket for hosting uploaded images |
| `GCS_PUBLIC_BASE_URL` | Optional custom CDN base URL for GCS objects |

## Tech Stack

- **Extension:** Vanilla JS, Manifest V3, Chrome APIs (storage, scripting, downloads, activeTab)
- **Backend:** Python, FastAPI, slowapi, Google Cloud Storage
- **AI:** Looqz Virtual Try-On API (`looqz.in`)
- **Hosting:** Render (proxy backend)

---

> ☕ Like this project? [Buy me a coffee](https://paypal.me/UdayChauhan8) to support development.
