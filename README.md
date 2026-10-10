# UtilityKit

A Figma plugin · v1.2.0

Rename selected layers, flatten them into images, and manage project Drive links — all in one place.

| Utility | What it does |
|---|---|
| **Layer Renamer** | Batch renames the selection as `Page - Design Phase - Client - Version`, with a live preview and a full before/after review before anything changes. |
| **Flatten & Merge** | Turns each selected layer into an image, or merges several into one. Originals are kept unless you choose to replace them. |
| **Google Drive Links** | Lists the Google Drive / Docs hyperlinks on the file's **For Designers** page so you can open, copy, or add to them. |
| **Check for updates** | Tells you when a newer version is in the GitHub repository and what changed. |

---

## Install (about a minute, no build step)

1. Unzip this folder somewhere permanent, for example `Documents/Figma Plugins/utilitykit`.
2. Open the **Figma desktop app** and open any design file.
3. Menu → **Plugins → Development → Import plugin from manifest…**
4. Choose `manifest.json` from this folder.
5. Run it from **Plugins → Development → UtilityKit**.

`code.js` and `ui.html` are already built, so there is nothing to install or compile. Figma reads the files from this folder each time the plugin runs — keep the folder where it is.

> Development plugins only run in the desktop app. To give the whole team one-click access, publish it privately to your organization (see *Publishing* below).

---

## Using it

### Layer Renamer

1. Select the layers or frames to rename.
2. Fill in the fields. Each one has a switch; **switched-off and empty fields are left out**, with no stray separators.
   - **Page** uses each layer's own name by default (so 20 frames keep 20 different page names). Switch it to *Custom text* to give them all the same page.
   - **Design Phase**, **Client**, **Version** are typed once and applied to every layer.
   - The arrows reorder the fields.
3. Watch the **Live preview** update as you type, then press **Preview**.
4. The **Rename Preview** screen shows *Selected / Will rename / Unchanged* and every current → new name. Press **Apply**.

Formatting, applied to every name:

| Rule | Example |
|---|---|
| Removes a leading `YYYY-MM` date (and an optional `-DD`) plus its separator | `2026-05 - home page` → `Home Page` |
| Capitalizes each word, without flattening acronyms | `landing page CTA` → `Landing Page CTA` |
| Tidies spacing, underscores and stray edge punctuation | `  home_page  - ` → `Home Page` |
| Writes versions consistently | `1`, `v1`, `version 1` → `V1` |

**Advanced:** separator (` - `, ` | `, ` / `, `_`), version prefix on/off, numbering for identical names (`… - 01`, `… - 02`), and **Resize layers to 1600 px wide**:

- *Scale proportionally* — keeps the aspect ratio; contents scale with the layer (Figma's Scale tool).
- *Width only* — sets the width to 1600 and leaves the height as it is; auto-layout frames re-hug their content.

Things worth knowing:

- **Nothing is renamed until you press Apply**, and Apply is a single undo step (⌘Z / Ctrl+Z).
- **Re-running is safe.** A layer already named `Home - Design - Acme - V1` is recognised, not turned into `Home - Design - Acme - V1 - Design - Acme - V1`. Bump the version to `2` and it becomes `… - V2`. This works for layers UtilityKit renamed, and for layers that already follow the current format by hand.
- If layers are deleted or renamed between Preview and Apply, nothing is applied and you get a refreshed preview instead.
- **Saved settings.** Your format choices are remembered on your machine. *Client, Design Phase and Version* are also remembered **inside the file** when you apply (as invisible plugin data), so each project file reopens with its own client — for you and for teammates.

### Flatten & Merge

1. Select one or more layers.
2. Pick a resolution (1×–4×).
3. **Flatten each** makes one image per layer. **Merge into one** makes a single image of everything selected.

- **Originals are kept by default.** The image is placed to the right of the artboard(s) the selection sits in, and selected.
- **Replace originals** is opt-in and asks for confirmation every time. The image is created first and put in the originals' place and stacking position; only then are the originals removed. If the export fails, nothing is removed.
- Rendering uses Figma's own PNG export, so effects such as shadows are included.
- **Large output is never silently downscaled.** Figma rejects image fills above 4096 px on a side. When the output would exceed that (say a 1600 × 9000 page at 2×), UtilityKit produces seamless tiles in one group at full quality, and says so before you run it.
- A layer is rendered as it looks on its own: what is behind it, and a parent's clipping, mask or opacity, are not baked in. Hidden layers, empty layers and slices are skipped and listed.

### Google Drive Links

Opens with a scan of the page named **For Designers** (the name match ignores case and tolerates decoration such as `📎 For Designers`).

- Lists every `drive.google.com` and `docs.google.com` hyperlink on that page, in reading order (top to bottom, then left to right), labelled Folder / File / Doc / Sheet / Slides / Form. Pasted URLs that were never made into hyperlinks are listed too, tagged *Plain text*.
- **Open first / Copy first**, per-link open, copy and *show on canvas*, and **Rescan**.
- **Add a link**: give it a label and a URL. It is written to a "Drive Links" frame on the For Designers page as a real hyperlink. If the page does not exist, the button becomes **Create page & add link** — the page is never created without you asking.

**What it cannot do — by design.** A Figma plugin can only read the Figma file. UtilityKit does not look inside Google Drive, cannot tell whether a link works or who has access, and never uploads, downloads or syncs files. The plugin's only network permission is the GitHub address used by *Check for updates*, so it cannot contact Google even if it wanted to. It manages links, not files.

### Settings

The gear in the top right opens Settings from any screen; Back returns to where you were.

- **Updates** — shows the installed version, with *Check for updates* and a link to the repository.
- **Saved settings** — *Reset my settings* puts the naming format, formatting options and flatten resolution back to their defaults (after a confirmation). Client, Design Phase and Version stored inside a file stay with that file.

### Check for updates

**Home → Check for updates** (bottom right), or the same button in **Settings**, reads `version.json` from
`github.com/hiteshramawat01-oss/UtilityKit` and compares it with the version you are running.

- Up to date → a short confirmation.
- Newer version → a card with the version, release date and what changed, plus **Download update** and **View on GitHub**.
- It only runs when you press the button. Nothing about your file is sent; the plugin just downloads one small text file.

**The plugin cannot install the update itself.** Figma gives plugins no access to files on your computer, including their own. Installing is one step outside Figma — pick whichever fits how you installed it:

| You installed by… | To update |
|---|---|
| Cloning the repo (GitHub Desktop or `git clone`) | Press **Pull origin** in GitHub Desktop, or double-click the update script. |
| Downloading a ZIP | **Mac:** double-click `update.command` in the plugin folder — it downloads the latest files and copies them over the old ones (nothing is deleted). **Windows:** double-click `update.bat` — it opens the download; unzip it over the plugin folder. |

Then run UtilityKit again. Figma reads the plugin files fresh on every run, so there is nothing to re-import.

First run of `update.command` on a Mac: macOS may block a downloaded script. Right-click it → **Open** once. If it says you don't have permission, the file lost its "executable" flag (this happens when files are added through GitHub's web upload page); run `bash update.command` in Terminal, or `chmod +x update.command` once.

Requirements and limits:

- **The repository must be public** for the check and the ZIP download to work. With a private repository the check reports that no version information was found. (A private repo would need an access token inside the plugin, where anyone with the files could read it.)
- GitHub caches the file for a few minutes, so a release can take up to about five minutes to show.
- `version.json` is treated as untrusted: the version must be a real version number, and the plugin only ever opens links inside the UtilityKit repository, whatever the file says.

#### Releasing a new version (maintainers)

1. Make your changes in `src/`.
2. Edit `version.json`: raise `version` (for example `1.1.0` → `1.2.0`), set `released`, and list what changed in `notes`.
3. Run `node build.js` — it stamps that version into `code.js` — then `npm test`.
4. Commit and push everything to `main` (or upload the files through GitHub). `manifest.json`, `code.js`, `ui.html` and `version.json` must sit at the top level of the repository.

Everyone who presses **Check for updates** will then see the new version.

---

## Safety rules the code follows

- Reading (previews, summaries, scans) never changes the document.
- Originals are never edited or deleted, except by *Replace originals* after an explicit confirmation — the plugin logic itself refuses a replace request that is not marked confirmed.
- Every change is one undo step and ends with a clear success or error message.
- Temporary layers used for rendering are removed even when something fails.
- Only validated Google Drive / Docs URLs, and links inside the UtilityKit repository, are ever opened.
- The only network request the plugin can make is reading `version.json` from GitHub, and only when you press *Check for updates*.

---

## Project layout

```
manifest.json        Figma manifest (network: GitHub raw files only; dynamic page loading)
version.json         current version + release notes — the file "Check for updates" reads
update.command       updater for macOS      update.bat   updater for Windows
code.js              Plugin logic — BUILT from src/plugin
ui.html              Interface    — BUILT from src/ui (one self-contained file)

src/plugin/
  00-core.js         shared helpers
  10-naming.js       naming rules (pure functions, no Figma API)
  20-renamer.js      Layer Renamer: preview, apply, resize
  30-flatten.js      Flatten & Merge: render, tile, place, replace
  40-drive.js        Google Drive Links: scan, add, open
  50-updates.js      Check for updates: fetch, compare, validate
  90-main.js         message router, saved settings, start-up
src/ui/
  ui.html  ui.css  ui.js

build.js             zero-dependency build script
test/                unit tests, mock Figma API, browser harness, end-to-end script
```

The interface and the logic are separate programs: `ui.html` draws screens and sends requests such as `rename.preview`; `code.js` is the only side that touches the document, and answers every request with exactly one result. Each utility is its own module and can be tested on its own.

## Changing it

Requires Node 18+ (no packages to install).

```bash
node build.js          # rebuild code.js and ui.html after editing src/
npm test               # build + 50 unit tests
python3 test/e2e.py    # optional: drives the real UI in a headless browser (needs Playwright)
```

`test/harness.html` runs the real `ui.html` against the real `code.js` on top of a mock Figma API. Open it in a browser to click through the interface without Figma.

To add a utility: add a module in `src/plugin`, register its requests in `90-main.js`, add a screen in `src/ui/ui.html`, and replace the "Coming soon" card on Home.

## How it was tested

- **50 unit tests** cover the naming rules, preview/apply, stale previews, failures, resizing, saved settings, flatten/merge/tiling/replace, export failures, Drive link scanning/adding/URL validation, and the update check (version comparison, bad or hostile `version.json`, offline, private repo).
- `update.command` was run on every path (ZIP download, git pull, failed download, wrong download, wrong folder). `update.bat` has not been run on Windows.
- **An end-to-end run** drives the real interface against the real plugin logic through every screen, including the narrow-window and dark-theme layouts.
- Both run against a **simulated Figma API**. The plugin has not yet been exercised inside the Figma app itself, so do a first run on a scratch file. The places most likely to behave differently in real Figma are *Replace originals* inside auto-layout or component instances, and *Merge* across layers nested in rotated parents.

## Publishing

For a private organization plugin: **Plugins → Development → UtilityKit → Publish**. Figma assigns a numeric plugin ID at that point; replace the placeholder `"id"` in `manifest.json` with it.
