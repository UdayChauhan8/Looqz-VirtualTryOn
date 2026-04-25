// background.js — Looqz Virtual Try-On (v6)
//
// Architecture v6:
//   The Looqz API checks the Origin header to verify domain authorization.
//   Chrome extensions send "Origin: chrome-extension://<id>" which Looqz rejects.
//   Chrome hard-blocks any attempt to spoof Origin from extensions (even via DNR).
//
//   Solution: Route ALL Looqz API calls through our Python backend proxy.
//   Python httpx is NOT a browser — it can set Origin to anything.
//   The backend sets Origin: https://www.looqz.in on every outgoing request.
//
//   Flow:
//     1. Extension uploads images to proxy (/upload-image) → gets public URLs
//     2. Extension sends URLs + API key to proxy (/generate)
//     3. Proxy calls Looqz API with correct Origin header
//     4. Proxy returns Looqz response to extension

// ── Toolbar click: PING pattern (bulletproof Path A / Path B detection) ───────
//
// We NEVER track injected tabs in a background-side Set or array.
// If the user refreshes the page, Chrome keeps the same tabId but wipes every
// injected content script. Any background state variable would lie. The content
// script itself is the only reliable oracle.
//
// Flow:
//   PING → success  → Path A: content script alive, send TOGGLE_SIDEBAR directly.
//   PING → failure  → Path B: inject CSS + scripts. Do NOT send TOGGLE_SIDEBAR
//                     here (executeScript race condition). Instead, content.js
//                     fires CONTENT_SCRIPT_READY once fully initialised, and
//                     the message router below uses that as the safe trigger.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url ||
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://')) return;

  // ── PING ────────────────────────────────────────────────────────────────────
  const alive = await chrome.tabs
    .sendMessage(tab.id, { action: 'PING' })
    .then(() => true)
    .catch(() => false);

  if (alive) {
    // Path A: script is live — toggle immediately
    chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_SIDEBAR' }).catch(() => {});
    return;
  }

  // Path B: script absent (first load or post-refresh) — inject
  // TOGGLE_SIDEBAR is intentionally NOT sent here.
  // We wait for CONTENT_SCRIPT_READY from the tab (handled below).
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['picker.js', 'content.js']   // picker.js before content.js
    });
  } catch (err) {
    console.warn('Looqz: injection failed on tab', tab.id, err.message);
  }
});

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── PING ──────────────────────────────────────────────────────────────────
  // Liveness check from onClicked. Sync response — no need to keep channel open.
  if (message.action === 'PING') {
    sendResponse({ alive: true });
    return false;
  }

  // ── CONTENT_SCRIPT_READY ──────────────────────────────────────────────────
  // content.js sends this at the very end of its kickoff block, after
  // registerGlobalListeners() and init() have both fully completed.
  // This is the race-condition-safe moment to send TOGGLE_SIDEBAR — we know
  // for certain the listener is registered and the sidebar DOM exists.
  if (message.action === 'CONTENT_SCRIPT_READY') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs
        .sendMessage(sender.tab.id, { action: 'TOGGLE_SIDEBAR' })
        .catch(() => {});
    }
    return false;
  }

  // ── Storage bridge ────────────────────────────────────────────────────────
  if (message.action === 'GET_STORAGE') {
    chrome.storage.local.get(message.keys, (result) => {
      sendResponse({ data: result });
    });
    return true;
  }

  if (message.action === 'SET_STORAGE') {
    chrome.storage.local.set(message.data, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'CLEAR_STORAGE') {
    chrome.storage.local.clear(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  // ── VALIDATE_KEY ──────────────────────────────────────────────────────────
  // Validates the API key by sending a test request through our backend proxy.
  // The proxy sets correct Origin headers so Looqz accepts the domain.
  if (message.action === 'VALIDATE_KEY') {
    const proxyGenerateUrl = message.proxyUrl.replace(/\/$/, '') + '/generate';

    fetch(proxyGenerateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        api_key: message.apiKey,
        product_image_url: 'https://placehold.co/150x200/png',
        user_image_url:    'https://placehold.co/150x200/png',
      }),
    })
      .then(async res => {
        let data = {};
        try { data = await res.json(); } catch (e) { /* non-JSON */ }
        sendResponse({ ok: res.ok, status: res.status, data });
      })
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  // ── TRYON_WITH_BLOBS ──────────────────────────────────────────────────────
  // v6 Pipeline — ALL calls go through our backend proxy:
  //   1. Upload user photo to proxy (/upload-image) → get public URL
  //   2. Attempt fetch(clothImageUrl) → Blob → upload to proxy too
  //      If that fails (CORS), pass URL directly
  //   3. Call proxy /generate with URLs + API key
  //      Proxy calls Looqz API with correct Origin header
  //   4. Return parsed JSON response
  if (message.action === 'TRYON_WITH_BLOBS') {
    handleTryOn(message).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // keep the message channel open for async response
  }

  // ── FETCH_LEDGER_CREDITS ──────────────────────────────────────────────────
  // Scrapes the Looqz dashboard to get the user's real-time credit balance.
  if (message.action === 'FETCH_LEDGER_CREDITS') {
    fetch('https://www.looqz.in/credits', { redirect: 'error' })
      .then(r => r.text())
      .then(html => {
        let credits = null;

        // Primary: extract Inertia.js backend JSON embedded in the page
        const inertiaMatch = html.match(/data-page="([^"]+)"/);
        if (inertiaMatch) {
          try {
            const jsonStr = inertiaMatch[1].replace(/&quot;/g, '"');
            const pageData = JSON.parse(jsonStr);

            if (pageData.props?.auth?.user) {
              const u = pageData.props.auth.user;
              if (u.credits !== undefined)       credits = parseInt(u.credits);
              else if (u.balance !== undefined)  credits = parseInt(u.balance);
            }

            if (credits === null) {
              const searchJSON = (obj) => {
                if (!obj || typeof obj !== 'object') return null;
                for (const k of Object.keys(obj)) {
                  const key = k.toLowerCase();
                  if (
                    (key === 'credits' || key === 'balance' ||
                     key === 'total_credits' || key === 'totalcredits') &&
                    typeof obj[k] === 'number'
                  ) return obj[k];
                  if (typeof obj[k] === 'object') {
                    const res = searchJSON(obj[k]);
                    if (res !== null) return res;
                  }
                }
                return null;
              };
              credits = searchJSON(pageData.props);
            }
          } catch (e) {
            console.error('Looqz: Inertia parsing failed', e);
          }
        }

        // Fallback: regex against the HTML
        if (credits === null) {
          const match = html.match(/Total Credits[\s\S]{1,150}?(?:>|:\s*)(\d{1,5})(?:<|\s)/i);
          if (match) credits = parseInt(match[1]);
        }

        if (credits !== null && !isNaN(credits)) {
          sendResponse({ credits });
        } else {
          sendResponse({ error: 'Could not locate credits in HTML/JSON' });
        }
      })
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Converts a Base64 Data URL string to a Blob.
 * @param {string} dataUrl  e.g. "data:image/jpeg;base64,/9j/4AAQ..."
 * @returns {Blob}
 */
function base64ToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * Uploads a single Blob to the proxy /upload-image endpoint.
 * Returns the public URL string.
 * @param {Blob} blob
 * @param {string} filename
 * @param {string} uploadUrl  e.g. "https://your-backend.onrender.com/upload-image"
 * @returns {Promise<string>}
 */
async function uploadToProxy(blob, filename, uploadUrl) {
  const form = new FormData();
  form.append('image', blob, filename);
  const res = await fetch(uploadUrl, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Proxy upload failed (${res.status}): ${body.slice(0, 120)}`);
  }
  const { url } = await res.json();
  return url;
}

/**
 * Core try-on handler — runs fully in the service worker.
 *
 * v6 Pipeline (all calls through backend proxy):
 *   1. Upload user photo → proxy /upload-image → get public URL
 *   2. Try to fetch cloth image as Blob:
 *        a. Success → upload cloth blob to proxy → get public URL
 *        b. Failure → use raw clothImageUrl directly (Looqz fetches it itself)
 *   3. Call proxy /generate with URLs + API key.
 *      The backend sets Origin: https://www.looqz.in and calls Looqz API.
 *   4. Return the parsed JSON response.
 */
async function handleTryOn({ userPhotoBase64, clothImageUrl, apiKey, proxyUrl }) {
  const baseUrl = proxyUrl.replace(/\/generate$/, '').replace(/\/$/, '');
  const uploadUrl = baseUrl + '/upload-image';
  const generateUrl = baseUrl + '/generate';

  // 1. Upload user photo to proxy
  const userBlob = base64ToBlob(userPhotoBase64);
  const userPublicUrl = await uploadToProxy(userBlob, 'user.jpg', uploadUrl);

  // 2. Get cloth image URL
  let clothPublicUrl = null;
  try {
    const clothRes = await fetch(clothImageUrl);
    if (!clothRes.ok) throw new Error(`HTTP ${clothRes.status}`);
    const clothBlob = await clothRes.blob();
    // Upload the cloth blob to the proxy too so Looqz can fetch it
    clothPublicUrl = await uploadToProxy(clothBlob, 'cloth.jpg', uploadUrl);
  } catch (err) {
    console.warn(`Looqz: cloth handling failed (${err.message}), using direct URL`);
    // Fall back: pass the original URL directly — Looqz's servers fetch it
    clothPublicUrl = clothImageUrl;
  }

  // 3. Call our backend /generate which proxies to Looqz with correct Origin
  const proxyRes = await fetch(generateUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      product_image_url: clothPublicUrl,
      user_image_url: userPublicUrl,
    }),
  });

  let data = {};
  try { data = await proxyRes.json(); } catch (e) { /* non-JSON body */ }

  return { ok: proxyRes.ok, status: proxyRes.status, data };
}
