// Minimal Notion API client for ZogPanel.
// Token: the one saved in the dashboard's Settings (this browser only) wins;
// otherwise NOTION_TOKEN from .env is used.

// Data source IDs come from .env (see config.js / .env.example).
const NOTION_DEFAULTS = {
  get shortcuts() { return Config.get("NOTION_SHORTCUTS_DS"); },
  get tasks() { return Config.get("NOTION_TASKS_DS"); },
  get projects() { return Config.get("NOTION_PROJECTS_DS"); },
  get newsTopics() { return Config.get("NOTION_NEWS_TOPICS_DS"); },
};

const Notion = {
  async token() {
    const { notionToken = "" } = await chrome.storage.local.get("notionToken");
    return notionToken.trim() || Config.get("NOTION_TOKEN").trim();
  },

  async setToken(value) {
    await chrome.storage.local.set({ notionToken: (value || "").trim() });
  },

  async request(path, { method = "GET", body } = {}) {
    const token = await this.token();
    if (!token) throw new Error("NO_TOKEN");
    if (/data_sources\/(\/|$)/.test(path)) {
      const err = new Error("Missing Notion data source ID in .env");
      err.code = "NO_DS";
      throw err;
    }
    const res = await fetch("https://api.notion.com/v1/" + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Notion-Version": Config.get("NOTION_VERSION") || "2025-09-03",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `Notion error ${res.status}`);
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  },

  // Query every row of a data source (follows pagination).
  async queryAll(dataSourceId, body = {}) {
    const rows = [];
    let cursor;
    do {
      const page = await this.request(`data_sources/${dataSourceId}/query`, {
        method: "POST",
        body: { page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) },
      });
      rows.push(...page.results);
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
    return rows;
  },

  createPage(dataSourceId, properties) {
    return this.request("pages", {
      method: "POST",
      body: { parent: { type: "data_source_id", data_source_id: dataSourceId }, properties },
    });
  },

  updatePage(pageId, properties) {
    return this.request(`pages/${pageId}`, { method: "PATCH", body: { properties } });
  },

  async trashPage(pageId) {
    try {
      return await this.request(`pages/${pageId}`, { method: "PATCH", body: { in_trash: true } });
    } catch (e) {
      if (e.status === 400) return this.request(`pages/${pageId}`, { method: "PATCH", body: { archived: true } });
      throw e;
    }
  },

  // Property helpers
  plain(prop) {
    if (!prop) return "";
    if (prop.type === "title") return prop.title.map((t) => t.plain_text).join("");
    if (prop.type === "rich_text") return prop.rich_text.map((t) => t.plain_text).join("");
    if (prop.type === "url") return prop.url || "";
    if (prop.type === "number") return prop.number;
    return "";
  },
  title: (text) => ({ title: [{ type: "text", text: { content: text } }] }),
  url: (u) => ({ url: u || null }),
  number: (n) => ({ number: n }),
};
