// background.js

// Toggle sidebar on icon click
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_SIDEBAR" });
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

});
