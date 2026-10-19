// Loads user settings from the .env file in the extension folder.
// Copy .env.example to .env and fill it in. .env is git-ignored.

const CONFIG_DEFAULTS = {
  USER_NAME: "",
  DEFAULT_THEME: "basic",
  SEARCH_URL: "https://www.google.com/search?q=",

  BACKGROUND_IMAGES_DIR: "basic_bkg_images",
  MOTIVATED_QUOTE: "Impossible is a word to be found only in the dictionary of fools.",
  MOTIVATED_QUOTE_AUTHOR: "Napoleon Bonaparte",

  MAX_SHORTCUTS: "24",

  NOTION_TOKEN: "",
  NOTION_VERSION: "2025-09-03",
  NOTION_SHORTCUTS_DS: "",
  NOTION_TASKS_DS: "",
  NOTION_PROJECTS_DS: "",
  NOTION_NEWS_TOPICS_DS: "",

  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "gpt-5.4-nano",
  GEMINI_API_KEY: "",
  GEMINI_MODEL: "gemini-3.1-flash-lite",
};

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(['"]).*\1$/.test(value)) {
      value = value.slice(1, -1);                    // quoted: keep as-is (allows #)
    } else {
      value = value.replace(/\s+#.*$/, "").trim();   // unquoted: strip trailing comment
    }
    out[m[1]] = value;
  }
  return out;
}

const Config = {
  values: { ...CONFIG_DEFAULTS },
  loadedEnv: false,

  ready: null,

  get(key) {
    const v = this.values[key];
    return v == null ? "" : String(v);
  },

  int(key, fallback) {
    const n = parseInt(this.get(key), 10);
    return Number.isFinite(n) ? n : fallback;
  },
};

Config.ready = (async () => {
  try {
    const res = await fetch(chrome.runtime.getURL(".env"), { cache: "no-store" });
    if (res.ok) {
      const parsed = parseEnv(await res.text());
      for (const [k, v] of Object.entries(parsed)) if (v !== "") Config.values[k] = v;
      Config.loadedEnv = true;
    }
  } catch {
    // No .env yet: defaults apply.
  }
})();
