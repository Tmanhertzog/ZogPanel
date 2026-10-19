// ZogPanel dashboard: greeting, themes, search, shortcuts, bookmarks.

const $ = (sel) => document.querySelector(sel);
const THEMES = ["basic", "motivated", "chill"];

// ---------- helpers ----------
function faviconUrl(pageUrl, size = 32) {
  const u = new URL(chrome.runtime.getURL("/_favicon/"));
  u.searchParams.set("pageUrl", pageUrl);
  u.searchParams.set("size", String(size));
  return u.toString();
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

function lsSet(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {}
}

// ---------- greeting ----------
function renderClock() {
  const now = new Date();
  const h = now.getHours();
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const name = Config.get("USER_NAME");
  $("#greeting").textContent = name ? `${part}, ${name}` : part;
  $("#date").textContent =
    now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) +
    " · " + now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ---------- themes ----------
function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = THEMES.includes(Config.get("DEFAULT_THEME")) ? Config.get("DEFAULT_THEME") : "basic";
  document.documentElement.setAttribute("data-theme", theme);
  for (const btn of document.querySelectorAll("[data-theme-choice]")) {
    btn.setAttribute("aria-checked", String(btn.dataset.themeChoice === theme));
  }
  lsSet("zog.theme", theme);
  if (typeof maybeRefreshQuote === "function" && Config.loadedEnv !== undefined) maybeRefreshQuote();
}

async function initThemes() {
  const { theme = Config.get("DEFAULT_THEME") } = await chrome.storage.sync.get(["theme"]);
  applyTheme(theme);

  for (const btn of document.querySelectorAll("[data-theme-choice]")) {
    btn.addEventListener("click", () => {
      const t = btn.dataset.themeChoice;
      applyTheme(t);
      chrome.storage.sync.set({ theme: t });
    });
  }

  // Keep other open dashboards in sync.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.theme) applyTheme(changes.theme.newValue);
  });
}

// ---------- Basic theme: random photo from BACKGROUND_IMAGES_DIR ----------
function placeFromFilename(name) {
  // "arches-national-park-utah_54795484947_l.jpg" -> "Arches National Park Utah"
  const slug = name.replace(/\.[a-z0-9]+$/i, "").replace(/_\d+(_[a-z])?$/i, "");
  if (/^img[_-]?\d+$/i.test(slug)) return "";
  return slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function photoDir() {
  return (Config.get("BACKGROUND_IMAGES_DIR") || "basic_bkg_images").replace(/^[\/.]+|[\/]+$/g, "");
}

async function initPhoto() {
  let files = [];
  try {
    const res = await fetch(chrome.runtime.getURL(photoDir() + "/images.json"), { cache: "no-store" });
    if (res.ok) files = await res.json();
  } catch {}
  files = (files || []).filter((f) => /\.(jpe?g|png|webp|gif|avif)$/i.test(f));
  if (!files.length) return;

  // Avoid showing the same photo twice in a row.
  let last = null;
  try { last = localStorage.getItem("zog.lastPhoto"); } catch {}
  const pool = files.length > 1 ? files.filter((f) => f !== last) : files;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  lsSet("zog.lastPhoto", pick);

  const url = chrome.runtime.getURL(photoDir() + "/" + encodeURIComponent(pick));
  const img = new Image();
  img.onload = () => {
    const layer = $("#bgLayer");
    layer.style.setProperty("--photo", `url("${url}")`);
    layer.classList.add("has-photo");
    const place = placeFromFilename(pick);
    const cap = $("#photoCaption");
    cap.textContent = place;
    cap.hidden = !place;
  };
  img.src = url;
}

// ---------- search ----------
function initSearch() {
  $("#search").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#searchInput").value.trim();
    if (!q) return;
    const looksLikeUrl = !q.includes(" ") && /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(q);
    window.location.href = looksLikeUrl
      ? (/^https?:\/\//i.test(q) ? q : `https://${q}`)
      : (Config.get("SEARCH_URL") || "https://www.google.com/search?q=") + encodeURIComponent(q);
  });
}

// ---------- search / AI chat switch ----------
function setMode(mode) {
  if (mode !== "chat") mode = "search";
  $("#midStack").dataset.mode = mode;
  for (const b of document.querySelectorAll("[data-mode-choice]")) {
    b.setAttribute("aria-checked", String(b.dataset.modeChoice === mode));
  }
  lsSet("zog.midMode", mode);
}

function initModeSwitch() {
  let saved = "search";
  try { saved = localStorage.getItem("zog.midMode") || "search"; } catch {}
  setMode(saved);
  for (const b of document.querySelectorAll("[data-mode-choice]")) {
    b.addEventListener("click", () => {
      setMode(b.dataset.modeChoice);
      (b.dataset.modeChoice === "chat" ? $("#chatInput") : $("#searchInput")).focus();
    });
  }
}

// ---------- shortcuts (stored in Notion, editable here) ----------
// With a Notion token: the Notion "Shortcuts" database is the source of truth.
// Without one: falls back to Chrome sync storage until you connect Notion.
let shortcuts = [];            // [{ id?, title, url }] in display order
let shortcutSource = "local";  // "notion" | "local"
let editingShortcuts = false;
let editIndex = -1;            // -1 = adding a new one
let dragFrom = -1;
let pulling = false;

function normalizeUrl(raw) {
  let u = raw.trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch { return null; }
}

function setShortcutStatus(text, isError = false) {
  const s = $("#shortcutStatus");
  s.textContent = text;
  s.classList.toggle("error", isError);
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 4000);
}

async function cacheShortcuts() {
  if (shortcutSource === "notion") await chrome.storage.local.set({ shortcutsCache: shortcuts });
  else await chrome.storage.sync.set({ shortcuts: shortcuts.map(({ title, url }) => ({ title, url })) });
}

async function loadShortcuts() {
  const token = await Notion.token();
  if (token && NOTION_DEFAULTS.shortcuts) {
    shortcutSource = "notion";
    const { shortcutsCache } = await chrome.storage.local.get("shortcutsCache");
    if (Array.isArray(shortcutsCache)) { shortcuts = shortcutsCache; renderShortcuts(); }
    await pullShortcutsFromNotion();
    return;
  }

  shortcutSource = "local";
  setShortcutStatus(token ? "Local · set NOTION_SHORTCUTS_DS in .env" : "Local · connect Notion in settings");
  const { shortcuts: saved } = await chrome.storage.sync.get("shortcuts");
  if (Array.isArray(saved)) {
    shortcuts = saved;
  } else {
    const top = await chrome.topSites.get();
    shortcuts = top.slice(0, 8).map((s) => ({ title: s.title || hostOf(s.url), url: s.url }));
    await cacheShortcuts();
  }
  renderShortcuts();
}

async function pullShortcutsFromNotion() {
  if (pulling) return;
  pulling = true;
  setShortcutStatus("Syncing…");
  try {
    const rows = await Notion.queryAll(NOTION_DEFAULTS.shortcuts, {
      sorts: [{ property: "Order", direction: "ascending" }, { timestamp: "created_time", direction: "ascending" }],
    });
    let list = rows
      .map((r) => ({ id: r.id, title: Notion.plain(r.properties.Name), url: Notion.plain(r.properties.URL) }))
      .filter((s) => s.url);

    // First connection: move the shortcuts you already had into Notion.
    if (!list.length) {
      const { shortcuts: local, shortcutsMigrated } = await chrome.storage.sync.get(["shortcuts", "shortcutsMigrated"]);
      if (!shortcutsMigrated && Array.isArray(local) && local.length) {
        setShortcutStatus("Copying your shortcuts to Notion…");
        for (let k = 0; k < local.length; k++) {
          const page = await Notion.createPage(NOTION_DEFAULTS.shortcuts, {
            Name: Notion.title(local[k].title), URL: Notion.url(local[k].url), Order: Notion.number(k + 1),
          });
          list.push({ id: page.id, title: local[k].title, url: local[k].url });
        }
        await chrome.storage.sync.set({ shortcutsMigrated: true });
      }
    }

    shortcuts = list;
    await cacheShortcuts();
    renderShortcuts();
    setShortcutStatus("Synced with Notion");
  } catch (e) {
    console.error("ZogPanel: Notion shortcuts", e);
    if (e.status === 404 && !pullShortcutsFromNotion._retried) {
      // The ID may be wrong for this workspace: look the database up by name and retry once.
      pullShortcutsFromNotion._retried = true;
      const { hit, info } = await Notion.rediscover("shortcuts").catch(() => ({}));
      pulling = false;
      if (hit) return pullShortcutsFromNotion();
      setShortcutStatus(info && info.workspace
        ? `Can't see Shortcuts in "${info.workspace}" · see Settings`
        : "Notion can't see Shortcuts · see Settings", true);
    } else {
      setShortcutStatus(e.status === 401 ? "Notion token rejected · see Settings" : "Notion unavailable · showing saved copy", true);
    }
    if (!shortcuts.length) renderShortcuts();
  } finally {
    pulling = false;
  }
}

// Run a Notion write; on failure, tell the user and reload the true state from Notion.
async function notionWrite(fn) {
  if (shortcutSource !== "notion") { await cacheShortcuts(); return; }
  setShortcutStatus("Saving…");
  try {
    await fn();
    await cacheShortcuts();
    setShortcutStatus("Synced with Notion");
  } catch (e) {
    console.error("ZogPanel: Notion write", e);
    toast("Couldn't save to Notion: " + e.message);
    await pullShortcutsFromNotion();
  }
}

async function addShortcut(title, url) {
  const item = { title, url };
  shortcuts.push(item);
  renderShortcuts();
  await notionWrite(async () => {
    const page = await Notion.createPage(NOTION_DEFAULTS.shortcuts, {
      Name: Notion.title(title), URL: Notion.url(url), Order: Notion.number(shortcuts.length),
    });
    item.id = page.id;
  });
}

async function updateShortcut(idx, title, url) {
  const item = shortcuts[idx];
  item.title = title; item.url = url;
  renderShortcuts();
  await notionWrite(() => item.id && Notion.updatePage(item.id, { Name: Notion.title(title), URL: Notion.url(url) }));
}

async function removeShortcut(idx) {
  const [item] = shortcuts.splice(idx, 1);
  renderShortcuts();
  await notionWrite(() => item.id && Notion.trashPage(item.id));
}

async function moveShortcut(from, to) {
  const [moved] = shortcuts.splice(from, 1);
  shortcuts.splice(to, 0, moved);
  renderShortcuts();
  // Renumber only the rows whose position changed.
  const lo = Math.min(from, to), hi = Math.max(from, to);
  await notionWrite(async () => {
    for (let k = lo; k <= hi; k++) {
      if (shortcuts[k].id) await Notion.updatePage(shortcuts[k].id, { Order: Notion.number(k + 1) });
    }
  });
}

function renderShortcuts() {
  const box = $("#quick");
  box.replaceChildren();
  box.classList.toggle("editing", editingShortcuts);
  $("#shortcutHint").hidden = !editingShortcuts;

  shortcuts.forEach((s, idx) => {
    const tile = el("a", { class: "quick-tile", href: s.url, title: `${s.title}\n${s.url}`, draggable: String(editingShortcuts) }, [
      el("img", { src: faviconUrl(s.url, 64), alt: "", loading: "lazy" }),
      el("span", { text: s.title || hostOf(s.url) }),
    ]);

    if (editingShortcuts) {
      tile.addEventListener("click", (e) => { e.preventDefault(); openShortcutDialog(idx); });
      const rm = el("button", { class: "sc-remove", type: "button", "aria-label": `Remove ${s.title}`, text: "×" });
      rm.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); removeShortcut(idx); });
      tile.append(rm);

      tile.addEventListener("dragstart", (e) => { dragFrom = idx; tile.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
      tile.addEventListener("dragend", () => { dragFrom = -1; tile.classList.remove("dragging"); });
      tile.addEventListener("dragover", (e) => { e.preventDefault(); tile.classList.add("drop-target"); });
      tile.addEventListener("dragleave", () => tile.classList.remove("drop-target"));
      tile.addEventListener("drop", (e) => {
        e.preventDefault();
        tile.classList.remove("drop-target");
        if (dragFrom >= 0 && dragFrom !== idx) moveShortcut(dragFrom, idx);
      });
    }
    box.append(tile);
  });

  if (shortcuts.length < Config.int("MAX_SHORTCUTS", 24)) {
    const add = el("button", { class: "quick-tile add-tile", type: "button", "aria-label": "Add shortcut" }, [
      el("span", { class: "plus", text: "+" }),
      el("span", { text: "Add" }),
    ]);
    add.addEventListener("click", () => openShortcutDialog(-1));
    box.append(add);
  }
}

function openShortcutDialog(idx) {
  editIndex = idx;
  const s = idx >= 0 ? shortcuts[idx] : { title: "", url: "" };
  $("#shortcutDialogTitle").textContent = idx >= 0 ? "Edit shortcut" : "Add shortcut";
  $("#scName").value = s.title;
  $("#scUrl").value = s.url;
  $("#scUrl").setCustomValidity("");
  $("#scDelete").hidden = idx < 0;
  $("#shortcutDialog").showModal();
  $("#scName").focus();
}

function initShortcuts() {
  $("#editShortcuts").addEventListener("click", () => {
    editingShortcuts = !editingShortcuts;
    $("#editShortcuts").textContent = editingShortcuts ? "Done" : "Edit";
    $("#editShortcuts").setAttribute("aria-pressed", String(editingShortcuts));
    renderShortcuts();
  });

  $("#scCancel").addEventListener("click", () => $("#shortcutDialog").close());

  $("#scDelete").addEventListener("click", () => {
    $("#shortcutDialog").close();
    if (editIndex >= 0) removeShortcut(editIndex);
  });

  $("#shortcutForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = normalizeUrl($("#scUrl").value);
    if (!url) {
      $("#scUrl").setCustomValidity("Enter a valid web address");
      $("#scUrl").reportValidity();
      return;
    }
    const title = $("#scName").value.trim() || hostOf(url);
    $("#shortcutDialog").close();
    if (editIndex >= 0) updateShortcut(editIndex, title, url);
    else addShortcut(title, url);
  });
  $("#scUrl").addEventListener("input", () => $("#scUrl").setCustomValidity(""));

  // Pick up edits made directly in Notion when you come back to the tab.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && shortcutSource === "notion" && !editingShortcuts) pullShortcutsFromNotion();
  });

  // Local mode: changes from another open dashboard.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (shortcutSource === "local" && area === "sync" && changes.shortcuts && Array.isArray(changes.shortcuts.newValue)) {
      shortcuts = changes.shortcuts.newValue;
      renderShortcuts();
    }
  });
}

// ---------- settings ----------
// Checks the token and reports exactly what the integration can see.
async function runNotionCheck({ closeOnSuccess }) {
  const out = $("#settingsStatus");
  out.textContent = "Checking Notion…";
  const info = await Notion.diagnose();
  if (info.error) {
    out.textContent = info.error.status === 401
      ? "This token was rejected. Copy the Internal Integration Secret again from notion.so/profile/integrations."
      : "Couldn't reach Notion: " + info.error.message;
    return false;
  }
  const who = `Integration "${info.bot || "?"}" in workspace "${info.workspace || "?"}"`;
  const names = info.sources.map((s) => s.name || "(untitled)");
  let target = info.sources.find((s) => s.id.replace(/-/g, "") === NOTION_DEFAULTS.shortcuts.replace(/-/g, ""));
  if (!target) {
    const { hit } = await Notion.rediscover("shortcuts");
    target = hit;
  }
  if (target) {
    out.textContent = `Connected ✓ ${who}. Can see: ${names.join(", ")}.`;
    pullShortcutsFromNotion._retried = false;
    loadShortcuts();
    loadWork({ fromCache: false });
    loadNews();
    if (closeOnSuccess) setTimeout(() => $("#settingsDialog").close(), 1200);
    return true;
  }
  out.textContent = names.length
    ? `${who} can see ${names.join(", ")}, but not a "Shortcuts" database. Add the integration to the page that holds it (••• › Connections).`
    : `${who} works, but nothing is shared with it yet. In Notion, open the ZogPanel page › ••• › Connections and add "${info.bot || "your integration"}". If it isn't listed there, the integration belongs to a different workspace than "${info.workspace}".`;
  return false;
}

async function currentOpenMode() {
  const { openMode } = await chrome.storage.sync.get("openMode");
  const mode = openMode || Config.get("OPEN_MODE");
  return mode === "newtab" ? "newtab" : "startup";
}

function initSettings() {
  const dlg = $("#settingsDialog");
  for (const radio of document.querySelectorAll('input[name="openMode"]')) {
    radio.addEventListener("change", () => {
      if (radio.checked) chrome.storage.sync.set({ openMode: radio.value });
    });
  }
  $("#openSettings").addEventListener("click", async () => {
    const { notionToken = "" } = await chrome.storage.local.get("notionToken");
    $("#notionToken").value = notionToken;
    $("#notionToken").placeholder = Config.get("NOTION_TOKEN") ? "Using NOTION_TOKEN from .env" : "ntn_…";
    $("#settingsStatus").textContent = "";
    const mode = await currentOpenMode();
    for (const radio of document.querySelectorAll('input[name="openMode"]')) radio.checked = radio.value === mode;
    dlg.showModal();
    if (await Notion.token()) runNotionCheck({ closeOnSuccess: false });
  });
  $("#settingsCheck").addEventListener("click", () => runNotionCheck({ closeOnSuccess: false }));
  $("#settingsCancel").addEventListener("click", () => dlg.close());
  $("#settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = $("#notionToken").value.trim();
    await Notion.setToken(value);
    if (!(await Notion.token())) { dlg.close(); loadShortcuts(); return; }
    await runNotionCheck({ closeOnSuccess: true });
  });
}

// ---------- bookmarks ----------
let bmRoots = [];
let activeRootId = null;

const FOLDER_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

function countLinks(node) {
  if (node.url) return 1;
  return (node.children || []).reduce((n, c) => n + countLinks(c), 0);
}

function bmLink(node) {
  return el("a", { class: "bm-link", href: node.url, title: `${node.title}\n${node.url}` }, [
    el("img", { src: faviconUrl(node.url), alt: "", loading: "lazy" }),
    el("span", { text: node.title || hostOf(node.url) }),
  ]);
}

function renderNodes(children, container) {
  for (const c of children) {
    if (c.url) { container.append(bmLink(c)); continue; }
    const n = countLinks(c);
    if (!n) continue;
    const details = el("details", { class: "bm-folder" });
    const summary = el("summary");
    summary.innerHTML = FOLDER_ICON;
    summary.append(el("span", { class: "name", text: c.title || "Untitled folder" }), el("span", { class: "count", text: String(n) }));
    const body = el("div", { class: "bm-folder-body" });
    details.append(summary, body);
    // Fill folder contents only when opened.
    details.addEventListener("toggle", () => {
      if (details.open && !body.childElementCount) renderNodes(c.children || [], body);
    });
    container.append(details);
  }
}

function renderBookmarks() {
  const tabs = $("#bmTabs");
  const box = $("#bookmarks");
  tabs.replaceChildren();
  box.replaceChildren();

  const visible = bmRoots.filter((r) => countLinks(r) > 0);
  if (!visible.length) {
    box.append(el("p", { class: "placeholder", text: "No bookmarks yet." }));
    return;
  }
  if (!visible.some((r) => r.id === activeRootId)) activeRootId = visible[0].id;

  if (visible.length > 1) {
    for (const r of visible) {
      const btn = el("button", { class: "tab" + (r.id === activeRootId ? " active" : ""), type: "button", role: "tab", text: r.title });
      btn.addEventListener("click", () => {
        activeRootId = r.id;
        lsSet("zog.bmTab", r.id);
        renderBookmarks();
      });
      tabs.append(btn);
    }
  }

  renderNodes(visible.find((r) => r.id === activeRootId).children || [], box);
}

async function loadBookmarks() {
  const [tree] = await chrome.bookmarks.getTree();
  bmRoots = tree.children || [];
  renderBookmarks();
}

// ---------- init ----------
// ---------- quote ----------
// Quote of the day: see quote.js

(async function init() {
  await Config.ready;
  try { activeRootId = localStorage.getItem("zog.bmTab"); } catch {}
  applyQuote();
  renderClock();
  if (location.hash === "#newtab") {
    history.replaceState(null, "", location.pathname);
    setTimeout(() => { if ($("#midStack").dataset.mode !== "chat") $("#searchInput").focus(); }, 50);
  }
  setInterval(renderClock, 30_000);
  initSearch();
  initModeSwitch();
  initShortcuts();
  initSettings();
  initWork();
  initNews();
  await Promise.all([initThemes(), initPhoto(), loadShortcuts(), loadWork(), loadBookmarks(), initAssistant(), loadNews()]);

  // New day while the dashboard stays open: fetch the new quote when you come back to it.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") maybeRefreshQuote(); });

  for (const evt of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered"]) {
    chrome.bookmarks[evt].addListener(loadBookmarks);
  }
})();
