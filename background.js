// ZogPanel background worker.
// Two ways to open the dashboard (Settings › "Open ZogPanel", or OPEN_MODE in .env):
//   "startup" — one dashboard tab each time Chrome starts (default)
//   "newtab"  — every new tab shows the dashboard

const DASHBOARD_URL = chrome.runtime.getURL("dashboard.html");
const NEW_TAB_URLS = ["chrome://newtab/", "chrome://new-tab-page/", "edge://newtab/", "about:newtab"];

let cachedMode = null;

async function envOpenMode() {
  try {
    const res = await fetch(chrome.runtime.getURL(".env"), { cache: "no-store" });
    if (!res.ok) return "";
    const m = (await res.text()).match(/^\s*OPEN_MODE\s*=\s*"?(\w+)"?/m);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

async function getOpenMode() {
  if (cachedMode) return cachedMode;
  const { openMode } = await chrome.storage.sync.get("openMode");
  const mode = openMode || (await envOpenMode());
  cachedMode = mode === "newtab" ? "newtab" : "startup";
  return cachedMode;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.openMode) cachedMode = null;
});

async function openDashboard({ focusExisting = true } = {}) {
  // Avoid duplicates (e.g. a dashboard tab restored by "Continue where you left off").
  const existing = await chrome.tabs.query({ url: DASHBOARD_URL + "*" });
  if (existing.length > 0) {
    if (focusExisting) {
      const tab = existing[0];
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: DASHBOARD_URL, index: 0, active: true });
}

// Startup mode: one dashboard tab per browser launch.
chrome.runtime.onStartup.addListener(async () => {
  if ((await getOpenMode()) !== "startup") return;
  // Small delay lets Chrome finish restoring session tabs before we check for duplicates.
  setTimeout(() => openDashboard({ focusExisting: false }), 1500);
});

// New-tab mode: swap Chrome's new tab page for the dashboard.
function isNewTab(tab) {
  const url = tab.pendingUrl || tab.url || "";
  return NEW_TAB_URLS.includes(url);
}

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!isNewTab(tab)) return;
  if ((await getOpenMode()) !== "newtab") return;
  chrome.tabs.update(tab.id, { url: DASHBOARD_URL + "#newtab" }).catch(() => {});
});

// Open it right away the first time the extension is installed.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") openDashboard();
});

// Toolbar icon opens or focuses the dashboard.
chrome.action.onClicked.addListener(() => openDashboard());
