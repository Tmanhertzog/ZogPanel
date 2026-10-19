// ZogPanel news: headlines for your Notion "News Topics", picked and summarized by AI.
// Cheap by design: headlines come from free Google News RSS feeds, then ONE small AI
// call ranks and summarizes all topics together. Results are cached between refreshes.

let newsItems = [];        // [{ topic, title, url, source, published, summary }]
let newsTopics = [];       // [{ name, keywords, max }]
let newsFilter = "All";
let newsLoading = false;

// ---------- topics from Notion ----------
async function loadNewsTopics() {
  const rows = await Notion.queryAll(NOTION_DEFAULTS.newsTopics);
  return rows
    .map((r) => {
      const p = r.properties || {};
      return {
        name: Notion.plain(p.Topic).trim(),
        keywords: Notion.plain(p.Keywords).trim(),
        active: !!(p.Active && p.Active.checkbox),
        max: Math.min(Math.max(Number(Notion.plain(p["Max Stories"])) || 3, 1), 10),
      };
    })
    .filter((t) => t.name && t.active);
}

// ---------- headlines: Bing News RSS (images + snippets, best-match order), Google News as fallback ----------
const NEWS_PER_TOPIC = 10;   // stories kept per topic (shown when you filter to that topic)

function newsEdition() {
  return {
    lang: (Config.get("NEWS_LANGUAGE") || "en").toLowerCase(),
    region: (Config.get("NEWS_REGION") || "US").toUpperCase(),
  };
}

function bingFeedUrl(query) {
  const { lang, region } = newsEdition();
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&setlang=${lang}&cc=${region}&count=20`;
}

function googleFeedUrl(query, recentOnly) {
  const { lang, region } = newsEdition();
  const q = recentOnly ? `${query} when:2d` : query;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang}-${region}&gl=${region}&ceid=${region}:${lang}`;
}

// Text of the first child element with this tag name, including namespaced ones like "News:Image".
function tagText(node, ...names) {
  for (const name of names) {
    const found = node.getElementsByTagName(name)[0];
    if (found && found.textContent.trim()) return found.textContent.trim();
  }
  return "";
}

function stripHtml(s) {
  const doc = new DOMParser().parseFromString(`<body>${s}</body>`, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

function cleanLink(link) {
  // Bing wraps links in a click tracker; use the real article URL when it's there.
  try {
    const u = new URL(link);
    if (u.hostname.endsWith("bing.com") && u.searchParams.get("url")) return u.searchParams.get("url");
  } catch {}
  return link;
}

function imageUrl(raw) {
  if (!raw) return "";
  let u = raw.replace(/^http:\/\//i, "https://");
  if (/bing\.com\/th\?/.test(u) && !/[?&]w=/.test(u)) u += "&w=240&h=160&c=14";
  return u;
}

async function readFeed(url, topicName) {
  const host = new URL(url).hostname;
  const res = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
  const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
  if (xml.getElementsByTagName("parsererror").length || !xml.getElementsByTagName("channel").length) {
    throw new Error(`${host} didn't return a news feed`);
  }
  return [...xml.getElementsByTagName("item")].slice(0, 20).map((it, idx) => {
    let source = tagText(it, "News:Source", "source");
    let title = tagText(it, "title");
    // Google appends " - Source" to titles; split it off so the source shows separately.
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const snippet = stripHtml(tagText(it, "description"));
    return {
      topic: topicName,
      title: title.trim(),
      url: cleanLink(tagText(it, "link")),
      source,
      published: tagText(it, "pubDate"),
      snippet: snippet && !snippet.startsWith(title.slice(0, 30)) ? snippet.slice(0, 300) : "",
      image: imageUrl(tagText(it, "News:Image")),
      feedRank: idx,
      summary: "",
    };
  }).filter((i) => i.title && /^https?:\/\//.test(i.url));
}

async function fetchHeadlines(topic) {
  const query = topic.keywords || topic.name;
  const attempts = [
    () => readFeed(bingFeedUrl(query), topic.name),
    () => readFeed(googleFeedUrl(query, true), topic.name),
    () => readFeed(googleFeedUrl(query, false), topic.name),
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const items = await attempt();
      if (items.length) return items;
    } catch (e) {
      errors.push(e.message);
    }
  }
  const err = new Error(errors.length ? errors[errors.length - 1] : "no stories found");
  err.empty = !errors.length;
  throw err;
}

// ---------- AI: rank and summarize, one small call per topic (run in parallel) ----------
async function aiJson(system, user) {
  let raw = "";
  if (aiProvider() === "gemini") {
    const model = Config.get("GEMINI_MODEL") || "gemini-3.1-flash-lite";
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": Config.get("GEMINI_API_KEY") },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || `Gemini error ${res.status}`);
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    raw = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  } else {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + Config.get("OPENAI_API_KEY") },
      body: JSON.stringify({
        model: Config.get("OPENAI_MODEL") || "gpt-5.4-nano",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || `OpenAI error ${res.status}`);
    raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  }
  return JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
}

async function aiPickTopic({ topic, items }) {
  const candidates = items.slice(0, 15);
  const system = [
    `You curate news about one topic: "${topic.name}"${topic.keywords && topic.keywords.toLowerCase() !== topic.name.toLowerCase() ? ` (keywords: ${topic.keywords})` : ""}.`,
    `Rank the best-matching stories: most relevant to the topic and most important first. Drop duplicates and near-duplicates about the same event, and drop stories that don't really match the topic. Keep up to ${NEWS_PER_TOPIC}.`,
    "Give each kept story a score from 1 to 100 for how well it matches the topic and how important it is.",
    "For each kept story write one plain sentence (max 25 words) saying what happened, using only the headline and snippet. Do not add facts, numbers or opinions that aren't there.",
    'Reply with JSON only: {"picks":[{"id":<number>,"score":<1-100>,"summary":"<sentence>"}]}',
  ].join("\n");
  const user = candidates.map((it, idx) =>
    `${idx}: ${it.title}${it.source ? " — " + it.source : ""}${it.snippet ? "\n   " + it.snippet.slice(0, 200) : ""}`).join("\n");

  const parsed = await aiJson(system, user);
  const out = [];
  const used = new Set();
  for (const pick of parsed.picks || []) {
    const id = Number(pick.id);
    const item = candidates[id];
    if (!item || used.has(id) || out.length >= NEWS_PER_TOPIC) continue;
    used.add(id);
    out.push({ ...item, score: Math.max(1, Math.min(100, Number(pick.score) || 50)), summary: String(pick.summary || "").trim() });
  }
  return out;
}

// Feed order is already "best match": use it when AI isn't available or fails for a topic.
function feedOrderPicks({ items }) {
  return items.slice(0, NEWS_PER_TOPIC).map((it) => ({ ...it, score: Math.max(1, 70 - it.feedRank * 5) }));
}

async function aiPickNews(groups) {
  let failures = 0;
  const results = await Promise.all(groups.map(async (g) => {
    try {
      const picks = await aiPickTopic(g);
      if (picks.length) return picks;
    } catch (e) {
      console.warn("ZogPanel news AI", g.topic.name, e);
      failures++;
    }
    return feedOrderPicks(g);
  }));
  return { picked: results.flat(), failures };
}

// ---------- refresh ----------
function newsMaxAgeMs() {
  const h = parseFloat(Config.get("NEWS_REFRESH_HOURS"));
  return (Number.isFinite(h) && h > 0 ? h : 3) * 3600 * 1000;
}

async function loadNews({ force = false } = {}) {
  const token = await Notion.token();
  if (!token || !NOTION_DEFAULTS.newsTopics) {
    setNewsStatus("");
    $("#newsList").replaceChildren(el("p", { class: "placeholder", text: !token ? "Connect Notion in Settings to see news for your topics." : "Add NOTION_NEWS_TOPICS_DS to .env." }));
    return;
  }

  const { newsCache2: newsCache } = await chrome.storage.local.get("newsCache2");
  if (newsCache && newsCache.items) {
    newsItems = newsCache.items;
    newsTopics = newsCache.topics || [];
    renderNews(newsCache.at);
  }
  // An empty result never counts as fresh, so a failed or empty load retries next time.
  const stale = !newsCache || !(newsCache.items || []).length || Date.now() - (newsCache.at || 0) > newsMaxAgeMs();
  if (force || stale) await refreshNews();
}

async function refreshNews() {
  if (newsLoading) return;
  newsLoading = true;
  setNewsStatus("Updating…");
  $("#newsRefresh").disabled = true;
  try {
    const topics = await loadNewsTopics();
    if (!topics.length) {
      newsItems = []; newsTopics = [];
      await chrome.storage.local.set({ newsCache2: { at: Date.now(), items: [], topics: [] } });
      renderNews(Date.now());
      return;
    }

    const groups = [];
    const feedErrors = [];
    await Promise.all(topics.map(async (t) => {
      try { groups.push({ topic: t, items: await fetchHeadlines(t) }); }
      catch (e) { console.warn("ZogPanel news feed", t.name, e); feedErrors.push({ topic: t.name, msg: e.message, empty: e.empty }); }
    }));
    groups.sort((a, b) => topics.indexOf(a.topic) - topics.indexOf(b.topic));
    const withItems = groups.filter((g) => g.items.length);

    if (!withItems.length && feedErrors.some((f) => !f.empty)) {
      // Every feed failed: keep whatever we showed before and say why (don't cache the failure).
      newsTopics = topics;
      renderNews();
      setNewsStatus("Couldn't load headlines: " + feedErrors[0].msg, true);
      return;
    }

    let picked;
    let aiNote = "";
    if (aiReady()) {
      const r = await aiPickNews(withItems);
      picked = r.picked;
      if (r.failures) aiNote = r.failures === withItems.length ? " · AI summary unavailable" : ` · AI skipped ${r.failures} topic${r.failures > 1 ? "s" : ""}`;
    } else {
      picked = withItems.flatMap(feedOrderPicks);
    }

    newsItems = picked;
    newsTopics = topics;
    const at = Date.now();
    await chrome.storage.local.set({ newsCache2: { at, items: newsItems, topics: newsTopics } });
    const failed = feedErrors.filter((f) => !f.empty).map((f) => f.topic);
    renderNews(at, aiNote + (failed.length ? ` · couldn't load ${failed.join(", ")}` : ""));
  } catch (e) {
    console.error("ZogPanel news", e);
    setNewsStatus(e.status === 404 ? "Notion can't see News Topics · see Settings" : "Couldn't update news: " + e.message, true);
  } finally {
    newsLoading = false;
    $("#newsRefresh").disabled = false;
  }
}

// ---------- rendering ----------
function setNewsStatus(text, isError = false) {
  const s = $("#newsStatus");
  s.textContent = text;
  s.classList.toggle("error", isError);
}

function timeAgo(when) {
  const t = typeof when === "number" ? when : Date.parse(when);
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function renderNews(at, note = "") {
  if (at) setNewsStatus("Updated " + timeAgo(at) + note);

  // Topic filter chips
  const chips = $("#newsTopics");
  chips.replaceChildren();
  const names = ["All", ...newsTopics.map((t) => t.name)];
  if (!names.includes(newsFilter)) newsFilter = "All";
  if (newsTopics.length > 1) {
    for (const n of names) {
      const b = el("button", { type: "button", class: "tab" + (n === newsFilter ? " active" : ""), text: n, "aria-pressed": String(n === newsFilter) });
      b.addEventListener("click", () => { newsFilter = n; renderNews(); });
      chips.append(b);
    }
  }

  const list = $("#newsList");
  list.replaceChildren();
  const byScore = (a, b) => (b.score || 0) - (a.score || 0);
  let shown;
  if (newsFilter === "All") {
    const perTopic = Config.int("NEWS_ALL_PER_TOPIC", 1);
    shown = newsTopics.flatMap((t) => newsItems.filter((i) => i.topic === t.name).sort(byScore).slice(0, perTopic));
    // Items from topics no longer in the list (shouldn't happen, but keep them visible)
    if (!newsTopics.length) shown = newsItems.slice();
    shown.sort(byScore);
  } else {
    shown = newsItems.filter((i) => i.topic === newsFilter).sort(byScore).slice(0, NEWS_PER_TOPIC);
  }

  if (!shown.length) {
    list.append(el("p", { class: "placeholder", text: newsTopics.length
      ? "No recent stories for your topics."
      : "No active topics. Add one in Notion's News Topics, or ask the assistant to follow a topic." }));
    return;
  }
  for (const it of shown) {
    const meta = [it.source, timeAgo(it.published)].filter(Boolean).join(" · ");
    const text = el("div", { class: "news-text" }, [
      newsTopics.length > 1 && newsFilter === "All" ? el("span", { class: "news-topic", text: it.topic }) : null,
      el("span", { class: "news-title", text: it.title }),
      it.summary ? el("span", { class: "news-summary", text: it.summary }) : null,
      meta ? el("span", { class: "news-meta", text: meta }) : null,
    ]);
    let img = null;
    if (it.image) {
      img = el("img", { class: "news-thumb", src: it.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
      img.addEventListener("error", () => img.remove());
    }
    list.append(el("a", { class: "news-item" + (img ? " has-thumb" : ""), href: it.url, target: "_blank", rel: "noopener" }, [text, img]));
  }
}

function initNews() {
  $("#newsRefresh").addEventListener("click", () => refreshNews());
}
