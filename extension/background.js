// background.js

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_SIDEBAR" }).catch((err) => {
    console.log("Could not toggle sidebar: content script not present on this tab.");
  });
});

// Storage bridge — content.js sends messages, background handles storage
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === "GET_STORAGE") {
    chrome.storage.local.get(message.keys, (result) => {
      sendResponse({ data: result });
    });
    return true;
  }

  if (message.action === "SET_STORAGE") {
    chrome.storage.local.set(message.data, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === "CLEAR_STORAGE") {
    chrome.storage.local.clear(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === "PROXY_FETCH") {
    fetch(message.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: message.body
    })
    .then(async res => {
      let data = {};
      try { data = await res.json(); } catch(e){}
      sendResponse({ ok: res.ok, status: res.status, data: data });
    })
    .catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  // CATBOX_UPLOAD: takes a base64 data-URI and uploads it to tmpfiles
  if (message.action === "CATBOX_UPLOAD") {
    fetch(message.base64Data)
      .then(r => r.blob())
      .then(blob => {
        const fd = new FormData();
        fd.append('file', blob, 'image.jpg');
        return fetch('https://tmpfiles.org/api/v1/upload', {
          method: 'POST',
          body: fd
        });
      })
      .then(res => res.json())
      .then(json => {
        if (json.status !== "success" || !json.data || !json.data.url) throw new Error(`Upload error`);
        const url = json.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/').replace('http://', 'https://');
        sendResponse({ url: url });
      })
      .catch(err => {
        sendResponse({ error: err.message });
      });
    return true;
  }

  // FETCH_AND_UPLOAD: fetches an external image URL (like Amazon CDN), then uploads to tmpfiles.
  // Makes restricted images publicly accessible to Looqz's image fetcher.
  if (message.action === "FETCH_AND_UPLOAD") {
    fetch(message.url)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to fetch image: HTTP ${r.status}`);
        return r.blob();
      })
      .then(blob => {
        const fd = new FormData();
        fd.append('file', blob, 'cloth.jpg');
        return fetch('https://tmpfiles.org/api/v1/upload', {
          method: 'POST',
          body: fd
        });
      })
      .then(res => res.json())
      .then(json => {
        if (json.status !== "success" || !json.data || !json.data.url) throw new Error(`Upload error`);
        const url = json.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/').replace('http://', 'https://');
        sendResponse({ url: url });
      })
      .catch(err => {
        sendResponse({ error: err.message });
      });
    return true;
  }

  // FETCH_LEDGER_CREDITS: Scrapes the user's dashboard to find their real billing balance
  if (message.action === "FETCH_LEDGER_CREDITS") {
    fetch('https://www.looqz.in/credits', { redirect: 'error' })
      .then(r => r.text())
      .then(html => {
        let credits = null;
        
        // Solid Logic: Extract InertiaJS backend JSON state embedded in the page
        const inertiaMatch = html.match(/data-page="([^"]+)"/);
        if (inertiaMatch) {
            try {
                const jsonStr = inertiaMatch[1].replace(/&quot;/g, '"');
                const pageData = JSON.parse(jsonStr);
                
                // Check standard Laravel/Inertia auth props first
                if (pageData.props?.auth?.user) {
                    const u = pageData.props.auth.user;
                    if (u.credits !== undefined) credits = parseInt(u.credits);
                    else if (u.balance !== undefined) credits = parseInt(u.balance);
                }
                
                // If not explicitly in auth.user, search all props for exact balance keys
                if (credits === null) {
                    const searchJSON = (obj) => {
                        if (!obj || typeof obj !== 'object') return null;
                        for (let k of Object.keys(obj)) {
                            const key = k.toLowerCase();
                            if ((key === 'credits' || key === 'balance' || key === 'total_credits' || key === 'totalcredits') && typeof obj[k] === 'number') {
                                return obj[k];
                            }
                            if (typeof obj[k] === 'object') {
                                const res = searchJSON(obj[k]);
                                if (res !== null) return res;
                            }
                        }
                        return null;
                    };
                    credits = searchJSON(pageData.props);
                }
            } catch(e) {
                console.error("Inertia parsing failed", e);
            }
        }
        
        // Fallback: strictly target the number under the "Total Credits" UI card
        if (credits === null) {
            const totalSectionRegex = /Total Credits[\s\S]{1,150}?(?:>|:\s*)(\d{1,5})(?:<|\s)/i;
            const match = html.match(totalSectionRegex);
            if (match) credits = parseInt(match[1]);
        }

        if (credits !== null && !isNaN(credits)) {
           sendResponse({ credits: credits });
        } else {
           sendResponse({ error: "Could not locate credits in HTML/JSON" });
        }
      })
      .catch(err => {
         sendResponse({ error: err.message });
      });
    return true;
  }

});


