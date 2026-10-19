// ZogPanel background worker
// Opens the dashboard once per browser launch, and on toolbar-icon click.

const DASHBOARD_URL = chrome.runtime.getURL("dashboard.html");

async function openDashboard({ focusExisting = true } = {}) {
  // Avoid duplicates (e.g. a dashboard tab restored by "Continue where you left off").
  const existing = await chrome.tabs.query({ url: DASHBOARD_URL });
  if (existing.length > 0) {
    if (focusExisting) {
      const tab = existing[0];
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return;
  }
  // Open as the first tab so it sits alongside whatever else Chrome opens.
  await chrome.tabs.create({ url: DASHBOARD_URL, index: 0, active: true });
}

// Fires once each time Chrome starts with this profile.
chrome.runtime.onStartup.addListener(() => {
  // Small delay lets Chrome finish restoring session tabs before we check for duplicates.
  setTimeout(() => openDashboard({ focusExisting: false }), 1500);
});

// Open it right away the first time the extension is installed.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") openDashboard();
});

// Toolbar icon opens or focuses the dashboard.
chrome.action.onClicked.addListener(() => openDashboard());
