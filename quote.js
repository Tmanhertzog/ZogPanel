// Motivated theme: a quote of the day, picked by AI to fit MOTIVATED_QUOTE_THEME in .env.
// One small AI call per day (only when the Motivated theme is shown). Falls back to
// MOTIVATED_QUOTE / MOTIVATED_QUOTE_AUTHOR when there's no AI key or the call fails.

let quoteLoading = false;

function localDayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function showQuote(text, author) {
  if (!text) return;
  $(".quote blockquote").textContent = `“${String(text).trim().replace(/^[“"']+|[”"']+$/g, "")}”`;
  $(".quote figcaption").textContent = author || "";
  $(".quote figcaption").hidden = !author;
}

function fallbackQuote() {
  showQuote(Config.get("MOTIVATED_QUOTE"), Config.get("MOTIVATED_QUOTE_AUTHOR"));
}

// Show today's saved quote right away (or the .env fallback), without calling the AI.
async function applyQuote() {
  const theme = Config.get("MOTIVATED_QUOTE_THEME");
  const { dailyQuote } = await chrome.storage.local.get("dailyQuote");
  if (dailyQuote && dailyQuote.quote && dailyQuote.theme === theme) showQuote(dailyQuote.quote, dailyQuote.author);
  else fallbackQuote();
}

// Fetch a new quote if today's hasn't been fetched yet (or the theme in .env changed).
async function ensureDailyQuote() {
  const theme = Config.get("MOTIVATED_QUOTE_THEME").trim();
  if (!theme || !aiReady() || quoteLoading) return;

  const today = localDayKey();
  const { dailyQuote, quoteHistory = [] } = await chrome.storage.local.get(["dailyQuote", "quoteHistory"]);
  if (dailyQuote && dailyQuote.date === today && dailyQuote.theme === theme && dailyQuote.quote) {
    showQuote(dailyQuote.quote, dailyQuote.author);
    return;
  }

  quoteLoading = true;
  try {
    const recent = quoteHistory.slice(-30);
    const system = [
      "You pick one real quotation for a personal dashboard's quote of the day.",
      `Theme: ${theme}.`,
      "Choose a genuine quote by a real, named person (historical figures, leaders, athletes, writers, founders, philosophers). Prefer quotes with well-established attribution; avoid famous misattributions and quotes of doubtful origin.",
      "Keep it under 30 words. Vary the people over time.",
      recent.length ? `Don't repeat any of these recent quotes: ${recent.map((q) => `"${q}"`).join("; ")}` : "",
      'Reply with JSON only: {"quote":"<the quote, no surrounding quotation marks>","author":"<full name>"}',
    ].filter(Boolean).join("\n");
    const result = await aiJson(system, `Today's date: ${today}. Give today's quote.`);
    const quote = String(result.quote || "").trim();
    const author = String(result.author || "").trim();
    if (!quote) throw new Error("empty quote");

    await chrome.storage.local.set({
      dailyQuote: { date: today, theme, quote, author },
      quoteHistory: [...quoteHistory, quote].slice(-60),
    });
    showQuote(quote, author);
  } catch (e) {
    console.warn("ZogPanel quote of the day", e);
    // Keep whatever is showing (yesterday's quote or the .env fallback); try again next load.
  } finally {
    quoteLoading = false;
  }
}

// Only spend the AI call when the Motivated theme is actually on screen.
function maybeRefreshQuote() {
  if (document.documentElement.getAttribute("data-theme") === "motivated") ensureDailyQuote();
}
