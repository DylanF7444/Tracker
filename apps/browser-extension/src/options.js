const defaults = {
  serverUrl: "http://localhost:8787",
  userId: "demo-user",
  deviceId: "browser-default",
  encryptionKey: "change-this-encryption-key"
};

const form = document.getElementById("settings-form");
const status = document.getElementById("status");

async function load() {
  const value = await chrome.storage.sync.get(defaults);
  document.getElementById("server-url").value = value.serverUrl;
  document.getElementById("user-id").value = value.userId;
  document.getElementById("device-id").value = value.deviceId;
  document.getElementById("encryption-key").value = value.encryptionKey;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    serverUrl: document.getElementById("server-url").value.trim(),
    userId: document.getElementById("user-id").value.trim(),
    deviceId: document.getElementById("device-id").value.trim(),
    encryptionKey: document.getElementById("encryption-key").value.trim()
  };
  await chrome.storage.sync.set(payload);
  status.textContent = "Saved.";
  setTimeout(() => {
    status.textContent = "";
  }, 2000);
});

load().catch(() => {
  status.textContent = "Failed to load current settings.";
});
