# UtilityKit

A Figma plugin with three small helpers:

- **Layer Renamer** — names frames the way the team guideline asks.
- **Flatten & Merge** — turns selected layers into one image.
- **Google Drive Links** — copies or opens the project's Drive link.

## Install

1. On the GitHub page, click **Code → Download ZIP** and unzip it.
2. Keep the folder somewhere it can stay, such as Documents. Don't move or delete it later.
3. Open the **Figma desktop app** (not the browser) and any design file.
4. Go to **Plugins → Development → Import plugin from manifest…** and pick `manifest.json` from the folder.

To open it: **Plugins → Development → UtilityKit**. Each person installs it once.

## Layer Renamer

1. Select the frames to rename.
2. The first time in a file, type the client's name. It is saved with the file.
3. Choose **Web** or **Marketing**.
4. Check the **Live preview**, then press **Rename**.

| | Name | Example |
|---|---|---|
| **Web** | `PageType_Device_DesignPhase_Client_V1R1` | `Homepage_Desktop_Mockups_Acme_V1` |
| **Marketing** | `Size_Deliverable_PageName_Client_V1R1` | `1080x1080_MetaAds_BlackFriday_Acme_V1` |

The plugin fills in most of it:

- **Page type / Page name** — the name of the Figma page you are on. You can type over it.
- **Device** (Web) — from the frame's width: 1600 px is `Desktop`, 320 px is `Mobile`.
- **Size** (Marketing) — the frame's size, such as `1080x1080`.
- **Version** — frames with the same name are numbered left to right: `V1`, `V2`, `V3`.

You choose the **Design phase** (Web) and can type a **Deliverable** (Marketing). Both are optional. The Deliverable box starts empty each time you open the plugin.

To set versions yourself, type in the **Version** box:

| You type | You get |
|---|---|
| `1` | `V1` on every frame |
| `1r2` | `V1R2` on every frame |
| `r2` | each frame keeps its version and gets revision 2 |
| `1, 2, 3` | one per frame, left to right |

## Flatten & Merge

1. Select one or more layers.
2. Press **Merge into one**.

The layers are replaced by one image named `[Print Section]`, in the same place. Press ⌘Z or Ctrl+Z to get the layers back.

A result larger than 4096 px on a side becomes several pieces that fit together, in one group. Hidden layers and layers inside an instance are left out.

## Google Drive Links

Shows the Google Drive link on the page named **For Designers**, with two buttons: **Copy link** and **Open link**.

No link yet? Paste it in the box and press **Add link**. It is written on that page as a text link that says **GDrive link to folder**.

The plugin only reads the link written in the Figma file. It never looks inside Google Drive.

## Updating

1. On the Home screen, press **Check for updates** (bottom right).
2. If there is a new version, press **Update now**. The plugin reloads by itself.

Updating does not change your Figma files. A new version can take a few minutes to show up after it is published.

## Good to know

- Nothing changes in your file until you press a button, and every change can be undone with ⌘Z or Ctrl+Z.
- The plugin goes online only to check for and download its own updates from GitHub. Nothing about your designs is sent anywhere.
- **Update now** installs whatever is on the plugin's GitHub page, so only trusted people should be able to change that page.

## Something not working?

| Problem | What to try |
|---|---|
| The plugin isn't in the menu | Use the Figma desktop app and import `manifest.json` again. |
| The buttons are grey | Select one or more layers on the canvas first. |
| "Up to date" but a new version exists | Wait a few minutes and check again. |
| No "Update now", only "Download update" | Download the ZIP and copy the files over your plugin folder. |
| No Drive link found | Check that the page is named **For Designers**. |

## For people who edit the plugin

You need [Node.js](https://nodejs.org).

1. Change the files in `src/`. Don't edit `code.js` or `ui.html` by hand; they are made from `src/`.
2. Raise the version number in `version.json` and write what changed.
3. Run `node build.js`, then `npm test`.
4. Upload everything to GitHub. `code.js`, `ui.html` and `version.json` must go up together.

The GitHub page has to stay **public**, or the plugin can't see new versions.

Be careful with `src/plugin/05-loader.js`: it starts the plugin, and it is the one part **Update now** cannot replace.
