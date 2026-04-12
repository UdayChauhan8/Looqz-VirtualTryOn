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

});


