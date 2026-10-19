// ZogPanel: Tasks and Projects from Notion.
// Reads both databases in one pass so project progress can be counted from tasks.

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
const PROJECT_STATUS_RANK = { Active: 0, Planning: 1, "On Hold": 2 };
const DONE = "Done";

let workTasks = [];     // all tasks, including done ones
let workProjects = [];  // all projects
let workLoading = false;
let workEnabled = false;

// ---------- reading Notion rows ----------
function readTask(r) {
  const p = r.properties || {};
  return {
    id: r.id,
    url: r.url,
    name: Notion.plain(p.Name) || "Untitled",
    status: (p.Status && p.Status.status && p.Status.status.name) || "To Do",
    priority: (p.Priority && p.Priority.select && p.Priority.select.name) || "",
    due: (p["Due Date"] && p["Due Date"].date && p["Due Date"].date.start) || "",
    projectIds: ((p.Project && p.Project.relation) || []).map((x) => x.id),
  };
}

function readProject(r) {
  const p = r.properties || {};
  return {
    id: r.id,
    url: r.url,
    name: Notion.plain(p.Name) || "Untitled",
    status: (p.Status && p.Status.status && p.Status.status.name) || "",
    priority: (p.Priority && p.Priority.select && p.Priority.select.name) || "",
    target: (p["Target Date"] && p["Target Date"].date && p["Target Date"].date.start) || "",
  };
}

const sameId = (a, b) => a.replace(/-/g, "") === b.replace(/-/g, "");

// ---------- dates ----------
function parseDay(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dueLabel(iso) {
  const day = parseDay(iso);
  if (!day) return { text: "", overdue: false };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400000);
  if (diff < 0) return { text: diff === -1 ? "Overdue · yesterday" : `Overdue · ${-diff} days`, overdue: true };
  if (diff === 0) return { text: "Due today", overdue: false, soon: true };
  if (diff === 1) return { text: "Due tomorrow", overdue: false, soon: true };
  if (diff < 7) return { text: "Due " + day.toLocaleDateString([], { weekday: "short" }), overdue: false };
  return { text: "Due " + day.toLocaleDateString([], { month: "short", day: "numeric" }), overdue: false };
}

// ---------- loading ----------
async function loadWork({ fromCache = true } = {}) {
  const token = await Notion.token();
  if (!token || !NOTION_DEFAULTS.tasks || !NOTION_DEFAULTS.projects) {
    const why = !token ? "Connect Notion in Settings to see your tasks." : "Add NOTION_TASKS_DS and NOTION_PROJECTS_DS to .env.";
    $("#taskList").replaceChildren(el("p", { class: "placeholder", text: why }));
    $("#projectList").replaceChildren(el("p", { class: "placeholder", text: why }));
    $("#taskAdd").hidden = true;
    workEnabled = false;
    return;
  }
  workEnabled = true;
  $("#taskAdd").hidden = false;

  if (fromCache) {
    const { workCache } = await chrome.storage.local.get("workCache");
    if (workCache) {
      workTasks = workCache.tasks || [];
      workProjects = workCache.projects || [];
      renderWork();
    }
  }
  await pullWork();
}

async function pullWork() {
  if (workLoading) return;
  workLoading = true;
  setWorkStatus("Syncing…");
  try {
    const [taskRows, projectRows] = await Promise.all([
      Notion.queryAll(NOTION_DEFAULTS.tasks),
      Notion.queryAll(NOTION_DEFAULTS.projects),
    ]);
    workTasks = taskRows.map(readTask);
    workProjects = projectRows.map(readProject);
    await chrome.storage.local.set({ workCache: { tasks: workTasks, projects: workProjects } });
    renderWork();
    setWorkStatus("");
  } catch (e) {
    console.error("ZogPanel: tasks/projects", e);
    if (e.status === 404) {
      // Try finding the databases by name (same as Shortcuts).
      await Promise.all([Notion.rediscover("tasks"), Notion.rediscover("projects")]).catch(() => {});
    }
    setWorkStatus(e.status === 404 ? "Notion can't see Tasks/Projects · see Settings" : "Notion unavailable · showing saved copy", true);
    if (!workTasks.length && !workProjects.length) renderWork();
  } finally {
    workLoading = false;
  }
}

function setWorkStatus(text, isError = false) {
  for (const id of ["#taskStatus", "#projectStatus"]) {
    const s = $(id);
    s.textContent = text;
    s.classList.toggle("error", isError);
  }
}

// ---------- rendering ----------
function projectName(id) {
  const p = workProjects.find((x) => sameId(x.id, id));
  return p ? p.name : "";
}

function sortTasks(list) {
  return list.slice().sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 3, pb = PRIORITY_RANK[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    const da = a.due || "9999", db = b.due || "9999";
    if (da !== db) return da < db ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function renderWork() {
  renderTasks();
  renderProjects();
}

function renderTasks() {
  const box = $("#taskList");
  box.replaceChildren();
  const open = sortTasks(workTasks.filter((t) => t.status !== DONE));
  $("#taskCount").textContent = open.length ? String(open.length) : "";

  if (!open.length) {
    box.append(el("p", { class: "placeholder", text: "Nothing open. Add a task below or in Notion." }));
    return;
  }

  for (const t of open) {
    const due = dueLabel(t.due);
    const proj = t.projectIds.map(projectName).filter(Boolean).join(", ");
    const metaParts = [proj, due.text].filter(Boolean);

    const check = el("button", {
      class: "task-check", type: "button", role: "checkbox", "aria-checked": "false",
      "aria-label": `Mark "${t.name}" done`,
    });
    check.addEventListener("click", () => completeTask(t, row, check));

    const meta = el("span", { class: "task-meta" });
    if (proj) meta.append(el("span", { text: proj }));
    if (proj && due.text) meta.append(document.createTextNode(" · "));
    if (due.text) meta.append(el("span", { class: due.overdue ? "due overdue" : due.soon ? "due soon" : "due", text: due.text }));
    if (!metaParts.length) meta.append(el("span", { text: "No project · no date" }));

    const body = el("div", { class: "task-body" }, [
      el("a", { class: "task-name", href: t.url, target: "_blank", rel: "noopener", title: "Open in Notion", text: t.name }),
      meta,
    ]);

    const tags = el("div", { class: "task-tags" });
    if (t.status === "In Progress") tags.append(el("span", { class: "chip chip-progress", text: "In progress" }));
    if (t.priority) tags.append(el("span", { class: "chip chip-" + t.priority.toLowerCase(), text: t.priority }));

    const row = el("div", { class: "task-row" }, [check, body, tags]);
    box.append(row);
  }
}

function renderProjects() {
  const box = $("#projectList");
  box.replaceChildren();
  const active = workProjects
    .filter((p) => p.status !== DONE)
    .sort((a, b) =>
      (PROJECT_STATUS_RANK[a.status] ?? 3) - (PROJECT_STATUS_RANK[b.status] ?? 3) ||
      (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) ||
      a.name.localeCompare(b.name));

  if (!active.length) {
    box.append(el("p", { class: "placeholder", text: "No open projects." }));
    return;
  }

  for (const p of active) {
    const tasks = workTasks.filter((t) => t.projectIds.some((id) => sameId(id, p.id)));
    const done = tasks.filter((t) => t.status === DONE).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const target = p.target ? "Target " + parseDay(p.target).toLocaleDateString([], { month: "short", day: "numeric" }) : "";

    const bar = el("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": `${p.name} progress` });
    const fill = el("div", { class: "bar-fill" });
    fill.style.width = pct + "%";
    bar.append(fill);

    box.append(el("div", { class: "project" }, [
      el("div", { class: "project-top" }, [
        el("a", { class: "project-name", href: p.url, target: "_blank", rel: "noopener", title: "Open in Notion", text: p.name }),
        p.status ? el("span", { class: "chip chip-status chip-" + p.status.toLowerCase().replace(/\s+/g, "-"), text: p.status }) : null,
      ]),
      bar,
      el("div", { class: "project-meta" }, [
        el("span", { text: tasks.length ? `${done} of ${tasks.length} tasks` : "No tasks yet" }),
        target ? el("span", { text: target }) : null,
      ]),
    ]));
  }
}

// ---------- actions ----------
async function completeTask(task, row, check) {
  check.setAttribute("aria-checked", "true");
  row.classList.add("done");
  const before = task.status;
  task.status = DONE;
  try {
    await Notion.updatePage(task.id, { Status: { status: { name: DONE } } });
    await chrome.storage.local.set({ workCache: { tasks: workTasks, projects: workProjects } });
    setTimeout(renderWork, 700);
    toastWithUndo(`Done: ${task.name}`, async () => {
      task.status = before;
      renderWork();
      try { await Notion.updatePage(task.id, { Status: { status: { name: before } } }); }
      catch (e) { toast("Couldn't undo in Notion: " + e.message); pullWork(); }
    });
  } catch (e) {
    task.status = before;
    row.classList.remove("done");
    check.setAttribute("aria-checked", "false");
    toast("Couldn't update Notion: " + e.message);
  }
}

async function addTask(name) {
  const temp = { id: "temp-" + Date.now(), url: "#", name, status: "To Do", priority: "", due: "", projectIds: [] };
  workTasks.push(temp);
  renderTasks();
  try {
    const page = await Notion.createPage(NOTION_DEFAULTS.tasks, {
      Name: Notion.title(name),
      Status: { status: { name: "To Do" } },
    });
    Object.assign(temp, readTask(page));
    await chrome.storage.local.set({ workCache: { tasks: workTasks, projects: workProjects } });
    renderTasks();
  } catch (e) {
    workTasks = workTasks.filter((t) => t !== temp);
    renderTasks();
    toast("Couldn't add task: " + e.message);
  }
}

function toastWithUndo(message, onUndo) {
  const t = $("#toast");
  t.replaceChildren(el("span", { text: message }));
  const btn = el("button", { class: "toast-action", type: "button", text: "Undo" });
  btn.addEventListener("click", () => { t.hidden = true; onUndo(); });
  t.append(btn);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 6000);
}

function initWork() {
  $("#taskAdd").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#taskAddInput");
    const name = input.value.trim();
    if (!name) return;
    input.value = "";
    addTask(name);
  });

  // Pick up changes made in Notion when you come back to the tab.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && workEnabled) pullWork();
  });
}
