// Runs when user clicks the extension icon
chrome.action.onClicked.addListener((tab) => {
  // inject content.js if not already there
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  }, () => {
    // then send a message to start processing
    chrome.tabs.sendMessage(tab.id, { type: "runScraper" });
  });
});

// This stays as your fetch proxy (already in your code)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "fetchHtml") {
    fetch(msg.url, { credentials: "include" })
      .then(r => r.text())
      .then(html => sendResponse({ html }))
      .catch(err => sendResponse({ error: err.toString() }));
    return true; // async response
  }
});