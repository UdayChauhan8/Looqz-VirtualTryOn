// content.js - Looqz Virtual Try-On
// Wrapping in IIFE to avoid polluting global scope
(function () {

  const PROXY_URL = "http://127.0.0.1:8000/generate"; // Local testing
  // const PROXY_URL = "https://your-proxy.onrender.com/generate"; // Deploy URL

  const STATE = {
    apiKey: null,
    userPhotoBase64: null,
    productImageUrl: null,
    creditsRemaining: null,
    currentScreen: 'screen-apikey',
    resultImageUrl: null,
    isPickerActive: false,
    sidebarOpen: false,
    abortController: null
  };

  window.looqzState = STATE; // Share with picker.js

  // ─────────────────────────────────────────────────────────────────────────────
  // HTML TEMPLATE
  // ─────────────────────────────────────────────────────────────────────────────
  const SIDEBAR_HTML = `
<div id="looqz-sidebar" class="looqz-hidden">
  
  <div id="looqz-header">
    <div id="looqz-logo">
      <span></span>
      <span>Looqz</span>
    </div>
    <div id="looqz-header-right">
      <span id="looqz-credits-badge" class="looqz-credits-badge"></span>
      <button id="looqz-settings-toggle" class="looqz-icon-btn">⚙️</button>
      <button id="looqz-close-btn" class="looqz-icon-btn">✕</button>
    </div>
  </div>

  <div id="looqz-settings-panel" class="looqz-settings-panel">
    <div style="font-size:12px;color:gray;margin-bottom:8px">Settings</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-size:13px" id="looqz-key-display">Key: ...</span>
      <span class="looqz-text-link" id="looqz-change-key">Change</span>
    </div>
    <div style="margin-bottom:12px">
      <span class="looqz-text-link" id="looqz-my-tryons">👕 My Try-Ons on Looqz.in</span>
    </div>
    <div>
      <span class="looqz-text-link" id="looqz-reset-ext" style="color:#EF4444">🚪 Reset Extension</span>
    </div>
  </div>

  <!-- SCREEN 1: API KEY -->
  <div id="looqz-screen-apikey" class="looqz-screen">
    <h3 style="margin-top:0">Welcome! 👋</h3>
    <p style="color:#9CA3AF;line-height:1.5;">Enter your Looqz API key to start trying on clothes from any website.</p>
    
    <input type="password" id="looqz-apikey-input" class="looqz-input" placeholder="sk_live_..." autocomplete="off">
    <div id="looqz-apikey-error" class="looqz-error-text">Keys look like: sk_live_ followed by 32 characters</div>

    <button id="looqz-btn-save-key" class="looqz-btn-primary">Save & Start</button>
    
    <p style="text-align:center;margin-top:24px;color:#9CA3AF;">
      Don't have one?<br>
      <span class="looqz-text-link" id="looqz-get-key">Get a free key at looqz.in →</span>
    </p>
    <p style="text-align:center;margin-top:24px;font-size:12px;color:#6B7280;">🔒 Stored only on your device</p>
  </div>

  <!-- SCREEN 2: MAIN -->
  <div id="looqz-screen-main" class="looqz-screen">
    
    <div class="looqz-section-title">Your Picture</div>
    
    <!-- If no saved photo -->
    <div id="looqz-user-upload-area">
      <div class="looqz-dropzone" id="looqz-user-dropzone">
        <div style="font-size:24px;margin-bottom:8px">⬆</div>
        <div style="font-size:14px;color:#9CA3AF">Click or drag to upload your photo</div>
      </div>
      <div class="looqz-upload-buttons">
        <button id="looqz-btn-user-upload" class="looqz-btn-secondary">📁 Upload</button>
        <input type="file" id="looqz-input-user-file" accept="image/*" style="display:none">
      </div>
    </div>
    
    <!-- If saved photo exists -->
    <div id="looqz-user-saved-area" style="display:none">
      <div class="looqz-image-preview-card">
        <img id="looqz-user-thumb" class="looqz-image-preview-thumb" src="">
        <div class="looqz-image-preview-info">
          <div class="looqz-image-preview-name">Saved Photo</div>
          <span class="looqz-text-link" id="looqz-btn-user-change">✕ Change</span>
        </div>
      </div>
    </div>

    <div class="looqz-section-title">Cloth Image</div>
    
    <!-- Cloth area -->
    <div id="looqz-cloth-select-area">
      <div class="looqz-upload-buttons" style="margin-bottom:12px">
        <button id="looqz-btn-pick-web" class="looqz-btn-secondary">🖱 Pick from website</button>
      </div>
    </div>

    <!-- Cloth selected preview -->
    <div id="looqz-cloth-preview-area" style="display:none">
      <div class="looqz-image-preview-card">
        <img id="looqz-cloth-thumb" class="looqz-image-preview-thumb" src="">
        <div class="looqz-image-preview-info">
          <div class="looqz-image-preview-name" id="looqz-cloth-preview-title">Selected</div>
          <span class="looqz-text-link" id="looqz-btn-cloth-change">Change</span>
        </div>
      </div>
    </div>

    <div style="margin-top:24px">
      <!-- Mini preview row shown only when both are ready -->
      <div id="looqz-mini-preview-row" class="looqz-mini-preview-row" style="display:none">
        <div class="looqz-mini-preview-item">
          <img id="looqz-mini-user" class="looqz-mini-preview-thumb">
          <span>Your photo</span>
        </div>
        <div class="looqz-mini-preview-arrow">→</div>
        <div class="looqz-mini-preview-item">
          <img id="looqz-mini-cloth" class="looqz-mini-preview-thumb">
          <span>Cloth</span>
        </div>
      </div>
      
      <button id="looqz-btn-tryon" class="looqz-btn-primary" disabled>✨ Try On!</button>
      <div id="looqz-tryon-error" class="looqz-error-text" style="display:none;margin-top:12px;text-align:center;"></div>
    </div>

  </div>

  <!-- SCREEN 3: LOADING -->
  <div id="looqz-screen-loading" class="looqz-screen">
    <div class="looqz-mini-preview-row">
      <div class="looqz-mini-preview-item">
        <img id="looqz-loading-user" class="looqz-mini-preview-thumb">
      </div>
      <div class="looqz-mini-preview-arrow">→</div>
      <div class="looqz-mini-preview-item">
        <img id="looqz-loading-cloth" class="looqz-mini-preview-thumb">
      </div>
    </div>

    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:8px;padding:24px;text-align:center;margin-bottom:16px">
      <div class="looqz-shimmer"></div>
      <div id="looqz-loading-text" style="font-weight:600;margin-top:16px">✨ Creating your look...</div>
      <div style="color:#9CA3AF;font-size:12px;margin-top:8px">Usually takes 2–5s</div>
      <div class="looqz-progress-container">
        <div class="looqz-progress-bar" id="looqz-progress-bar"></div>
      </div>
    </div>

    <button id="looqz-btn-cancel" class="looqz-btn-secondary">✕ Cancel</button>
  </div>

  <!-- SCREEN 4: RESULT -->
  <div id="looqz-screen-result" class="looqz-screen">
    <h3 style="margin-top:0">🎉 Here's your look!</h3>
    
    <div class="looqz-comparison" id="looqz-comparison">
      <div class="looqz-comparison-after">
        <img id="looqz-result-after" src="">
      </div>
      <div class="looqz-comparison-before" id="looqz-comparison-before">
        <img id="looqz-result-before" src="">
      </div>
      <div class="looqz-slider-handle" id="looqz-slider-handle">
        <div class="looqz-slider-btn">◄►</div>
      </div>
    </div>

    <div id="looqz-zero-credits-banner" class="looqz-zero-credits-banner">
      ⚠️ That was your last credit this month.<br>
      <span class="looqz-text-link" id="looqz-link-banner-buy" style="margin-top:4px;display:inline-block">Buy More</span>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;margin-top:16px">
      <button id="looqz-btn-download" class="looqz-btn-secondary" style="flex:1">⬇ Download</button>
      <button id="looqz-btn-share" class="looqz-btn-secondary" style="flex:1">🔗 Share</button>
    </div>

    <button id="looqz-btn-another" class="looqz-btn-primary">🔄 Try with Another Image</button>

  </div>

</div>
`;

  // ─────────────────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────────────────────────
  function init() {
    if (document.getElementById('looqz-sidebar')) return;

    const div = document.createElement('div');
    div.innerHTML = SIDEBAR_HTML;
    document.body.appendChild(div.firstElementChild);

    bindEvents();
    setupSlider();

    // Listen for background toggle
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'TOGGLE_SIDEBAR') {
        toggleSidebar();
      }
    });

    // Listen for picker
    document.addEventListener('looqz-image-selected', (e) => {
      STATE.productImageUrl = e.detail.url;
      updateMainScreenState();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STATE & SCREEN MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────
  async function toggleSidebar() {
    const sidebar = document.getElementById('looqz-sidebar');
    STATE.sidebarOpen = !STATE.sidebarOpen;

    if (STATE.sidebarOpen) {
      sidebar.classList.remove('looqz-hidden');
      document.body.classList.add('looqz-sidebar-open');

      // Load from storage
      const stored = await getStorage(['apiKey', 'userPhotoBase64', 'creditsRemaining']);
      STATE.apiKey = stored.apiKey;
      STATE.userPhotoBase64 = stored.userPhotoBase64;
      if (stored.creditsRemaining) STATE.creditsRemaining = stored.creditsRemaining;

      if (STATE.apiKey) {
        document.getElementById('looqz-key-display').textContent =
          `Key: ${STATE.apiKey.substring(0, 12)}...`;

        switchScreen('screen-main');
        updateCreditsBadge();

        // Auto detect if product image not set
        if (!STATE.productImageUrl && window.looqzPicker) {
          const detected = window.looqzPicker.autoDetect();
          if (detected) {
            STATE.productImageUrl = detected;
          }
        }
        updateMainScreenState();

        // ─────────────────────────────────────────────────────────────────
        // Silently fetch realtime credits from Looqz server
        // ─────────────────────────────────────────────────────────────────
        chrome.runtime.sendMessage({
          action: "FETCH_LEDGER_CREDITS"
        }, async (res) => {
          if (!chrome.runtime.lastError && res && res.credits !== undefined) {
            STATE.creditsRemaining = res.credits;
            await setStorage({ creditsRemaining: STATE.creditsRemaining });
            updateCreditsBadge();
            updateMainScreenState();
          }
        });
        // ─────────────────────────────────────────────────────────────────

      } else {
        switchScreen('screen-apikey');
      }
    } else {
      sidebar.classList.add('looqz-hidden');
      document.body.classList.remove('looqz-sidebar-open');
      if (STATE.isPickerActive && window.looqzPicker) {
        window.looqzPicker.deactivate();
      }
    }
  }

  function switchScreen(screenName) {
    STATE.currentScreen = screenName;
    document.querySelectorAll('.looqz-screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`looqz-${screenName}`).classList.add('active');
    document.getElementById('looqz-settings-panel').classList.remove('active');
  }

  function updateCreditsBadge() {
    const badge = document.getElementById('looqz-credits-badge');
    if (!STATE.apiKey || STATE.creditsRemaining === null) {
      badge.style.display = 'none';
      return;
    }

    badge.style.display = 'inline-block';
    const c = parseInt(STATE.creditsRemaining);
    badge.textContent = `${c} 💳`;

    badge.className = 'looqz-credits-badge';
    if (c > 10) badge.classList.add('looqz-credits-green');
    else if (c > 5) badge.classList.add('looqz-credits-orange');
    else badge.classList.add('looqz-credits-red');

    if (c <= 5 && c > 0) badge.textContent = `⚠️ ${c} 💳`;
    if (c === 0) badge.textContent = `🚫 0 💳`;
  }

  function updateMainScreenState() {
    // User Photo
    const uploadArea = document.getElementById('looqz-user-upload-area');
    const savedArea = document.getElementById('looqz-user-saved-area');
    if (STATE.userPhotoBase64) {
      uploadArea.style.display = 'none';
      savedArea.style.display = 'block';
      document.getElementById('looqz-user-thumb').src = STATE.userPhotoBase64;
      document.getElementById('looqz-mini-user').src = STATE.userPhotoBase64;
      document.getElementById('looqz-loading-user').src = STATE.userPhotoBase64;
    } else {
      uploadArea.style.display = 'block';
      savedArea.style.display = 'none';
    }

    // Cloth Image
    const clothSelect = document.getElementById('looqz-cloth-select-area');
    const clothPrev = document.getElementById('looqz-cloth-preview-area');
    if (STATE.productImageUrl) {
      clothSelect.style.display = 'none';
      clothPrev.style.display = 'block';
      document.getElementById('looqz-cloth-thumb').src = STATE.productImageUrl;
      document.getElementById('looqz-mini-cloth').src = STATE.productImageUrl;
      document.getElementById('looqz-loading-cloth').src = STATE.productImageUrl;
    } else {
      clothSelect.style.display = 'block';
      clothPrev.style.display = 'none';
    }

    // Try On Button
    const btnTry = document.getElementById('looqz-btn-tryon');
    const miniRow = document.getElementById('looqz-mini-preview-row');
    const errorText = document.getElementById('looqz-tryon-error');

    if (STATE.userPhotoBase64 && STATE.productImageUrl) {
      miniRow.style.display = 'flex';

      // Check credits
      if (STATE.creditsRemaining === "0" || STATE.creditsRemaining === 0) {
        btnTry.disabled = true;
        errorText.style.display = 'block';
        errorText.innerHTML = `No credits left. <span class="looqz-text-link" id="looqz-try-buy-more">Buy More</span> or <span class="looqz-text-link" id="looqz-try-use-key">Change Key</span>`;

        document.getElementById('looqz-try-buy-more').onclick = () => window.open('https://www.looqz.in/credits');
        document.getElementById('looqz-try-use-key').onclick = () => switchScreen('screen-apikey');
      } else {
        btnTry.disabled = false;
        errorText.style.display = 'none';
      }
    } else {
      miniRow.style.display = 'none';
      btnTry.disabled = true;
      errorText.style.display = 'none';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BOUND EVENTS
  // ─────────────────────────────────────────────────────────────────────────────
  function bindEvents() {
    document.getElementById('looqz-close-btn').addEventListener('click', toggleSidebar);

    // Settings toggle
    document.getElementById('looqz-settings-toggle').addEventListener('click', () => {
      document.getElementById('looqz-settings-panel').classList.toggle('active');
    });

    // Screen: Default Settings Links
    document.getElementById('looqz-my-tryons').addEventListener('click', () => window.open('https://www.looqz.in/my-tryons'));
    document.getElementById('looqz-get-key').addEventListener('click', () => window.open('https://www.looqz.in/developer'));

    document.getElementById('looqz-change-key').addEventListener('click', () => {
      clearStorage(['apiKey']);
      STATE.apiKey = null;
      document.getElementById('looqz-settings-panel').classList.remove('active');
      updateCreditsBadge();
      switchScreen('screen-apikey');
    });

    document.getElementById('looqz-reset-ext').addEventListener('click', async () => {
      await new Promise(r => chrome.runtime.sendMessage({ action: "CLEAR_STORAGE" }, (res) => {
        if (chrome.runtime.lastError) return r(); // swallow if context died
        r(res);
      }));
      STATE.apiKey = null;
      STATE.userPhotoBase64 = null;
      STATE.productImageUrl = null;
      STATE.creditsRemaining = null;
      STATE.resultImageUrl = null;
      document.getElementById('looqz-settings-panel').classList.remove('active');
      updateCreditsBadge();
      updateMainScreenState();
      switchScreen('screen-apikey');
    });

    // Screen: API Key
    const keyInput = document.getElementById('looqz-apikey-input');
    const keyError = document.getElementById('looqz-apikey-error');
    const btnSaveKey = document.getElementById('looqz-btn-save-key');

    btnSaveKey.addEventListener('click', async () => {
      const val = keyInput.value.trim();
      if (!val.startsWith('sk_live_')) {
        keyError.textContent = "Keys look like: sk_live_ followed by your characters";
        keyError.style.display = 'block';
        return;
      }
      keyError.style.display = 'none';

      btnSaveKey.disabled = true;
      btnSaveKey.textContent = 'Validating...';

      try {
        // Test proxy generate with fake images via background
        chrome.runtime.sendMessage({
          action: "PROXY_FETCH",
          url: PROXY_URL,
          body: JSON.stringify({
            api_key: val,
            product_image_url: "https://via.placeholder.com/150",
            user_image_url: "https://via.placeholder.com/150"
          })
        }, async (res) => {
          if (chrome.runtime.lastError) {
            keyError.textContent = "Please reload the page. Extension was updated.";
            keyError.style.display = 'block';
            btnSaveKey.disabled = false;
            btnSaveKey.textContent = 'Save & Start';
            return;
          }
          if (res.error) {
            throw new Error(res.error);
          }

          if (res.status === 401) {
            keyError.textContent = "This key wasn't recognised. Check it and try again.";
            keyError.style.display = 'block';
            btnSaveKey.disabled = false;
            btnSaveKey.textContent = 'Save & Start';
            return;
          }

          const data = res.data || {};
          STATE.apiKey = val;

          // Attempt to fetch from ledger if logged in
          chrome.runtime.sendMessage({ action: "FETCH_LEDGER_CREDITS" }, async (ledgerRes) => {
            if (!chrome.runtime.lastError && ledgerRes && ledgerRes.credits !== undefined) {
               STATE.creditsRemaining = ledgerRes.credits;
            } else if (data.credits_remaining !== undefined) {
               STATE.creditsRemaining = data.credits_remaining;
            }
            
            await setStorage({ apiKey: val, creditsRemaining: STATE.creditsRemaining });

            btnSaveKey.disabled = false;
            btnSaveKey.textContent = 'Save & Start';
            keyInput.value = '';

            document.getElementById('looqz-key-display').textContent = `Key: ${val.substring(0, 12)}...`;
            updateCreditsBadge();
            updateMainScreenState();
            switchScreen('screen-main');
          });
        });

      } catch (err) {
        keyError.textContent = "Network error communicating with Looqz Servers.";
        keyError.style.display = 'block';
        btnSaveKey.disabled = false;
        btnSaveKey.textContent = 'Save & Start';
      }
    });

    // Screen: Main - Upload User Photo
    const uploader = document.getElementById('looqz-input-user-file');
    document.getElementById('looqz-btn-user-upload').addEventListener('click', () => uploader.click());
    document.getElementById('looqz-user-dropzone').addEventListener('click', () => uploader.click());

    // Drag and drop
    const dropzone = document.getElementById('looqz-user-dropzone');
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });

    uploader.addEventListener('change', e => {
      if (e.target.files && e.target.files.length > 0) handleFile(e.target.files[0]);
    });

    function handleFile(file) {
      if (!file.type.startsWith('image/')) return showToast('Please select an image file');
      const reader = new FileReader();
      reader.onload = (e) => {
        // Bake EXIF rotation by drawing to a canvas
        const img = new Image();
        img.onload = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, img.width, img.height);
          
          STATE.userPhotoBase64 = canvas.toDataURL('image/jpeg', 0.95);
          await setStorage({ userPhotoBase64: STATE.userPhotoBase64 });
          updateMainScreenState();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    document.getElementById('looqz-btn-user-change').addEventListener('click', () => uploader.click());

    // Screen: Main - Cloth Selection
    document.getElementById('looqz-btn-pick-web').addEventListener('click', () => {
      if (window.looqzPicker) window.looqzPicker.activate();
    });

    document.getElementById('looqz-btn-cloth-change').addEventListener('click', () => {
      STATE.productImageUrl = null;
      updateMainScreenState();
    });

    // Form Submit
    document.getElementById('looqz-btn-tryon').addEventListener('click', fireTryOn);

    // Screen: Loading
    document.getElementById('looqz-btn-cancel').addEventListener('click', () => {
      if (STATE.abortController) {
        STATE.abortController.abort();
      }
      switchScreen('screen-main');
    });

    // Screen: Result
    document.getElementById('looqz-btn-download').addEventListener('click', async () => {
      if (!STATE.resultImageUrl) return;
      try {
        const blob = await fetch(STATE.resultImageUrl).then(r => r.blob());
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'looqz-tryon.jpg';
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        showToast('Error downloading image');
      }
    });

    document.getElementById('looqz-btn-share').addEventListener('click', async () => {
      if (!STATE.resultImageUrl) return;
      try {
        await navigator.clipboard.writeText(STATE.resultImageUrl);
        showToast('Link copied to clipboard! 📋');
      } catch (e) {
        showToast('Failed to copy');
      }
    });

    document.getElementById('looqz-btn-another').addEventListener('click', () => {
      STATE.productImageUrl = null;
      STATE.resultImageUrl = null;

      // Auto-detect a new image if possible
      if (window.looqzPicker) {
        const detected = window.looqzPicker.autoDetect();
        if (detected) STATE.productImageUrl = detected;
      }

      updateMainScreenState();
      switchScreen('screen-main');
    });

    document.getElementById('looqz-link-banner-buy').addEventListener('click', () => window.open('https://www.looqz.in/credits'));

  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TRY ON CALL
  // ─────────────────────────────────────────────────────────────────────────────
  async function fireTryOn() {
    switchScreen('screen-loading');
    STATE.abortController = new AbortController();

    // Progress bar visual hack
    const pbar = document.getElementById('looqz-progress-bar');
    pbar.style.transition = 'none';
    pbar.style.width = '0%';
    setTimeout(() => { pbar.style.transition = 'width 4s linear'; pbar.style.width = '90%'; }, 50);

    // Rotate text
    const loadingTexts = ["Creating your look...", "Analyzing the fit...", "Almost ready...", "Finishing up..."];
    let tIdx = 0;
    const lTextEl = document.getElementById('looqz-loading-text');
    lTextEl.textContent = loadingTexts[0];
    const tInterval = setInterval(() => {
      tIdx = (tIdx + 1) % loadingTexts.length;
      lTextEl.textContent = loadingTexts[tIdx];
    }, 1500);

    try {

      // Helper: upload any image URL or base64 to tmpfiles via background service worker
      async function handleImageUpload(imageSource, label) {
        lTextEl.textContent = `Uploading ${label}...`;
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: "CATBOX_UPLOAD",
            base64Data: imageSource
          }, res => {
            if (chrome.runtime.lastError) reject(new Error("Extension context invalidated. Refresh the page."));
            else if (res.error) reject(new Error(res.error));
            else resolve(res.url.trim());
          });
        });
      }

      // Upload user photo (it's a base64 data-URI)
      let finalUserImageUrl = STATE.userPhotoBase64;
      if (finalUserImageUrl.startsWith('data:image')) {
        try {
          finalUserImageUrl = await handleImageUpload(finalUserImageUrl, 'your photo');
        } catch (err) {
          throw new Error("Failed to upload your photo. Please try again.");
        }
      }

      // ALSO upload the product/cloth image.
      // Amazon CDN URLs (m.media-amazon.com) require cookies and are blocked 
      // by Looqz's server-side image fetcher — uploading them makes them public.
      let finalProductImageUrl = STATE.productImageUrl;
      try {
        lTextEl.textContent = "Uploading cloth image...";
        // Fetch the cloth image via background (avoids CORS) then upload
        finalProductImageUrl = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: "FETCH_AND_UPLOAD",
            url: STATE.productImageUrl
          }, res => {
            if (chrome.runtime.lastError) reject(new Error("Extension context invalidated. Refresh the page."));
            else if (res.error) reject(new Error(res.error));
            else resolve(res.url.trim());
          });
        });
      } catch (err) {
        // If fetch+upload fails, try using the URL directly as a fallback
        console.warn("Looqz: cloth upload failed, using direct URL:", err.message);
        finalProductImageUrl = STATE.productImageUrl;
      }

      // Background fetch helper
      const doProxyFetch = () => {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: "PROXY_FETCH",
            url: PROXY_URL,
            body: JSON.stringify({
              api_key: STATE.apiKey,
              product_image_url: finalProductImageUrl,
              user_image_url: finalUserImageUrl
            })
          }, (res) => {
            if (chrome.runtime.lastError) reject(new Error("Extension context invalidated. Please refresh the page."));
            else if (res.error) reject(new Error(res.error));
            else resolve(res);
          });
        });
      };

      // Race the fetch against the abort signal
      const fetchProm = doProxyFetch();
      const abortProm = new Promise((_, reject) => {
        STATE.abortController.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });

      const res = await Promise.race([fetchProm, abortProm]);
      const data = res.data || {};

      // Handle error statuses
      if (!res.ok) {
        clearInterval(tInterval);
        switchScreen('screen-main');
        const errEl = document.getElementById('looqz-tryon-error');
        errEl.style.display = 'block';

        if (res.status === 402) {
          errEl.innerHTML = `Credits exhausted. <span class="looqz-text-link" onclick="window.open('https://www.looqz.in/credits')">Buy more</span>`;
        } else if (res.status === 429) {
          errEl.textContent = "Too many requests. Wait 60 seconds and try again.";
        } else if (res.status === 504) {
          errEl.textContent = "Image generation timed out. Try again.";
        } else if (res.status === 422) {
          let msg = "Image format not supported.";
          if (data.details) {
            msg = Object.values(data.details).join(" ");
          }
          errEl.textContent = msg;
        } else {
          errEl.textContent = data.message || "An error occurred with generation.";
        }
        return;
      }

      // Success
      STATE.resultImageUrl = data.image_url || data.result_image_url || (data.images && data.images[0]);

      if (data.credits_remaining !== undefined) {
        STATE.creditsRemaining = data.credits_remaining;
        await setStorage({ creditsRemaining: STATE.creditsRemaining });
        updateCreditsBadge();
      }

      clearInterval(tInterval);
      pbar.style.transition = 'width 0.2s linear';
      pbar.style.width = '100%';

      // ─────────────────────────────────────────────────────────────────
      // FIX Looqz AI Horizontal Output Bug
      // If the API erroneously returned a sideways image (horizontal) while 
      // the user upload was vertical, explicitly force it upright!
      // ─────────────────────────────────────────────────────────────────
      const forceUpright = () => {
        return new Promise((resolve) => {
          const rImg = new Image();
          rImg.crossOrigin = "Anonymous";
          rImg.onload = () => {
            const uImg = new Image();
            uImg.onload = () => {
               // Is user vertical? Is result horizontal?
               if (uImg.width < uImg.height && rImg.width > rImg.height) {
                  const cvs = document.createElement('canvas');
                  cvs.width = rImg.height;
                  cvs.height = rImg.width;
                  const ctx = cvs.getContext('2d');
                  ctx.translate(cvs.width / 2, cvs.height / 2);
                  ctx.rotate(90 * Math.PI / 180);
                  ctx.drawImage(rImg, -rImg.width / 2, -rImg.height / 2);
                  resolve(cvs.toDataURL('image/jpeg', 0.95));
               } else {
                  resolve(STATE.resultImageUrl);
               }
            };
            uImg.onerror = () => resolve(STATE.resultImageUrl);
            uImg.src = STATE.userPhotoBase64;
          };
          rImg.onerror = () => resolve(STATE.resultImageUrl);
          rImg.src = STATE.resultImageUrl;
        });
      };

      STATE.resultImageUrl = await forceUpright();

      // Load into result UI
      document.getElementById('looqz-result-before').src = STATE.userPhotoBase64;
      document.getElementById('looqz-result-after').src = STATE.resultImageUrl;
      document.getElementById('looqz-comparison-before').style.width = '100%';
      document.getElementById('looqz-comparison-before').style.clipPath = 'polygon(0 0, 50% 0, 50% 100%, 0 100%)';
      document.getElementById('looqz-slider-handle').style.left = '50%';

      // Zero credits banner logic
      const zBanner = document.getElementById('looqz-zero-credits-banner');
      if (STATE.creditsRemaining === "0" || STATE.creditsRemaining === 0) {
        zBanner.style.display = 'block';
      } else {
        zBanner.style.display = 'none';
      }

      // Small delay for 100% progress hit
      setTimeout(() => {
        switchScreen('screen-result');
      }, 400);

    } catch (err) {
      if (err.name === 'AbortError') return; // User cancelled

      clearInterval(tInterval);
      switchScreen('screen-main');
      const errEl = document.getElementById('looqz-tryon-error');
      errEl.style.display = 'block';

      // Check if the error is exactly "Network error" vs specific error text
      errEl.textContent = err.message || "Network error. Please check your connection.";
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BEFORE/AFTER SLIDER LOGIC
  // ─────────────────────────────────────────────────────────────────────────────
  function setupSlider() {
    const container = document.getElementById('looqz-comparison');
    const beforeDiv = document.getElementById('looqz-comparison-before');
    const handle = document.getElementById('looqz-slider-handle');
    let isDragging = false;

    const updateSlider = (x) => {
      const rect = container.getBoundingClientRect();
      let pos = Math.max(0, Math.min(x - rect.left, rect.width));
      let pct = (pos / rect.width) * 100;
      beforeDiv.style.clipPath = `polygon(0 0, ${pct}% 0, ${pct}% 100%, 0 100%)`;
      handle.style.left = `${pct}%`;
    };

    container.addEventListener('mousedown', (e) => { isDragging = true; updateSlider(e.clientX); });
    window.addEventListener('mouseup', () => { isDragging = false; });
    window.addEventListener('mousemove', (e) => { if (isDragging) updateSlider(e.clientX); });

    // Touch support
    container.addEventListener('touchstart', (e) => { isDragging = true; updateSlider(e.touches[0].clientX); });
    window.addEventListener('touchend', () => { isDragging = false; });
    window.addEventListener('touchmove', (e) => {
      if (isDragging) {
        e.preventDefault();
        updateSlider(e.touches[0].clientX);
      }
    }, { passive: false });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PROMISIFIED STORAGE API
  // ─────────────────────────────────────────────────────────────────────────────
  function getStorage(keys) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: "GET_STORAGE", keys }, res => {
        resolve((res && res.data) || {});
      });
    });
  }

  function setStorage(data) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: "SET_STORAGE", data }, res => resolve(res));
    });
  }

  function clearStorage(keys) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: "GET_STORAGE", keys: null }, res => {
        const current = res.data || {};
        keys.forEach(k => delete current[k]);
        chrome.runtime.sendMessage({ action: "CLEAR_STORAGE" }, () => {
          chrome.runtime.sendMessage({ action: "SET_STORAGE", data: current }, () => resolve());
        });
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // UTILS
  // ─────────────────────────────────────────────────────────────────────────────
  function showToast(msg) {
    let toast = document.getElementById('looqz-toast');
    if (toast) toast.remove();
    toast = document.createElement('div');
    toast.id = 'looqz-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // Kickoff
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

})();
