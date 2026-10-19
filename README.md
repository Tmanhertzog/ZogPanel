# ZogPanel

A personal dashboard for Chrome that opens once when the browser starts. It shows your shortcuts, bookmarks, tasks, projects and news, with a search bar that can switch to an AI assistant. Tasks, projects, shortcuts and news topics live in Notion.

## Features

- Opens once when Chrome starts, or replaces every new tab (your choice in Settings); also from the toolbar icon
- Three themes: **Basic** (random photo backdrop), **Motivated** (dark, electric purple, AI-picked quote of the day), **Chill** (teal)
- Editable shortcuts stored in a Notion database
- Your real Chrome bookmarks, grouped by folder
- Search bar pinned in the bottom third of the screen, with a switch to the AI chat
- Tasks and projects from Notion, with progress and one-click completion
- AI assistant that adds, updates and removes tasks, projects and news topics, and adds shortcuts (OpenAI or Gemini). Removals ask for confirmation; its instructions live in `assistant-instructions.md`
- News for your Notion topics: Google News headlines, picked and summarized by AI

## Setup

1. **Get the code** and open the folder.
2. **Create your config:** copy `.env.example` to `.env` and fill it in (see below).
3. **Add background photos (optional):** put images in `basic_bkg_images/`, then right-click `update-images.ps1` › *Run with PowerShell*. Run it again whenever you add or remove photos.
4. **Load the extension:** go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick this folder.
5. After changing any file, including `.env`, click the reload icon on the ZogPanel card.

## Notion setup

1. In your Notion workspace, create a page (e.g. "ZogPanel") with these databases:

   | Database | Properties |
   | --- | --- |
   | Shortcuts | `Name` (title), `URL` (url), `Order` (number) |
   | Tasks | `Name` (title), `Status` (status: To Do / In Progress / Done), `Priority` (select: High / Medium / Low), `Due Date` (date), `Project` (relation → Projects), `Notes` (text) |
   | Projects | `Name` (title), `Status` (status: Planning / Active / On Hold / Done), `Priority` (select), `Target Date` (date), `Description` (text) |
   | News Topics | `Topic` (title), `Active` (checkbox), `Keywords` (text), `Max Stories` (number) |

2. Create an internal integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) and copy its token.
3. On your ZogPanel page, open **•••** › **Connections** and add the integration.
4. Put each database's **data source ID** in `.env` (`NOTION_SHORTCUTS_DS`, etc.). To find one: open the database, click **•••** next to the database name, choose **Copy link to data source** (or "Manage data sources" › copy), and take the ID from the link.
5. Add the token as `NOTION_TOKEN` in `.env`, or paste it in the dashboard's **Settings** (gear icon). The Settings copy stays on that computer only and takes priority.

## Configuration (`.env`)

| Key | What it does |
| --- | --- |
| `USER_NAME` | Name in the greeting |
| `OPEN_MODE` | `startup` (once when Chrome starts) or `newtab` (every new tab). Settings in the dashboard override it |
| `DEFAULT_THEME` | `basic`, `motivated` or `chill` (until you pick one) |
| `SEARCH_URL` | Search engine; the query is appended |
| `BACKGROUND_IMAGES_DIR` | Photo folder for the Basic theme. If you rename it, update `.gitignore` too |
| `MOTIVATED_QUOTE_THEME` | Theme for the Motivated theme's daily AI-picked quote |
| `MOTIVATED_QUOTE`, `MOTIVATED_QUOTE_AUTHOR` | Fallback quote when there's no AI key |
| `MAX_SHORTCUTS` | Maximum number of shortcuts |
| `NOTION_TOKEN`, `NOTION_VERSION` | Notion API access |
| `NOTION_*_DS` | Data source IDs of your Notion databases |
| `NEWS_REFRESH_HOURS` | How often news refreshes (default 3) |
| `NEWS_ALL_PER_TOPIC` | Stories per topic in the All view (default 1) |
| `NEWS_LANGUAGE`, `NEWS_REGION` | Google News edition, e.g. `en` and `US` |
| `AI_PROVIDER` | `openai` or `gemini`: which AI runs the assistant and news summaries |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI key and model (default `gpt-5.4-nano`) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini key and model (default `gemini-3.1-flash-lite`) |

`.env` is git-ignored. Never commit real keys.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Chrome extension manifest (MV3) |
| `background.js` | Opens the dashboard on startup or on new tabs |
| `dashboard.html/.css/.js` | The dashboard |
| `config.js` | Reads `.env` |
| `notion.js` | Small Notion API client |
| `tasks.js` | Tasks and Projects cards (Notion) |
| `assistant.js` | AI chat that manages tasks, projects, topics and shortcuts |
| `assistant-instructions.md` | The assistant's instructions; edit to change how it behaves |
| `quote.js` | Motivated theme's daily quote |
| `news.js` | News card: Google News headlines per topic, picked and summarized by AI |
| `theme-boot.js` | Applies the saved theme before first paint |
| `update-images.ps1` | Rebuilds the background photo list |
