# ZogPanel

A personal dashboard for Chrome that opens once when the browser starts. It shows your shortcuts, bookmarks, tasks, projects and news, with a search bar that can switch to an AI assistant. Tasks, projects, shortcuts and news topics live in Notion.

## Features

- Opens once per browser launch (no duplicate tabs), or from the toolbar icon
- Three themes: **Basic** (random photo backdrop), **Motivated** (dark, electric purple, quote), **Chill** (teal)
- Editable shortcuts stored in a Notion database
- Your real Chrome bookmarks, grouped by folder
- Search bar pinned in the bottom third of the screen, with a switch to the AI chat
- Coming next: Notion tasks and projects, AI-summarized news, an assistant that writes to Notion

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
| `DEFAULT_THEME` | `basic`, `motivated` or `chill` (until you pick one) |
| `SEARCH_URL` | Search engine; the query is appended |
| `BACKGROUND_IMAGES_DIR` | Photo folder for the Basic theme. If you rename it, update `.gitignore` too |
| `MOTIVATED_QUOTE`, `MOTIVATED_QUOTE_AUTHOR` | Quote on the Motivated theme |
| `MAX_SHORTCUTS` | Maximum number of shortcuts |
| `NOTION_TOKEN`, `NOTION_VERSION` | Notion API access |
| `NOTION_*_DS` | Data source IDs of your Notion databases |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | For news and the assistant (coming soon) |

`.env` is git-ignored. Never commit real keys.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Chrome extension manifest (MV3) |
| `background.js` | Opens the dashboard once on startup |
| `dashboard.html/.css/.js` | The dashboard |
| `config.js` | Reads `.env` |
| `notion.js` | Small Notion API client |
| `theme-boot.js` | Applies the saved theme before first paint |
| `update-images.ps1` | Rebuilds the background photo list |
