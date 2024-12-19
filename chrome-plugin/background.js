let ws = null;
let wsUrl = null;
let connected = false;
let connectedTabId = null; // Instead of activeTabId
let pingInterval = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[background.js] onMessage received:", msg);
  
  if (msg.type === 'TOGGLE_CONNECTION') {
    console.log("[background.js] Toggling connection...");
    chrome.storage.sync.get(['wsUrl'], (data) => {
      wsUrl = data.wsUrl;
      console.log("[background.js] Retrieved wsUrl from storage:", wsUrl);
      
      // Get the current active tab only when starting the connection
      if (!connected) {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs.length > 0) {
            connectedTabId = tabs[0].id; 
            console.log("[background.js] Storing connectedTabId:", connectedTabId);
            connectWebSocket();
          } else {
            console.warn("[background.js] No active tab found. Cannot set connectedTabId.");
          }
        });
      } else {
        disconnectWebSocket();
      }
      sendResponse({ action: "toggle_attempted" });
    });
    return true; // Keep sendResponse alive for async
  }

  if (msg.type === 'RESPONSE_FROM_CHATGPT') {
    console.log("[background.js] RESPONSE_FROM_CHATGPT received:", msg.response);
    if (connected && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'response', data: msg.response }));
    }
  }
});

// Remove chrome.tabs.onActivated listener entirely
// chrome.tabs.onActivated.removeListener(...) // If previously added

function connectWebSocket() {
  if (ws) {
    console.warn("[background.js] WebSocket already exists. Not reconnecting.");
    return;
  }
  console.log("[background.js] Attempting to connect to:", wsUrl);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[background.js] WebSocket onopen fired. Connected!");
    connected = true;
    updateStatus(true);
    startPing();
  };

  ws.onmessage = (event) => {
    console.log("[background.js] WebSocket onmessage:", event.data);
    let data = null;
    try { data = JSON.parse(event.data); } catch(e) { console.error("[background.js] JSON parse error:", e); }
    if (!data) return;

    if (data.type === 'input') {
      console.log("[background.js] Received input from server:", data.text);
      if (connectedTabId !== null) {
        chrome.tabs.sendMessage(connectedTabId, { type: 'INPUT_FROM_SERVER', text: data.text }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("[background.js] Error sending message to content script:", chrome.runtime.lastError);
          } else {
            console.log("[background.js] Message sent to content script:", response);
          }
        });
      } else {
        console.warn("[background.js] connectedTabId not set. Cannot send input to content script.");
      }
    }
  };

  ws.onclose = () => {
    console.warn("[background.js] WebSocket closed.");
    cleanupConnection();
  };

  ws.onerror = (err) => {
    console.error("[background.js] WebSocket error:", err);
    cleanupConnection();
  };
}

function disconnectWebSocket() {
  console.log("[background.js] disconnectWebSocket called.");
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  } else {
    cleanupConnection();
  }
}

function cleanupConnection() {
  console.log("[background.js] cleanupConnection: Cleaning up.");
  stopPing();
  if (ws) {
    ws = null;
  }
  connected = false;
  connectedTabId = null; // Reset the connected tab id
  updateStatus(false);
}

function updateStatus(isConnected) {
  console.log("[background.js] updateStatus:", isConnected);
  chrome.storage.sync.set({ wsConnected: isConnected }, () => {
    chrome.runtime.sendMessage({ type: 'CONNECTION_STATUS', connected: isConnected });
  });
}

function startPing() {
  stopPing();
  console.log("[background.js] startPing: Starting ping interval.");
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log("[background.js] Sending ping.");
      ws.send(JSON.stringify({ type: 'ping' }));
    } else {
      console.warn("[background.js] Cannot ping. WS not open.");
    }
  }, 30000); // 30 second keep-alive
}

function stopPing() {
  if (pingInterval) {
    console.log("[background.js] stopPing: Clearing ping interval.");
    clearInterval(pingInterval);
  }
  pingInterval = null;
}
