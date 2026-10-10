# UtilityKit

A Figma plugin · v1.5.0

Three everyday helpers in one small window:

- **Layer Renamer** — name frames the way the team guideline asks, in one go.
- **Flatten & Merge** — turn selected layers into an image.
- **Google Drive Links** — find the project's Drive links in one click.

---

## Install

It takes about a minute.

1. On the GitHub page, click **Code → Download ZIP**, then unzip it.
2. Move the unzipped folder somewhere it can stay, such as your Documents folder. Figma reads the plugin from this folder every time, so don't move or delete it later.
3. Open the **Figma desktop app** and open any design file. (This does not work in the browser version of Figma.)
4. In the menu, go to **Plugins → Development → Import plugin from manifest…**
5. Pick the file called `manifest.json` inside the folder.

To open the plugin: **Plugins → Development → UtilityKit**.

Each person installs it once on their own computer.

---

## Layer Renamer

Names your frames the way the team guideline asks, with no spaces or symbols.

**Web:** `PageType_Device_DesignPhase_ClientName_V1R1`
Example: `Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V1`

**Marketing:** `Size_DeliverableType_SpecificTask_ClientName_V1R1_Variation`
Example: `1080x1080_MetaAds_BlackFriday_AllfitAutomotiveAndParts_V1`

How to use it:

1. Go to the right page in Figma and select the frames to rename.
2. The first time in a file, the plugin asks one thing: **who is this file for?** Type the client's name. It is saved with the file, so nobody is asked again.
3. Choose **Web** or **Marketing**.
4. Check the **Live preview** above the button. It shows the new name.
5. Press **Rename**. That's it.

What the plugin fills in for you:

| Part | Where it comes from |
|---|---|
| **Page type** | The name of the Figma page you are on. `2026-05 - Homepage` becomes `Homepage`. You can type over it. |
| **Device** (Web) | The frame's width: 1600 px is `Desktop`, 320 px is `Mobile`. Any other width gets no tag, and the preview points it out. |
| **Size** (Marketing) | The frame's size, such as `1080x1080`. For video work in a standard size it uses the short codes V, H, P and S. You can switch the size off. |
| **Version** | Several frames with the same name are numbered left to right: `V1`, `V2`, `V3`. Desktop and Mobile are counted separately. |

What you fill in:

- **Design phase** (Web) — None, Wireframes or Mockups.
- **Deliverable**, **Specific task**, **Variation** (Marketing) — for example `MetaAds`, `BlackFriday`, `A`.

The client:

- It is shown at the top of the screen, with a **Change** link.
- Type it normally; the plugin tidies it: `All-fit Automotive & Parts` becomes `AllfitAutomotiveAndParts`.
- Web and Marketing use the same client.
- If the file already has frames named to the guideline, the plugin reads the client from them and doesn't ask.

Versions and revisions:

| Choice | What it does |
|---|---|
| Version: **Automatic** | Frames that already have a version keep it. New frames get the next free number. Moving frames around never changes their versions. |
| Version: **Next version (+1)** | Every frame moves up one (`V1` to `V2`) and starts again without a revision. |
| Version: **Start at…** | Numbers the frames again from the number you type. |
| Revision: **Keep as it is** | Leaves the revision alone. |
| Revision: **Next revision (+1)** | `V1` becomes `V1R1`, `V1R1` becomes `V1R2`. |
| Revision: **No revision** / **Set to…** | Removes the revision, or sets it to the number you type. |

Good to know:

- Nothing changes until you press **Rename**. To undo, press ⌘Z (Mac) or Ctrl+Z (Windows).
- The frame's old name is not used, apart from a version it already has. The rest comes from the page name, the frame's size and what you typed.
- **Resize** (Web) can set frames to **Desktop 1600** or **Mobile 320** wide as it renames. It only changes frames, never text or shapes.
- The plugin remembers your choices. The client is remembered per Figma file, never carried from one file to another.

---

## Flatten & Merge

Turns layers into a picture (PNG).

1. Select one or more layers.
2. Choose the quality: **1×** is normal size, **2×** is sharper, up to **4×**.
3. Press one of the buttons:
   - **Flatten each** — one image for every layer.
   - **Merge into one** — a single image of everything you selected.

Good to know:

- **Your original layers are kept.** The image appears to the right of your artboard.
- If you choose **Replace originals**, the plugin asks you to confirm first. The image is made before anything is removed, so if something goes wrong your layers stay as they were.
- Shadows and other effects are included in the image.
- Figma cannot hold one image larger than 4096 px on a side. For anything bigger, such as a long page, the plugin makes several pieces that fit together exactly and groups them. Nothing is shrunk or blurred.
- Hidden and empty layers are skipped. The plugin tells you which ones.
- To undo, press ⌘Z or Ctrl+Z.

---

## Google Drive Links

Looks at the page named **For Designers** in your Figma file and lists every Google Drive and Google Docs link on it.

- **Open first** / **Copy first** — for the first link on the page.
- Each link has its own buttons to open it, copy it, or show where it sits in the file.
- **Rescan** — look again after you change the page.
- **Add a link** — type a name and paste the link. It is added to the For Designers page.
- No For Designers page yet? The plugin offers to create one. It never creates it without asking.

What it does **not** do: it does not look inside Google Drive, it cannot tell whether a link still works or who can open it, and it never uploads or downloads files. It only works with links that are written in the Figma file.

---

## Settings

Click the **gear** in the top right corner of the Home screen.

- **Updates** — shows your version and lets you check for a new one.
- **Reset my settings** — puts the Layer Renamer and Flatten options back to how they were when you first installed. It asks before doing it.

---

## Updating

1. Open **Settings** (the gear on the Home screen) and press **Check for updates**.
2. If there is a new version, press **Update now**.
3. The plugin reloads by itself with the new version. That's it.

Good to know:

- Each person updates on their own computer.
- Updating does not change your Figma files or your saved settings.
- A new version can take a few minutes to show up after it is published.
- Changed your mind? **Settings → Go back to v…** returns to the version in your plugin folder.
- If an update ever fails to start, the plugin goes back to the previous version by itself the next time you open it.

**Have a version older than 1.3.0?** It can't update itself yet. Do this once: download the ZIP from GitHub again and copy the files over your old plugin folder. After that, **Update now** works.

**No "Update now" button, only "Download update"?** Your Figma won't let the plugin update itself. Download the ZIP and copy the files over your plugin folder instead. On a Mac you can also double-click `update.command` in the plugin folder (the first time, right-click it and choose **Open**). On Windows, double-click `update.bat`; it opens the download for you.

---

## Privacy and safety

- The plugin only changes your file when you press a button such as Apply or Flatten, and every change can be undone.
- Your original layers are never deleted unless you choose **Replace originals** and confirm.
- The plugin goes online for one thing only: checking for and downloading its own updates from GitHub, and only when you press the button. Nothing about your designs is sent anywhere.
- **Update now** installs whatever is on the plugin's GitHub page. Only people you trust should be able to change that page, and the GitHub account should have two-step sign-in turned on.

---

## Something not working?

| Problem | What to try |
|---|---|
| The plugin isn't in the menu | Use the Figma **desktop app**, then import `manifest.json` again. |
| "Select layers" and the buttons are grey | Click one or more layers on the canvas first. |
| Check for updates says "up to date" but a new version exists | Wait a few minutes and press it again. |
| The plugin stopped opening after you moved a folder | Import `manifest.json` again from the folder's new place. |
| No links found | Check that the page is named **For Designers** and that the links point to Google Drive or Google Docs. |

---

## For people who edit the plugin

You only need this section if you want to change how the plugin works. You need [Node.js](https://nodejs.org) installed.

**What's in the folder**

| File or folder | What it is |
|---|---|
| `manifest.json` | Tells Figma about the plugin. |
| `code.js`, `ui.html` | The plugin itself. These are made automatically — don't edit them by hand. |
| `src/` | The files you edit. `src/plugin` is how it works, `src/ui` is how it looks. |
| `version.json` | The version number and the list of what's new. |
| `test/` | Automatic checks. |
| `update.command`, `update.bat` | Helpers that download the latest files into the folder. |

**Publishing a new version**

1. Make your changes in `src/`.
2. Open `version.json`, raise the version number (for example `1.3.1` to `1.3.2`) and write what changed.
3. In a terminal, in the plugin folder, run `node build.js`. This remakes `code.js` and `ui.html`.
4. Run `npm test` to make sure nothing broke.
5. Upload **everything** to GitHub. `code.js`, `ui.html` and `version.json` must go up together, or **Update now** will refuse the new version.

After a few minutes, everyone who presses **Check for updates** sees the new version.

**Two rules**

- The GitHub page has to stay **public**, or the plugin can't see new versions.
- Be careful with `src/plugin/05-loader.js`. It is the small part that starts the plugin and picks which version to run, and it is the one part **Update now** cannot replace.

**Checks**

- `npm test` runs 62 automatic checks of the renaming rules, flattening, Drive links and updating.
- `python3 test/e2e.py` clicks through every screen in a pretend Figma (needs Playwright).
- These run outside Figma, so also try a new version in Figma itself on a spare file before sharing it.
