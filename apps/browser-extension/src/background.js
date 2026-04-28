const DB_NAME = "focus_extension";
const STORE = "events";
const PUSH_ALARM = "focus-batch-sync";
const STATUS_KEY = "focusStatus";

let activeSession = null;
let realtimeSocket = null;
let realtimeConnected = false;

const DEFAULT_SETTINGS = {
  serverUrl: "http://localhost:8787",
  userId: "demo-user",
  deviceId: "browser-default",
  encryptionKey: "change-this-encryption-key"
};

async function getSettings() {
  const value = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    serverUrl: value.serverUrl ?? DEFAULT_SETTINGS.serverUrl,
    userId: value.userId ?? DEFAULT_SETTINGS.userId,
    deviceId: value.deviceId ?? DEFAULT_SETTINGS.deviceId,
    encryptionKey: value.encryptionKey ?? DEFAULT_SETTINGS.encryptionKey
  };
}

function classify(url, title) {
  const normalized = `${url} ${title}`.toLowerCase();
  if (normalized.includes("youtube.com") || normalized.includes("reddit.com")) {
    return { category: "entertainment", productivity: "distracting" };
  }
  if (normalized.includes("slack") || normalized.includes("teams")) {
    return { category: "communication", productivity: "neutral" };
  }
  if (normalized.includes("github") || normalized.includes("docs") || normalized.includes("code")) {
    return { category: "productivity", productivity: "productive" };
  }
  return { category: "neutral", productivity: "neutral" };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addEvent(event) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(event);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readEvents() {
  const db = await openDb();
  const events = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return events;
}

async function deleteEvents(ids) {
  if (ids.length === 0) return;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of ids) {
      store.delete(id);
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function deriveKey(secret) {
  const encoded = new TextEncoder().encode(secret);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt"]);
}

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function encryptPayload(secret, payload) {
  const key = await deriveKey(secret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext);
  return {
    version: 1,
    alg: "aes-256-gcm",
    nonce: toBase64(nonce),
    ciphertext: toBase64(encrypted)
  };
}

async function flushQueue() {
  const settings = await getSettings();
  const queued = await readEvents();
  if (queued.length === 0) {
    await chrome.storage.local.set({ [STATUS_KEY]: "Idle" });
    return;
  }

  const events = await Promise.all(
    queued.map(async (session) => ({
      eventId: session.id,
      sourceDeviceId: settings.deviceId,
      sourceDeviceType: "browser",
      startTs: session.startTs,
      endTs: session.endTs,
      envelope: await encryptPayload(settings.encryptionKey, {
        ...session,
        userId: settings.userId,
        deviceId: settings.deviceId
      })
    }))
  );

  await chrome.storage.local.set({ [STATUS_KEY]: "Syncing..." });
  const response = await fetch(`${settings.serverUrl.replace(/\/$/, "")}/v1/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: settings.userId,
      deviceId: settings.deviceId,
      deviceType: "browser",
      events
    })
  });

  if (!response.ok) {
    await chrome.storage.local.set({ [STATUS_KEY]: "Sync failed" });
    throw new Error(`Sync failed (${response.status})`);
  }

  await deleteEvents(queued.map((item) => item.id));
  await chrome.storage.local.set({ [STATUS_KEY]: "Synced" });
}

function finalizeActiveSession(reason) {
  if (!activeSession) return;
  const endTs = new Date().toISOString();
  if (new Date(endTs).getTime() <= new Date(activeSession.startTs).getTime()) {
    activeSession = null;
    return;
  }
  const { category, productivity } = classify(activeSession.url, activeSession.title);
  const payload = {
    id: crypto.randomUUID(),
    userId: "",
    deviceId: "",
    deviceType: "browser",
    source: "browser-tab",
    appName: activeSession.hostname,
    windowTitle: activeSession.title,
    pageUrl: activeSession.url,
    category,
    productivity,
    tag: reason === "idle" ? "break" : "",
    startTs: activeSession.startTs,
    endTs,
    createdAt: endTs
  };
  addEvent(payload)
    .then(() => (realtimeConnected ? flushQueue() : Promise.resolve()))
    .catch(() => undefined);
  activeSession = null;
}

async function beginSessionForTab(tabId) {
  if (!tabId || tabId < 0) return;
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) return;
  const now = new Date().toISOString();
  const hostname = (() => {
    try {
      return new URL(tab.url).hostname;
    } catch {
      return tab.url;
    }
  })();
  activeSession = {
    tabId,
    url: tab.url,
    title: tab.title ?? hostname,
    hostname,
    startTs: now
  };
}

function connectRealtime() {
  getSettings()
    .then((settings) => {
      const wsUrl = settings.serverUrl.replace(/^http/, "ws").replace(/\/$/, "");
      realtimeSocket = new WebSocket(
        `${wsUrl}/v1/realtime?userId=${encodeURIComponent(settings.userId)}&deviceId=${encodeURIComponent(
          settings.deviceId
        )}&deviceType=browser`
      );
      realtimeSocket.onopen = () => {
        realtimeConnected = true;
      };
      realtimeSocket.onmessage = () => {
        flushQueue().catch(() => undefined);
      };
      realtimeSocket.onclose = () => {
        realtimeConnected = false;
        realtimeSocket = null;
      };
      realtimeSocket.onerror = () => {
        realtimeConnected = false;
      };
    })
    .catch(() => {
      realtimeConnected = false;
    });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(PUSH_ALARM, { periodInMinutes: 1 });
  connectRealtime();
});

chrome.runtime.onStartup.addListener(() => {
  connectRealtime();
});

chrome.tabs.onActivated.addListener(async (info) => {
  finalizeActiveSession("tab-switch");
  await beginSessionForTab(info.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    finalizeActiveSession("tab-update");
    beginSessionForTab(tabId).catch(() => undefined);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    finalizeActiveSession("window-blur");
    return;
  }
  const tabs = await chrome.tabs.query({ active: true, windowId });
  if (tabs[0]?.id != null) {
    finalizeActiveSession("window-focus");
    await beginSessionForTab(tabs[0].id);
  }
});

chrome.idle.onStateChanged.addListener((state) => {
  if (state !== "active") {
    finalizeActiveSession("idle");
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PUSH_ALARM) {
    flushQueue().catch(() => undefined);
  }
});
