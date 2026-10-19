// ZogPanel assistant: turns plain-language requests into Notion changes.
// Provider is set in .env: AI_PROVIDER=openai (default) or gemini.
// One AI call per message; the actual Notion writes happen here in code, limited to the tools below.

const AI_TOOLS = [
  {
    name: "create_task",
    description: "Create a task in the user's Notion Tasks database.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short task title" },
        priority: { type: "string", enum: ["High", "Medium", "Low"] },
        due_date: { type: "string", description: "Due date as YYYY-MM-DD" },
        project: { type: "string", description: "Name of an existing project" },
        status: { type: "string", enum: ["To Do", "In Progress"] },
        notes: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_task",
    description: "Change an existing task: rename it, set priority, due date, project, notes, or status (use status Done to complete it).",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "Current name of the task to change" },
        new_name: { type: "string" },
        priority: { type: "string", enum: ["High", "Medium", "Low"] },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        project: { type: "string" },
        status: { type: "string", enum: ["To Do", "In Progress", "Done"] },
        notes: { type: "string" },
      },
      required: ["task"],
    },
  },
  {
    name: "create_project",
    description: "Create a project in the user's Notion Projects database.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        priority: { type: "string", enum: ["High", "Medium", "Low"] },
        target_date: { type: "string", description: "YYYY-MM-DD" },
        status: { type: "string", enum: ["Planning", "Active", "On Hold"] },
        description: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "add_news_topic",
    description: "Add a topic to follow in the user's News Topics database.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string" },
        keywords: { type: "string", description: "Optional extra search terms" },
      },
      required: ["topic"],
    },
  },
  {
    name: "add_shortcut",
    description: "Add a website shortcut to the dashboard.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        url: { type: "string" },
      },
      required: ["name", "url"],
    },
  },
];

let chatHistory = [];   // [{ role: "user" | "assistant", text }]
let chatBusy = false;

// ---------- provider plumbing ----------
function aiProvider() {
  return (Config.get("AI_PROVIDER") || "openai").toLowerCase() === "gemini" ? "gemini" : "openai";
}

function aiReady() {
  return aiProvider() === "gemini" ? !!Config.get("GEMINI_API_KEY") : !!Config.get("OPENAI_API_KEY");
}

function systemPrompt() {
  const now = new Date();
  const today = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const projects = workProjects.filter((p) => p.status !== "Done").map((p) => p.name);
  const tasks = workTasks.filter((t) => t.status !== "Done").slice(0, 40).map((t) => t.name);
  return [
    "You are the assistant inside ZogPanel, a personal dashboard. Your only job is to add or update items in the user's Notion: tasks, projects, news topics and website shortcuts, by calling the provided tools.",
    `Today is ${today} (${iso}). Convert relative dates like "Friday" or "next week" to YYYY-MM-DD.`,
    `Existing projects: ${projects.length ? projects.join("; ") : "none"}.`,
    `Open tasks: ${tasks.length ? tasks.join("; ") : "none"}.`,
    "Use exact names from these lists when referring to existing items. You may call several tools at once.",
    "If a request is unclear, ask one short question. If it isn't about these items, say briefly what you can do. Never invent tools. Keep any text reply to one sentence.",
  ].join("\n");
}

async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + Config.get("OPENAI_API_KEY") },
    body: JSON.stringify({
      model: Config.get("OPENAI_MODEL") || "gpt-5.4-nano",
      messages: [{ role: "system", content: systemPrompt() }, ...messages.map((m) => ({ role: m.role, content: m.text }))],
      tools: AI_TOOLS.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `OpenAI error ${res.status}`);
  const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
  const calls = (msg.tool_calls || []).map((c) => {
    let args = {};
    try { args = JSON.parse(c.function.arguments || "{}"); } catch {}
    return { name: c.function.name, args };
  });
  return { text: msg.content || "", calls };
}

async function callGemini(messages) {
  const model = Config.get("GEMINI_MODEL") || "gemini-3.1-flash-lite";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": Config.get("GEMINI_API_KEY") },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] })),
      tools: [{ functionDeclarations: AI_TOOLS.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `Gemini error ${res.status}`);
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return {
    text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim(),
    calls: parts.filter((p) => p.functionCall).map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} })),
  };
}

// ---------- matching names to Notion rows ----------
function findByName(list, name) {
  const q = (name || "").trim().toLowerCase();
  if (!q) return { item: null };
  const exact = list.filter((x) => x.name.toLowerCase() === q);
  if (exact.length === 1) return { item: exact[0] };
  const partial = list.filter((x) => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase()));
  if (partial.length === 1) return { item: partial[0] };
  return { item: null, ambiguous: partial.length > 1 ? partial.map((x) => x.name) : null };
}

const isoDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : null);
const rich = (text) => ({ rich_text: [{ type: "text", text: { content: String(text).slice(0, 1900) } }] });

function shortDate(iso) {
  const d = parseDay(iso);
  return d ? d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
}

// ---------- tool execution (the only things the AI can do) ----------
async function runTool({ name, args }) {
  switch (name) {
    case "create_task": {
      if (!NOTION_DEFAULTS.tasks) throw new Error("NOTION_TASKS_DS isn't set");
      const props = { Name: Notion.title(args.name), Status: { status: { name: args.status === "In Progress" ? "In Progress" : "To Do" } } };
      const bits = [];
      if (["High", "Medium", "Low"].includes(args.priority)) { props.Priority = { select: { name: args.priority } }; bits.push(args.priority); }
      if (isoDate(args.due_date)) { props["Due Date"] = { date: { start: args.due_date } }; bits.push("due " + shortDate(args.due_date)); }
      let note = "";
      if (args.project) {
        const { item } = findByName(workProjects, args.project);
        if (item) { props.Project = { relation: [{ id: item.id }] }; bits.push(item.name); }
        else note = ` (no project named "${args.project}", so it isn't linked)`;
      }
      if (args.notes) props.Notes = rich(args.notes);
      await Notion.createPage(NOTION_DEFAULTS.tasks, props);
      return `Added task “${args.name}”${bits.length ? " · " + bits.join(" · ") : ""}${note}`;
    }

    case "update_task": {
      const { item, ambiguous } = findByName(workTasks, args.task);
      if (!item) return ambiguous ? `Which task did you mean: ${ambiguous.join(", ")}?` : `I couldn't find a task called “${args.task}”.`;
      const props = {};
      const bits = [];
      if (args.new_name) { props.Name = Notion.title(args.new_name); bits.push(`renamed to “${args.new_name}”`); }
      if (["High", "Medium", "Low"].includes(args.priority)) { props.Priority = { select: { name: args.priority } }; bits.push(args.priority + " priority"); }
      if (isoDate(args.due_date)) { props["Due Date"] = { date: { start: args.due_date } }; bits.push("due " + shortDate(args.due_date)); }
      if (["To Do", "In Progress", "Done"].includes(args.status)) { props.Status = { status: { name: args.status } }; bits.push(args.status === "Done" ? "marked done" : args.status); }
      if (args.notes) { props.Notes = rich(args.notes); bits.push("notes updated"); }
      if (args.project) {
        const p = findByName(workProjects, args.project).item;
        if (p) { props.Project = { relation: [{ id: p.id }] }; bits.push("moved to " + p.name); }
        else bits.push(`no project named “${args.project}”`);
      }
      if (!Object.keys(props).length) return `Nothing to change on “${item.name}”.`;
      await Notion.updatePage(item.id, props);
      return `Updated “${item.name}”: ${bits.join(", ")}`;
    }

    case "create_project": {
      if (!NOTION_DEFAULTS.projects) throw new Error("NOTION_PROJECTS_DS isn't set");
      const status = ["Planning", "Active", "On Hold"].includes(args.status) ? args.status : "Planning";
      const props = { Name: Notion.title(args.name), Status: { status: { name: status } } };
      const bits = [status];
      if (["High", "Medium", "Low"].includes(args.priority)) { props.Priority = { select: { name: args.priority } }; bits.push(args.priority); }
      if (isoDate(args.target_date)) { props["Target Date"] = { date: { start: args.target_date } }; bits.push("target " + shortDate(args.target_date)); }
      if (args.description) props.Description = rich(args.description);
      await Notion.createPage(NOTION_DEFAULTS.projects, props);
      return `Created project “${args.name}” · ${bits.join(" · ")}`;
    }

    case "add_news_topic": {
      if (!NOTION_DEFAULTS.newsTopics) throw new Error("NOTION_NEWS_TOPICS_DS isn't set");
      const props = { Topic: Notion.title(args.topic), Active: { checkbox: true } };
      if (args.keywords) props.Keywords = rich(args.keywords);
      await Notion.createPage(NOTION_DEFAULTS.newsTopics, props);
      return `Now following news on “${args.topic}”`;
    }

    case "add_shortcut": {
      const url = normalizeUrl(args.url || "");
      if (!url) return `“${args.url}” doesn't look like a web address.`;
      await addShortcut(args.name || hostOf(url), url);
      return `Added shortcut “${args.name || hostOf(url)}”`;
    }

    default:
      return `I can't do “${name}”.`;
  }
}

// ---------- chat UI ----------
function renderChat() {
  const log = $("#chatLog");
  log.replaceChildren();
  if (!chatHistory.length) {
    log.append(el("div", { class: "bubble bot", text: aiReady()
      ? "Tell me what to add or change. For example: “Add a high-priority task to finish the deck by Friday under Website.”"
      : `Add ${aiProvider() === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"} to your .env file, then reload the extension.` }));
  }
  for (const m of chatHistory) {
    log.append(el("div", { class: "bubble " + (m.role === "user" ? "me" : m.error ? "bot error" : "bot"), text: m.text }));
  }
  if (chatBusy) log.append(el("div", { class: "bubble bot typing", "aria-label": "Working", text: "…" }));
  log.scrollTop = log.scrollHeight;
}

async function saveChat() {
  chatHistory = chatHistory.slice(-30);
  await chrome.storage.local.set({ chatHistory });
}

async function sendChat(text) {
  chatHistory.push({ role: "user", text });
  chatBusy = true;
  renderChat();

  let reply = "", isError = false, wroteSomething = false;
  try {
    const recent = chatHistory.filter((m) => !m.error).slice(-8);
    const { text: aiText, calls } = aiProvider() === "gemini" ? await callGemini(recent) : await callOpenAI(recent);
    if (calls.length) {
      const results = [];
      for (const call of calls) {
        try {
          results.push(await runTool(call));
          if (call.name !== "add_shortcut") wroteSomething = true;
        } catch (e) {
          results.push(`Couldn't do that in Notion: ${e.message}`);
          isError = true;
        }
      }
      reply = results.join("\n");
    } else {
      reply = aiText || "Sorry, I didn't get that. I can add tasks, projects, news topics and shortcuts.";
    }
  } catch (e) {
    console.error("ZogPanel assistant", e);
    reply = "The AI request failed: " + e.message;
    isError = true;
  }

  chatBusy = false;
  chatHistory.push({ role: "assistant", text: reply, error: isError || undefined });
  renderChat();
  await saveChat();
  if (wroteSomething) pullWork();
}

async function initAssistant() {
  const { chatHistory: saved } = await chrome.storage.local.get("chatHistory");
  if (Array.isArray(saved)) chatHistory = saved;

  const ready = aiReady();
  $("#chatInput").disabled = !ready;
  $("#chatSend").disabled = !ready;
  $("#chatProvider").textContent = (aiProvider() === "gemini" ? "Gemini" : "ChatGPT") + " → Notion";
  renderChat();

  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#chatInput");
    const text = input.value.trim();
    if (!text || chatBusy) return;
    input.value = "";
    sendChat(text);
  });

  $("#chatClear").addEventListener("click", async () => {
    chatHistory = [];
    renderChat();
    await saveChat();
  });
}
