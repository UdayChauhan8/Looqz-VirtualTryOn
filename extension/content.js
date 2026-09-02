// content.js - Looqz Virtual Try-On
// Wrapping in IIFE to avoid polluting global scope
(function () {

  const PROXY_URL = "https://looqz-backend-q05q.onrender.com";
  // Upload proxy used to turn page/image blobs into stable URLs before try-on.

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

  // ── Re-injection safety ─────────────────────────────────────────────────────
  // These are module-level (not per-call) so they survive multiple init() runs.
  //
  // _globalListenersRegistered: guards chrome.runtime.onMessage and the custom
  //   'looqz-image-selected' event so they are NEVER registered more than once,
  //   even when init() is called again after a SPA body-wipe.
  //
  // _sliderHandlers: holds references to the four window-level slider handlers
  //   so setupSlider() can removeEventListener on them before re-adding.
  //   Without this, each re-injection piles up orphaned mousemove/touchmove
  //   handlers on window.
  let _globalListenersRegistered = false;
  let _sliderHandlers = { mouseUp: null, mouseMove: null, touchEnd: null, touchMove: null };

  // ─────────────────────────────────────────────────────────────────────────────
  // ICONS
  // ─────────────────────────────────────────────────────────────────────────────
  // One 24×24 line-icon set, stroked with currentColor and sized by CSS
  // (.looqz-icon). Inline SVG rather than image files, so nothing extra has to
  // be declared in web_accessible_resources; and rather than emoji, so every
  // glyph renders at a consistent weight instead of inheriting whatever emoji
  // font the host OS happens to ship.
  const svg = (body, cls = '') =>
    `<svg class="looqz-icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

  const ICON = {
    settings: svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
    close: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    key: svg('<path d="M15.5 7.5 21 2M18.5 4.5l3 3-3.5 3.5-3-3"/><path d="M11.4 11.6a5.5 5.5 0 1 0-7.8 7.8 5.5 5.5 0 0 0 7.8-7.8Z"/>'),
    shirt: svg('<path d="M20.4 3.5 16 2a4 4 0 0 1-8 0L3.6 3.5a2 2 0 0 0-1.3 2.2l.6 3.5a1 1 0 0 0 1 .8H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.1a1 1 0 0 0 1-.8l.6-3.5a2 2 0 0 0-1.3-2.2Z"/>'),
    power: svg('<path d="M18.4 6.6a9 9 0 1 1-12.8 0"/><line x1="12" y1="2" x2="12" y2="12"/>'),
    chevron: svg('<polyline points="9 18 15 12 9 6"/>', 'looqz-row-chevron'),
    copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    check: svg('<polyline points="20 6 9 17 4 12"/>'),
    eye: svg('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: svg('<path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2m-6.7-1.1a3 3 0 1 1-4.2-4.2"/><line x1="1" y1="1" x2="23" y2="23"/>'),
    lock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
    upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', 'looqz-icon-lg'),
    pointer: svg('<path d="M3 3l7.1 17 2.5-7.4L20 10.1 3 3Z"/>', 'looqz-icon-lg'),
    swap: svg('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
    sparkle: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 16l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6Z"/>'),
    refresh: svg('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>'),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
    link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    arrowRight: svg('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>'),
    compare: svg('<polyline points="11 17 6 12 11 7"/><polyline points="13 7 18 12 13 17"/>'),
    alert: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    coin: svg('<circle cx="12" cy="12" r="9"/><path d="M15 9.4a3.6 3.6 0 1 0 0 5.2"/>'),
    coffee: svg('<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8Z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>'),
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // HTML TEMPLATE
  // ─────────────────────────────────────────────────────────────────────────────
  const SIDEBAR_HTML = `
<div id="looqz-sidebar" class="looqz-hidden">

  <div id="looqz-header">
    <div id="looqz-logo">
      <img src="${chrome.runtime.getURL('icons/looqzicon.png')}" alt="" class="looqz-logo-img">
      <span>Looqz</span>
    </div>
    <div id="looqz-header-right">
      <span id="looqz-credits-badge" class="looqz-credits-badge"></span>
      <button type="button" id="looqz-settings-toggle" class="looqz-icon-btn" title="Settings" aria-label="Settings">${ICON.settings}</button>
      <button type="button" id="looqz-close-btn" class="looqz-icon-btn" title="Close" aria-label="Close">${ICON.close}</button>
    </div>
  </div>

  <div id="looqz-settings-panel" class="looqz-settings-panel">
    <div class="looqz-settings-key">
      ${ICON.key}
      <span id="looqz-key-display">Key: …</span>
      <button type="button" class="looqz-chip-btn" id="looqz-change-key">Change</button>
    </div>
    <button type="button" class="looqz-row" id="looqz-my-tryons">
      ${ICON.shirt}
      <span class="looqz-row-label">My try-ons on looqz.in</span>
      ${ICON.chevron}
    </button>
    <div class="looqz-divider"></div>
    <button type="button" class="looqz-row looqz-row-danger" id="looqz-reset-ext">
      ${ICON.power}
      <span class="looqz-row-label">Reset extension</span>
    </button>
  </div>

  <!-- ─── SCREEN 1: API KEY ─────────────────────────────────────────────── -->
  <div id="looqz-screen-apikey" class="looqz-screen">
    <div class="looqz-eyebrow">Getting started</div>
    <h3 class="looqz-title looqz-mt-md">Connect your Looqz key</h3>
    <p class="looqz-subtitle">Paste an API key to try clothes on your own photo, on any shopping site.</p>

    <div class="looqz-setup-box">
      <div class="looqz-eyebrow looqz-setup-title">Setup</div>
      <ul class="looqz-setup-list">
        <li><span>Open <b>looqz.in</b> → <b>Developer</b> → <b>API Keys</b></span></li>
        <li><span>Create a key and choose the <b>Custom</b> domain option</span></li>
        <li>
          <span>
            Set <b>Allowed Domain</b> to this extension's ID
            <span class="looqz-code-row">
              <code class="looqz-setup-code" id="looqz-ext-id">${chrome.runtime.id}</code>
              <button type="button" class="looqz-copy-btn" id="looqz-copy-ext-id" title="Copy extension ID" aria-label="Copy extension ID">${ICON.copy}</button>
            </span>
          </span>
        </li>
        <li><span>Copy the key and paste it below</span></li>
      </ul>
    </div>

    <div class="looqz-field looqz-mt-md">
      <input id="looqz-apikey-input"
             class="looqz-input looqz-input-masked"
             type="text"
             placeholder="sk_live_…"
             name="looqz_extension_token"
             autocomplete="off"
             spellcheck="false"
             autocapitalize="off"
             autocorrect="off"
             data-form-type="other"
             data-lpignore="true"
             data-1p-ignore
             data-bwignore
             aria-label="Looqz API key">
      <button type="button" id="looqz-apikey-reveal" class="looqz-field-action" title="Show key" aria-label="Show key">${ICON.eye}</button>
    </div>
    <div id="looqz-apikey-error" class="looqz-error-text"></div>

    <button type="button" id="looqz-btn-save-key" class="looqz-btn-primary looqz-mt-md">Connect</button>

    <div class="looqz-footnote">
      <span>No key yet?</span>
      <span class="looqz-text-link" id="looqz-get-key">Get one free →</span>
    </div>

    <div class="looqz-spacer"></div>
    <div class="looqz-footnote">${ICON.lock}<span>Stored only on this device</span></div>
  </div>

  <!-- ─── SCREEN 2: MAIN ───────────────────────────────────────────────── -->
  <div id="looqz-screen-main" class="looqz-screen">

    <div class="looqz-slots">

      <div class="looqz-slot" id="looqz-slot-user">
        <div class="looqz-slot-label"><span class="looqz-dot"></span>You</div>

        <div id="looqz-user-upload-area" class="looqz-slot-state" style="display:block">
          <div class="looqz-dropzone" id="looqz-user-dropzone" role="button" tabindex="0">
            ${ICON.upload}
            <div class="looqz-dropzone-label">Upload photo</div>
            <div class="looqz-dropzone-hint">or drop it here</div>
          </div>
          <div class="looqz-upload-buttons">
            <button type="button" id="looqz-btn-user-upload" class="looqz-btn-secondary">Upload</button>
          </div>
          <input type="file" id="looqz-input-user-file" accept="image/*" style="display:none">
        </div>

        <div id="looqz-user-saved-area" class="looqz-slot-state" style="display:none">
          <div class="looqz-image-preview-card">
            <img id="looqz-user-thumb" class="looqz-image-preview-thumb" src="" alt="">
            <div class="looqz-image-preview-info">
              <span class="looqz-image-preview-name">Photo</span>
              <button type="button" class="looqz-text-link" id="looqz-btn-user-change">${ICON.swap}Change</button>
            </div>
          </div>
        </div>
      </div>

      <div class="looqz-slot" id="looqz-slot-cloth">
        <div class="looqz-slot-label"><span class="looqz-dot"></span>Garment</div>

        <div id="looqz-cloth-select-area" class="looqz-slot-state" style="display:block">
          <button type="button" class="looqz-dropzone" id="looqz-btn-pick-web">
            ${ICON.pointer}
            <div class="looqz-dropzone-label">Pick garment</div>
            <div class="looqz-dropzone-hint">click any image on the page</div>
          </button>
        </div>

        <div id="looqz-cloth-preview-area" class="looqz-slot-state" style="display:none">
          <div class="looqz-image-preview-card">
            <img id="looqz-cloth-thumb" class="looqz-image-preview-thumb" src="" alt="">
            <div class="looqz-image-preview-info">
              <span class="looqz-image-preview-name">Picked</span>
              <button type="button" class="looqz-text-link" id="looqz-btn-cloth-change">${ICON.swap}Change</button>
            </div>
          </div>
        </div>
      </div>

    </div>

    <div class="looqz-mt-lg">
      <button type="button" id="looqz-btn-tryon" class="looqz-btn-primary" disabled>${ICON.sparkle}Try it on</button>
      <div id="looqz-tryon-error" class="looqz-error-text"></div>
    </div>

    <div class="looqz-spacer"></div>

    <div class="looqz-support">
      <a class="looqz-support-btn" href="https://paypal.me/UdayChauhan8" target="_blank" rel="noopener noreferrer">
        ${ICON.coffee}Buy me a coffee
      </a>
      <span class="looqz-hint">Supports Looqz development</span>
    </div>

  </div>

  <!-- ─── SCREEN 3: LOADING ────────────────────────────────────────────── -->
  <div id="looqz-screen-loading" class="looqz-screen">
    <div class="looqz-mini-preview-row">
      <div class="looqz-mini-preview-item">
        <img id="looqz-loading-user" class="looqz-mini-preview-thumb" alt="">
        <span>You</span>
      </div>
      <div class="looqz-mini-preview-arrow">${ICON.arrowRight}</div>
      <div class="looqz-mini-preview-item">
        <img id="looqz-loading-cloth" class="looqz-mini-preview-thumb" alt="">
        <span>Garment</span>
      </div>
    </div>

    <div class="looqz-loading-card">
      <div class="looqz-loading-visual">${ICON.shirt}</div>
      <div id="looqz-loading-text">Creating your look…</div>
      <div class="looqz-loading-sub" id="looqz-loading-sub">This usually takes 20–40 seconds</div>
      <div class="looqz-progress-container">
        <div class="looqz-progress-bar" id="looqz-progress-bar"></div>
      </div>
    </div>

    <div class="looqz-spacer"></div>
    <button type="button" id="looqz-btn-cancel" class="looqz-btn-secondary">Cancel</button>
  </div>

  <!-- ─── SCREEN 4: RESULT ─────────────────────────────────────────────── -->
  <div id="looqz-screen-result" class="looqz-screen">
    <div class="looqz-eyebrow">Result</div>
    <h3 class="looqz-title looqz-mt-md">Here's your look</h3>
    <p class="looqz-subtitle">Drag the handle to compare with your original photo.</p>

    <div class="looqz-comparison" id="looqz-comparison">
      <div class="looqz-comparison-after">
        <img id="looqz-result-after" src="" alt="Try-on result">
      </div>
      <div class="looqz-comparison-before" id="looqz-comparison-before">
        <img id="looqz-result-before" src="" alt="Your original photo">
      </div>
      <span class="looqz-compare-tag looqz-compare-tag-before">Before</span>
      <span class="looqz-compare-tag looqz-compare-tag-after">After</span>
      <div class="looqz-slider-handle" id="looqz-slider-handle">
        <div class="looqz-slider-btn">${ICON.compare}</div>
      </div>
    </div>

    <div id="looqz-zero-credits-banner" class="looqz-zero-credits-banner">
      ${ICON.alert}
      <span>That was your last credit this month.
        <span class="looqz-text-link" id="looqz-link-banner-buy">Buy more</span>
      </span>
    </div>

    <div class="looqz-btn-row looqz-mt-md">
      <button type="button" id="looqz-btn-download" class="looqz-btn-secondary">${ICON.download}Download</button>
      <button type="button" id="looqz-btn-share" class="looqz-btn-secondary">${ICON.link}Copy link</button>
    </div>

    <div class="looqz-spacer"></div>
    <button type="button" id="looqz-btn-another" class="looqz-btn-primary">${ICON.refresh}Try another garment</button>
  </div>

</div>
`;

  // ─────────────────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────────────────────────
  function init() {
    // Guard: body must exist before we can inject the sidebar
    if (!document.body) return;

    // Already injected — nothing to do
    if (document.getElementById('looqz-sidebar')) return;

    const div = document.createElement('div');
    div.innerHTML = SIDEBAR_HTML;
    document.body.appendChild(div.firstElementChild);

    bindEvents();
    setupSlider();
  }

  // Registers the two truly global listeners (chrome messaging + picker event).
  // Called once from the kickoff block — never from init() — so re-injection
  // can never cause duplicate handler registrations.
  function registerGlobalListeners() {
    if (_globalListenersRegistered) return;
    _globalListenersRegistered = true;

    // Background → content: handle incoming messages
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.action === 'TOGGLE_SIDEBAR') {
        toggleSidebar();
      }
      // PING: background.js uses this to confirm the content script is alive.
      // Sync response — resolves the sendMessage Promise on the background side.
      if (msg.action === 'PING') {
        sendResponse({ alive: true });
      }
    });

    // picker.js → content: image was selected
    document.addEventListener('looqz-image-selected', (e) => {
      STATE.productImageUrl = e.detail.url;
      updateMainScreenState();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STATE & SCREEN MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────
  async function toggleSidebar() {
    // Defensive re-init: SPAs (React/Next.js) can wipe and re-render the entire
    // document body, destroying the injected sidebar. Calling init() here is
    // safe — it short-circuits immediately if the sidebar already exists.
    if (!document.getElementById('looqz-sidebar')) {
      init();
    }

    const sidebar = document.getElementById('looqz-sidebar');

    // If init() still couldn't inject (e.g. body not ready), bail silently.
    if (!sidebar) return;

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
    document.getElementById('looqz-settings-toggle').classList.remove('is-active');

    // The key field must always open EMPTY.
    //
    // This sidebar lives in the host page's DOM, so Chrome's password manager
    // (and 1Password/LastPass/Bitwarden) treat any key-ish field in it as a
    // login field for *that site's* origin and silently inject a saved
    // credential — which is where the mystery pre-filled value came from. The
    // field is now type="text" masked in CSS so it is never classified as a
    // password at all, and we blank it on entry as a second line of defence.
    if (screenName === 'screen-apikey') {
      resetKeyField();
    }
  }

  // Blank + re-mask the API key field and reset its reveal toggle.
  function resetKeyField() {
    const keyInput = document.getElementById('looqz-apikey-input');
    if (keyInput) {
      keyInput.value = '';
      keyInput.classList.remove('is-revealed');
    }
    const reveal = document.getElementById('looqz-apikey-reveal');
    if (reveal) {
      reveal.innerHTML = ICON.eye;
      reveal.title = 'Show key';
      reveal.setAttribute('aria-label', 'Show key');
    }
    const keyError = document.getElementById('looqz-apikey-error');
    if (keyError) keyError.style.display = 'none';
  }

  function updateCreditsBadge() {
    const badge = document.getElementById('looqz-credits-badge');
    if (!STATE.apiKey || STATE.creditsRemaining === null) {
      badge.style.display = 'none';
      return;
    }

    badge.style.display = 'inline-flex';
    const c = parseInt(STATE.creditsRemaining);

    // Colour alone carries the warning — an alert glyph on a red pill is
    // redundant, and stacking emoji next to a number reads as noise.
    badge.className = 'looqz-credits-badge';
    if (c > 10) badge.classList.add('looqz-credits-green');
    else if (c > 5) badge.classList.add('looqz-credits-orange');
    else badge.classList.add('looqz-credits-red');

    badge.innerHTML = `${ICON.coin}<span>${c}</span>`;
    badge.title = c === 0
      ? 'No credits left this month'
      : `${c} credit${c === 1 ? '' : 's'} remaining`;
  }

  function updateMainScreenState() {
    // ── Slot 1: the user's photo ────────────────────────────────────────────
    const uploadArea = document.getElementById('looqz-user-upload-area');
    const savedArea = document.getElementById('looqz-user-saved-area');
    const userSlot = document.getElementById('looqz-slot-user');
    if (STATE.userPhotoBase64) {
      uploadArea.style.display = 'none';
      savedArea.style.display = 'block';
      userSlot.classList.add('is-filled');
      document.getElementById('looqz-user-thumb').src = STATE.userPhotoBase64;
      document.getElementById('looqz-loading-user').src = STATE.userPhotoBase64;
    } else {
      uploadArea.style.display = 'block';
      savedArea.style.display = 'none';
      userSlot.classList.remove('is-filled');
    }

    // ── Slot 2: the garment ─────────────────────────────────────────────────
    const clothSelect = document.getElementById('looqz-cloth-select-area');
    const clothPrev = document.getElementById('looqz-cloth-preview-area');
    const clothSlot = document.getElementById('looqz-slot-cloth');
    if (STATE.productImageUrl) {
      clothSelect.style.display = 'none';
      clothPrev.style.display = 'block';
      clothSlot.classList.add('is-filled');
      document.getElementById('looqz-cloth-thumb').src = STATE.productImageUrl;
      document.getElementById('looqz-loading-cloth').src = STATE.productImageUrl;
    } else {
      clothSelect.style.display = 'block';
      clothPrev.style.display = 'none';
      clothSlot.classList.remove('is-filled');
    }

    // ── The CTA is the only "both ready" signal we need; the two filled tiles
    //    above already show what will be generated.
    const btnTry = document.getElementById('looqz-btn-tryon');
    const errorText = document.getElementById('looqz-tryon-error');

    if (STATE.userPhotoBase64 && STATE.productImageUrl) {
      // Check credits
      if (STATE.creditsRemaining === "0" || STATE.creditsRemaining === 0) {
        btnTry.disabled = true;
        errorText.style.display = 'block';
        errorText.innerHTML = `No credits left. <span class="looqz-text-link" id="looqz-try-buy-more">Buy more</span> or <span class="looqz-text-link" id="looqz-try-use-key">change key</span>.`;

        document.getElementById('looqz-try-buy-more').onclick = () => window.open('https://www.looqz.in/credits');
        document.getElementById('looqz-try-use-key').onclick = () => switchScreen('screen-apikey');
      } else {
        btnTry.disabled = false;
        errorText.style.display = 'none';
      }
    } else {
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
    document.getElementById('looqz-settings-toggle').addEventListener('click', (e) => {
      const open = document.getElementById('looqz-settings-panel').classList.toggle('active');
      e.currentTarget.classList.toggle('is-active', open);
    });

    // Screen: Default Settings Links
    document.getElementById('looqz-my-tryons').addEventListener('click', () => window.open('https://www.looqz.in/my-tryons'));
    document.getElementById('looqz-get-key').addEventListener('click', () => window.open('https://www.looqz.in/developer/api-keys'));

    document.getElementById('looqz-change-key').addEventListener('click', () => {
      clearStorage(['apiKey']);
      STATE.apiKey = null;
      document.getElementById('looqz-settings-panel').classList.remove('active');
      updateCreditsBadge();
      switchScreen('screen-apikey');
    });

    document.getElementById('looqz-reset-ext').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: "CLEAR_STORAGE" });
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
    const keyReveal = document.getElementById('looqz-apikey-reveal');

    // Reveal / hide. The field is type="text" with CSS masking, so toggling is
    // a class flip rather than a type swap — which also means Chrome never
    // reclassifies it as a password field mid-interaction.
    keyReveal.addEventListener('click', () => {
      const shown = keyInput.classList.toggle('is-revealed');
      keyReveal.innerHTML = shown ? ICON.eyeOff : ICON.eye;
      keyReveal.title = shown ? 'Hide key' : 'Show key';
      keyReveal.setAttribute('aria-label', keyReveal.title);
      keyInput.focus();
    });

    // Enter submits — the field is the only input on this screen.
    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnSaveKey.click();
      }
    });

    // Copy the extension ID, which has to be pasted verbatim into the Looqz
    // dashboard. Reading a 32-character random string off screen is the single
    // most error-prone step in setup.
    const copyBtn = document.getElementById('looqz-copy-ext-id');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(chrome.runtime.id);
        copyBtn.innerHTML = ICON.check;
        copyBtn.classList.add('is-copied');
        showToast('Extension ID copied');
        setTimeout(() => {
          copyBtn.innerHTML = ICON.copy;
          copyBtn.classList.remove('is-copied');
        }, 1600);
      } catch (e) {
        showToast('Could not copy — select the ID manually');
      }
    });

    btnSaveKey.addEventListener('click', async () => {
      const val = keyInput.value.trim();
      if (!val.startsWith('sk_live_')) {
        keyError.textContent = "Keys look like: sk_live_ followed by your characters";
        keyError.style.display = 'block';
        return;
      }
      keyError.style.display = 'none';

      btnSaveKey.disabled = true;
      btnSaveKey.textContent = 'Checking…';

      try {
        // Validate the key by calling the Looqz API directly from background.js.
        // The service worker has the user's residential IP — Cloudflare allows it.
        chrome.runtime.sendMessage({
          action: 'VALIDATE_KEY',
          apiKey: val
        }, async (res) => {
          if (chrome.runtime.lastError) {
            keyError.textContent = "Please reload the page. Extension was updated.";
            keyError.style.display = 'block';
            btnSaveKey.disabled = false;
            btnSaveKey.textContent = 'Connect';
            return;
          }
          if (res.error) {
            keyError.textContent = "Network error communicating with Looqz Servers.";
            keyError.style.display = 'block';
            btnSaveKey.disabled = false;
            btnSaveKey.textContent = 'Connect';
            return;
          }

          if (res.status === 401) {
            keyError.textContent = "This key wasn't recognised. Check it and try again.";
            keyError.style.display = 'block';
            btnSaveKey.disabled = false;
            btnSaveKey.textContent = 'Connect';
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
            btnSaveKey.textContent = 'Connect';
            resetKeyField();

            document.getElementById('looqz-key-display').textContent = `Key: ${val.substring(0, 12)}…`;
            updateCreditsBadge();
            updateMainScreenState();
            switchScreen('screen-main');
          });
        });

      } catch (err) {
        keyError.textContent = "Network error communicating with Looqz Servers.";
        keyError.style.display = 'block';
        btnSaveKey.disabled = false;
        btnSaveKey.textContent = 'Connect';
      }
    });

    // Screen: Main - Upload User Photo
    const uploader = document.getElementById('looqz-input-user-file');
    document.getElementById('looqz-btn-user-upload').addEventListener('click', () => uploader.click());
    document.getElementById('looqz-user-dropzone').addEventListener('click', () => uploader.click());
    document.getElementById('looqz-user-dropzone').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); uploader.click(); }
    });

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
        const img = new Image();
        img.onload = async () => {
          // ── Aggressive downscale ────────────────────────────────────────
          // Keep the image compact so the request stays fast and reliable.
          // Downscale to max 1024px on longest edge + JPEG 82% quality
          // → ~150 KB payload. 98% memory reduction on the backend.
          const MAX_EDGE = 1024;
          let w = img.width;
          let h = img.height;

          if (w > MAX_EDGE || h > MAX_EDGE) {
            const ratio = Math.min(MAX_EDGE / w, MAX_EDGE / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          // Drawing to canvas also bakes EXIF rotation — no separate step needed
          ctx.drawImage(img, 0, 0, w, h);

          STATE.userPhotoBase64 = canvas.toDataURL('image/jpeg', 0.82);
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
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'DOWNLOAD_RESULT_IMAGE',
            url: STATE.resultImageUrl,
            filename: 'looqz-tryon.jpg',
          }, resolve);
        });

        if (!res || res.ok !== true) {
          throw new Error(res?.error || 'Download failed');
        }
      } catch (e) {
        console.warn('Download failed', e);
        showToast('Error downloading image');
      }
    });

    document.getElementById('looqz-btn-share').addEventListener('click', async () => {
      if (!STATE.resultImageUrl) return;
      try {
        await navigator.clipboard.writeText(STATE.resultImageUrl);
        showToast('Link copied to clipboard');
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

    // ── Progress + elapsed time ───────────────────────────────────────────────
    // The bar is an estimate, not a real measurement — the server exposes no
    // progress events. It creeps to 90% over 30s (roughly a realistic run: the
    // Vertex try-on call alone is ~10-20s, on top of the upload proxy, two URL
    // validations and the Python subprocess), and a CSS sheen keeps it looking
    // alive once it parks there. The elapsed counter below is the honest signal.
    const pbar = document.getElementById('looqz-progress-bar');
    pbar.style.transition = 'none';
    pbar.style.width = '0%';
    setTimeout(() => {
      pbar.style.transition = 'width 30s cubic-bezier(0.1, 0.7, 0.3, 1)';
      pbar.style.width = '90%';
    }, 50);

    const startedAt = Date.now();
    const subEl = document.getElementById('looqz-loading-sub');
    const elapsedInterval = setInterval(() => {
      const s = Math.round((Date.now() - startedAt) / 1000);
      subEl.textContent = s < 45
        ? `${s}s elapsed · usually 20–40s`
        : `${s}s elapsed · hang on, the server may be waking up`;
    }, 1000);

    // Rotate status text
    const loadingTexts = ["Creating your look…", "Reading the garment…", "Fitting it to you…", "Rendering the details…"];
    let tIdx = 0;
    const lTextEl = document.getElementById('looqz-loading-text');
    lTextEl.textContent = loadingTexts[0];
    const tInterval = setInterval(() => {
      tIdx = (tIdx + 1) % loadingTexts.length;
      lTextEl.textContent = loadingTexts[tIdx];
    }, 3000);

    // Both timers must die on every exit path.
    const stopTimers = () => { clearInterval(tInterval); clearInterval(elapsedInterval); };

    try {

      // ── Single-shot secure try-on request ─────────────────────────────────
      // Sends the user photo (Base64 string) and cloth URL to background.js.
      // background.js builds a direct multipart/form-data request to looqz.in
      // with a cloth_image binary fallback to cloth_image_url on CORS failure.
      lTextEl.textContent = 'Uploading images…';

      const tryOnProm = new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'TRYON_WITH_BLOBS',
          userPhotoBase64: STATE.userPhotoBase64,
          clothImageUrl: STATE.productImageUrl,
          productPageUrl: window.location.href,
          productTitle: document.title,
          apiKey: STATE.apiKey,
          proxyUrl: PROXY_URL
        }, res => {
          if (chrome.runtime.lastError) {
            reject(new Error('Extension context invalidated. Please refresh the page.'));
          } else if (res && res.error) {
            reject(new Error(res.error));
          } else {
            resolve(res);
          }
        });
      });


      const abortProm = new Promise((_, reject) => {
        STATE.abortController.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });

      const res = await Promise.race([tryOnProm, abortProm]);
      const data = res.data || {};


      // Handle error statuses
      if (!res.ok) {
        stopTimers();
        switchScreen('screen-main');
        const errEl = document.getElementById('looqz-tryon-error');
        errEl.style.display = 'block';

        if (res.status === 402) {
          // Bind the handler rather than using an inline onclick attribute:
          // inline handlers in host-page DOM are evaluated under the host
          // page's CSP, and most retailers block inline script outright.
          errEl.innerHTML = `Credits exhausted. <span class="looqz-text-link" id="looqz-err-buy-more">Buy more</span>`;
          document.getElementById('looqz-err-buy-more')
            .addEventListener('click', () => window.open('https://www.looqz.in/credits'));
        } else if (res.status === 429) {
          errEl.textContent = "Too many requests. Wait 60 seconds and try again.";
        } else if (res.status === 504) {
          errEl.textContent = "Image generation timed out. Try again.";
        } else if (res.status === 422) {
          const debugMsg =
            data.message ||
            data.detail ||
            (Array.isArray(data.details) ? data.details.join(" ") : '') ||
            (typeof data.details === 'object' && data.details ? Object.values(data.details).join(" ") : '') ||
            data.rawBody ||
            "Image format not supported.";
          console.warn('[Looqz debug] 422 response', {
            status: res.status,
            data,
          });
          errEl.textContent = `DEBUG 422: ${debugMsg}`;
        } else {
          errEl.textContent = data.message || data.detail || data.rawBody || "An error occurred with generation.";
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

      stopTimers();
      lTextEl.textContent = 'Finishing up…';
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
        zBanner.style.display = 'flex';
      } else {
        zBanner.style.display = 'none';
      }

      // Small delay for 100% progress hit
      setTimeout(() => {
        switchScreen('screen-result');
      }, 400);

    } catch (err) {
      // Cancel path: the timers must still be torn down, or a cancelled run
      // leaves two intervals ticking against a hidden screen for the lifetime
      // of the page.
      stopTimers();

      if (err.name === 'AbortError') return; // User cancelled

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

    // ── Remove any stale window handlers from a previous injection cycle ────────
    // Without this, every re-injection appends NEW handlers on top of the old
    // ones, causing multiple misfires and memory leaks.
    if (_sliderHandlers.mouseUp) window.removeEventListener('mouseup', _sliderHandlers.mouseUp);
    if (_sliderHandlers.mouseMove) window.removeEventListener('mousemove', _sliderHandlers.mouseMove);
    if (_sliderHandlers.touchEnd) window.removeEventListener('touchend', _sliderHandlers.touchEnd);
    if (_sliderHandlers.touchMove) window.removeEventListener('touchmove', _sliderHandlers.touchMove);

    // Store named references so the next injection can clean them up too
    _sliderHandlers.mouseUp = () => { isDragging = false; };
    _sliderHandlers.mouseMove = (e) => { if (isDragging) updateSlider(e.clientX); };
    _sliderHandlers.touchEnd = () => { isDragging = false; };
    _sliderHandlers.touchMove = (e) => {
      if (isDragging) {
        e.preventDefault();
        updateSlider(e.touches[0].clientX);
      }
    };

    container.addEventListener('mousedown', (e) => { isDragging = true; updateSlider(e.clientX); });
    window.addEventListener('mouseup', _sliderHandlers.mouseUp);
    window.addEventListener('mousemove', _sliderHandlers.mouseMove);

    // Touch support
    container.addEventListener('touchstart', (e) => { isDragging = true; updateSlider(e.touches[0].clientX); });
    window.addEventListener('touchend', _sliderHandlers.touchEnd);
    window.addEventListener('touchmove', _sliderHandlers.touchMove, { passive: false });
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

  // ─────────────────────────────────────────────────────────────────────────────
  // SPA SELF-HEALING — Auto-restores an open sidebar after SPA navigation wipes
  // ─────────────────────────────────────────────────────────────────────────────
  // Problem: React/Next.js SPAs re-render document.body on route changes,
  // destroying every injected DOM node. If the user had the sidebar open and
  // clicks a product link, the sidebar vanishes and they have no idea why.
  //
  // Fix: A MutationObserver watches for sidebar removal. If it detects the
  // sidebar is gone *while STATE.sidebarOpen is true*, it automatically
  // re-injects and re-opens — zero manual intervention required.
  //
  // Performance note: we observe only shallow childList (not subtree) on body
  // and html. This means the observer fires only when direct children of <body>
  // or <html> change — not on every DOM mutation inside the page. Cost is
  // essentially zero on React apps with deep virtual DOM trees.
  function watchForSPAWipe() {
    // The core recovery action: reset state and re-open cleanly.
    function recover() {
      // ── Step 1: Always re-bind bodyObserver to the current live <body> ──────
      // MutationObserver locks onto the exact memory reference of the node it
      // was given. If the SPA replaced <body>, bodyObserver is now pointing at
      // a dead node in GC limbo — it will never fire again. Disconnect and
      // re-attach unconditionally so the observer is always on the live node,
      // regardless of how many times the SPA swaps the body element.
      if (document.body) {
        bodyObserver.disconnect();
        bodyObserver.observe(document.body, { childList: true });
      }

      // ── Step 2: Restore the sidebar if it was open ─────────────────────────
      if (!STATE.sidebarOpen) return;      // sidebar was closed — nothing to restore
      if (document.getElementById('looqz-sidebar')) return; // still alive — no-op
      // Reset the flag so toggleSidebar() opens (not closes) on next call
      STATE.sidebarOpen = false;
      toggleSidebar();
    }

    // Observer on document.body: catches sidebar removal when the SPA
    // re-renders body's children (the most common React/Next.js pattern).
    const bodyObserver = new MutationObserver(recover);

    // Observer on document.documentElement (<html>): catches the rare case
    // where a SPA replaces <body> itself. When that happens, re-attach
    // bodyObserver to the fresh <body> and then attempt recovery.
    const htmlObserver = new MutationObserver(() => {
      if (document.body) {
        bodyObserver.disconnect();
        bodyObserver.observe(document.body, { childList: true });
        recover();
      }
    });

    // Attach both observers. Guard against edge cases where body/html
    // are not yet present (shouldn't happen at document_end, but be safe).
    if (document.body) {
      bodyObserver.observe(document.body, { childList: true });
    }
    if (document.documentElement) {
      htmlObserver.observe(document.documentElement, { childList: true });
    }
  }

  // Kickoff
  // registerGlobalListeners() — exactly once, unconditionally.
  // init()                    — injects sidebar DOM + binds element events.
  // watchForSPAWipe()         — arms the MutationObserver self-healing loop.
  registerGlobalListeners();
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
  watchForSPAWipe();

  // ── CONTENT_SCRIPT_READY ───────────────────────────────────────────────────────
  // Sent AFTER registerGlobalListeners() and init() have both completed.
  // background.js listens for this specific message and uses it as the
  // absolute, race-condition-free trigger to send TOGGLE_SIDEBAR back.
  // — This is safer than relying on executeScript's Promise resolving, which
  //   only guarantees the script evaluated, not that Chrome's IPC has finished
  //   registering the internal message listener. —
  chrome.runtime.sendMessage({ action: 'CONTENT_SCRIPT_READY' }).catch(() => {
    // Silently ignore: background service worker may have been inactive.
    // In that case the PING on the next click will still work correctly.
  });

})();
