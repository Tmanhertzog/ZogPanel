# Data Augmentor
### Created by: Tristan Hertzog

Demo video: []()

ZogPanel is a personal Chrome dashboard that shows your shortcuts, bookmarks, tasks and projects, and AI-curated news on one page. It includes an AI assistant that updates for you.

### Features:

* Opens once when Chrome starts, or replaces every new tab (your choice in Settings) also from the extension icon
* Editable shortcuts stored in a Notion database
* Your real Chrome bookmarks
* Search bar pinned in the bottom third of the screen
* Tasks and projects from Notion databases, with progress task completion
* AI assistant that adds, updates and removes tasks, projects and news topics, and adds shortcuts (OpenAI or Gemini). Its instructions live in `assistant-instructions.md`
* News for your Notion topics: Google News headlines, picked and summarized by AI

### Requirements:

* Chrome, or another Chromium browser like Edge or Brave.
* Notion account with the four databases and an internal integration token that has access to them. A free plan works.

##### Optional

* An AI key, either OpenAI (needs prepaid credit, usually a few dollars) or Google Gemini (free tier available).
* Windows PowerShell to run update-images.ps1 for the Basic theme photos.
* Your own photos in basic_bkg_images/

### Setup

1. Get the code and open the folder.
2. Copy `.env.example` to `.env` and fill it in
3. Go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick this folder.
4. In your Notion workspace, create a page with these databases:

   | Database | Properties |
   | --- | --- |
   | Shortcuts | `Name` (title), `URL` (url), `Order` (number) |
   | Tasks | `Name` (title), `Status` (status: To Do / In Progress / Done), `Priority` (select: High / Medium / Low), `Due Date` (date), `Project` (relation → Projects), `Notes` (text) |
   | Projects | `Name` (title), `Status` (status: Planning / Active / On Hold / Done), `Priority` (select), `Target Date` (date), `Description` (text) |
   | News Topics | `Topic` (title), `Active` (checkbox), `Keywords` (text), `Max Stories` (number) |

5. Create an internal integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) and copy its token.
6. On your Notion page, open **Connections** and add the integration.
7. Put each database's **data source ID** in `.env` (`NOTION_SHORTCUTS_DS`, etc.). To find one: open the database, click the ••• button next to the database name, choose **Copy link to data source**, and take the ID from the link.
8.  Add the token as `NOTION_TOKEN` in `.env`, or paste it in the dashboard's settings.
10. **(optional)** Add background photos by putting images in `basic_bkg_images/`, then right-click `update-images.ps1` › *Run with PowerShell*. Run it again whenever you add or remove photos.
11. After changing any file, including `.env`, click the reload icon on the ZogPanel card.


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