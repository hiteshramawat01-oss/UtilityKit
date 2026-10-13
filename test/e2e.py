"""
End-to-end check: drives the real ui.html + code.js (mock Figma underneath) in a
headless browser, asserts on what the designer would see, and saves screenshots.

    python3 test/e2e.py [screenshot-dir]
"""
import os, re, sys, pathlib, threading, functools, http.server
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
errors = []

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

def serve():
    handler = functools.partial(Quiet, directory=str(ROOT.parent))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 360, "height": 600}, device_scale_factor=2)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        server = serve()
        page.goto("http://127.0.0.1:%d/test/harness.html" % server.server_address[1])
        ui = page.frame_locator("#ui")
        shot = lambda name: page.screenshot(path=str(OUT / f"{name}.png"))
        ev = page.evaluate

        # ── Home ──
        expect(ui.locator("#version")).to_have_text("v2.1.0")
        expect(ui.locator("#selPill")).to_be_hidden()                # no selection count on Home
        # no Settings page or icon, and no way to update from inside the plugin: the footer is just the version
        expect(ui.locator("#openSettings")).to_have_count(0)
        expect(ui.locator('section[data-screen="settings"]')).to_have_count(0)
        expect(ui.locator("#updCheck, #updBox")).to_have_count(0)
        expect(ui.locator("body")).not_to_contain_text("Check for updates")
        expect(ui.locator(".foot")).to_have_text("v2.1.0")
        vbox = ui.locator("#version").bounding_box()
        assert abs((vbox["x"] + vbox["width"] / 2) - 180) < 2, "the version is centred"
        shot("01-home")

        # ── About: reached from the icon in the top-right corner of Home ──
        box = ui.locator("#openAbout").bounding_box()
        assert box["x"] + box["width"] > 360 - 16 and box["y"] < 48, "the info icon sits in the top-right corner"
        ui.locator("#openAbout").click()
        expect(ui.locator("#title")).to_have_text("About")
        expect(ui.locator("#openAbout")).to_be_hidden()
        expect(ui.locator("#selPill")).to_be_hidden()
        about = ui.locator('section[data-screen="about"]')
        expect(about).to_contain_text("What it is")
        expect(about).to_contain_text("Why it was made")
        expect(about.locator("li")).to_have_count(4)
        expect(ui.locator("#aboutVersion")).to_have_text("UtilityKit v2.1.0")
        shot("01b-about")
        ui.locator("#back").click()
        expect(ui.locator("#brand")).to_be_visible()
        expect(ui.locator("#openAbout")).to_be_visible()

        # ── Layer Renamer: the client is asked once, before anything else ──
        CLIENT = "All-fit Automotive & Parts"
        FILE = "JSON.parse(figma.root.getPluginData('utilitykit.file.v1') || '{}')"
        ui.locator('[data-go="renamer"]').click()
        expect(ui.locator("#openAbout")).to_be_hidden()              # the info icon is on Home only
        expect(ui.locator("#rnAsk")).to_be_visible()
        expect(ui.locator("#rnAskTitle")).to_have_text("Who is this file for?")
        expect(ui.locator("#rnForm")).to_be_hidden()
        expect(ui.locator("#rnActions")).to_be_hidden()
        expect(ui.locator("#selPill")).to_be_visible()
        expect(ui.locator("#rnAskGo")).to_be_disabled()
        expect(ui.locator("#rnAskCancel")).to_be_hidden()
        ui.locator("#rnAskInput").fill(CLIENT)
        expect(ui.locator("#rnAskExampleName")).to_have_text("Homepage_AllfitAutomotiveAndParts_V1")
        expect(ui.locator("#rnAskExampleName b")).to_have_text("AllfitAutomotiveAndParts")
        expect(ui.locator("#rnAskGo")).to_be_enabled()
        shot("02a-renamer-ask")
        assert ev(FILE) == {}, "nothing is saved until Continue"
        ui.locator("#rnAskInput").press("Enter")
        expect(ui.locator("#rnAsk")).to_be_hidden()
        expect(ui.locator("#rnForm")).to_be_visible()
        expect(ui.locator("#rnClientName")).to_have_text(CLIENT)
        page.wait_for_function(FILE + ".client === 'All-fit Automotive & Parts'")   # saved with the file: asked once

        # ── Layer Renamer: the form ──
        expect(ui.locator("#rnRenameBtn")).to_be_disabled()
        expect(ui.locator("#rnExampleName")).to_have_text("Select frames on the canvas")
        expect(ui.locator("#rnPageHint")).to_contain_text("“2026-05 - Homepage”")       # read from the Figma page
        expect(ui.locator("#rnPageType")).to_have_value("Homepage")
        expect(ui.locator('input[name="rnMode"][value="web"]')).to_be_checked()          # radio buttons, not tabs
        ev("env.select([demo.m1, demo.d2, demo.d1])")
        expect(ui.locator("#selText")).to_have_text("3 selected")
        expect(ui.locator("#rnDevices")).to_have_text("2 Desktop · 1 Mobile")
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_AllfitAutomotiveAndParts_V1")
        expect(ui.locator("#rnExampleFrom")).to_have_text("from “Frame 1” · and 2 more")
        ui.locator('#rnPhase [data-value="Mockups"]').click()
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V1")
        expect(ui.locator("#rnRenameBtn")).to_have_text("Rename 3 frames")
        # order on screen: client, then the choices, then the live preview right above the button
        y = lambda sel: ui.locator(sel).bounding_box()["y"]
        assert y(".clientbar") < y("#rnMode") < y("#rnPageType") < y("#rnVersions") < y("#rnExample") < y("#rnRenameBtn")
        shot("02-renamer")

        # the page type can be typed over, and goes back to the page's name when cleared
        ui.locator("#rnPageType").fill("category page")
        expect(ui.locator("#rnExampleName")).to_have_text("CategoryPage_Desktop_Mockups_AllfitAutomotiveAndParts_V1")
        ui.locator("#rnPageType").fill("")
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V1")
        ui.locator("#rnVersions").focus()                                       # leaving the box puts the page's name back
        expect(ui.locator("#rnPageType")).to_have_value("Homepage")

        # the Version box is pre-filled with what the frames would get; typing replaces it
        expect(ui.locator("#rnVersions")).to_have_value("V1, V2, V1")
        expect(ui.locator("#rnExampleVersions")).to_have_text("Versions, left to right: V1 · V2 · V1")
        ui.locator("#rnVersions").fill("3")                                      # one value: every frame
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V3")
        expect(ui.locator("#rnExampleVersions")).to_have_text("Versions, left to right: V3 · V3 · V3")
        ui.locator("#rnVersions").fill("1r2, 2, r1")                             # one each, left to right
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V1R2")
        expect(ui.locator("#rnExampleVersions")).to_have_text("Versions, left to right: V1R2 · V2 · V1R1")
        ui.locator("#rnVersions").fill("1, 2")                                   # wrong count: blocked, with the reason
        expect(ui.locator("#rnExampleName")).to_have_text("3 frames selected, 2 versions typed. Type one version, or one for each frame.")
        expect(ui.locator("#rnRenameBtn")).to_be_disabled()
        expect(ui.locator("#rnExampleVersions")).to_be_hidden()
        ui.locator("#rnVersions").fill("nope")
        expect(ui.locator("#rnExampleName")).to_contain_text("“nope” isn’t a version")
        ui.locator("#rnVersions").fill("5")
        ev("env.select([demo.d1])")                                               # a typed version belongs to its selection
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V1")
        ev("env.select([demo.m1, demo.d2, demo.d1])")
        ui.locator("#rnPageType").focus()
        expect(ui.locator("#rnVersions")).to_have_value("V1, V2, V1")
        ui.locator("#rnVersions").fill("")                                        # emptied: back to automatic
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V1")
        ui.locator("#rnPageType").focus()
        expect(ui.locator("#rnVersions")).to_have_value("V1, V2, V1")

        expect(ui.locator("#rnAdvanced")).to_have_count(0)                         # no resize option any more
        expect(ui.locator("#rnForm")).not_to_contain_text("Resize")

        # Marketing: the same layout as Web. Page type from the page, size from the frames, nothing required
        expect(ui.locator("#rnDeviceRow")).to_be_visible()
        expect(ui.locator("#rnPhaseRow")).to_be_visible()
        expect(ui.locator("#rnSizeRow")).to_be_hidden()
        expect(ui.locator("#rnForm .frow-label:visible")).to_have_text(["Page type", "Device", "Design phase", "Version"])
        expect(ui.locator("#rnDeliverableRow")).to_be_hidden()
        ui.locator('input[name="rnMode"][value="marketing"]').check(force=True)
        expect(ui.locator("#rnDeviceRow")).to_be_hidden()
        expect(ui.locator("#rnPhaseRow")).to_be_hidden()
        expect(ui.locator("#rnPageType")).to_be_visible()                          # same Page type box, still read from the page
        expect(ui.locator("#rnPageType")).to_have_value("Homepage")
        expect(ui.locator("#rnSizes")).to_have_text("1600x3000 · 1600x3400 · 320x2600")
        expect(ui.locator("#rnIncludeSize, #rnTask, #rnVariation")).to_have_count(0)   # no checkbox, no task, no variation
        for gone in ["Start with the size", "Specific task", "Variation"]:
            expect(ui.locator("#rnForm")).not_to_contain_text(gone)
        expect(ui.locator("#rnForm .frow-label:visible")).to_have_text(["Page name", "Size", "Deliverable", "Version"])
        expect(ui.locator("#rnDeliverable")).to_have_attribute("placeholder", "Optional, e.g. MetaAds")
        expect(ui.locator("#rnDeliverable")).not_to_have_attribute("list", re.compile(".+"))
        # works straight away: the deliverable is optional
        expect(ui.locator("#rnExampleName")).to_have_text("1600x3000_Homepage_AllfitAutomotiveAndParts_V1")
        expect(ui.locator("#rnRenameBtn")).to_be_enabled()
        ui.locator("#rnDeliverable").fill("Meta Ads")
        expect(ui.locator("#rnExampleName")).to_have_text("1600x3000_MetaAds_Homepage_AllfitAutomotiveAndParts_V1")
        ui.locator("#rnPageType").fill("the black friday sale")
        expect(ui.locator("#rnExampleName")).to_have_text("1600x3000_MetaAds_TheBlackFridaySale_AllfitAutomotiveAndParts_V1")
        ui.locator("#rnPageType").fill("")
        expect(ui.locator("#rnExampleName")).to_have_text("1600x3000_MetaAds_Homepage_AllfitAutomotiveAndParts_V1")
        ui.locator("#rnVersions").focus()
        expect(ui.locator("#rnPageType")).to_have_value("Homepage")
        shot("03-renamer-marketing")
        ui.locator('input[name="rnMode"][value="web"]').check(force=True)
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V1")

        # ── Layer Renamer: one click renames ──
        assert ev("demo.d1.name") == "Frame 1"
        ui.locator("#rnRenameBtn").click()
        expect(ui.locator("#toast")).to_have_text("Renamed 3 frames. Undo with ⌘Z / Ctrl+Z.")
        assert ev("[demo.d1.name, demo.d2.name, demo.m1.name]") == [
            "Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V1",
            "Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V2",
            "Homepage_Mobile_Mockups_AllfitAutomotiveAndParts_V1"]            # numbered left to right, per device
        expect(ui.locator("#title")).to_have_text("Layer Renamer")             # no extra screen
        expect(ui.locator("#rnExampleFrom")).to_have_text("Already named this way · and 2 more")
        expect(ui.locator("#rnRenameBtn")).to_have_text("Already named")
        expect(ui.locator("#rnRenameBtn")).to_be_disabled()
        shot("05-renamed")
        assert ev("env.log.undo") == 1

        # what is remembered: project choices with the file; the client never in the designer's own settings
        assert ev(FILE) == {"client": CLIENT, "phase": "Mockups", "mode": "web"}                      # the deliverable is not kept
        assert ev("JSON.parse(env.storage['utilitykit.settings.v1']).renamer.deliverable") == ""
        assert ev("JSON.parse(env.storage['utilitykit.settings.v1']).renamer.client") == ""
        assert ev("JSON.parse(env.storage['utilitykit.settings.v1']).renamer.phase") == "Mockups"

        # a small change later: type the revision; every frame keeps its version
        expect(ui.locator("#rnVersions")).to_have_value("V1, V2, V1")
        ui.locator("#rnVersions").fill("r1")
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V1R1")
        expect(ui.locator("#rnRenameBtn")).to_have_text("Rename 3 frames")
        ui.locator("#rnRenameBtn").click()
        expect(ui.locator("#rnRenameBtn")).to_have_text("Already named")
        assert ev("[demo.d1.name, demo.d2.name, demo.m1.name]") == [
            "Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V1R1",
            "Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V2R1",
            "Homepage_Mobile_Mockups_AllfitAutomotiveAndParts_V1R1"]
        expect(ui.locator("#rnVersions")).to_have_value("V1R1, V2R1, V1R1")     # the box shows what the frames have now

        # changing the client
        ui.locator("#rnClientChange").click()
        expect(ui.locator("#rnAskTitle")).to_have_text("Change the client")
        expect(ui.locator("#rnAskInput")).to_have_value(CLIENT)
        ui.locator("#rnAskInput").fill("Someone Else")
        ui.locator("#rnAskCancel").click()
        expect(ui.locator("#rnClientName")).to_have_text(CLIENT)                # cancel changes nothing
        ui.locator("#rnClientChange").click()
        ui.locator("#rnAskInput").fill("Acme")
        ui.locator("#rnAskGo").click()
        expect(ui.locator("#rnClientName")).to_have_text("Acme")
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_Mockups_Acme_V1R1")
        assert ev(FILE + ".client") == "Acme"
        ui.locator("#rnClientChange").click()
        ui.locator("#rnAskInput").fill(CLIENT)
        ui.locator("#rnAskGo").click()
        expect(ui.locator("#rnClientName")).to_have_text(CLIENT)
        ui.locator("#back").click()
        expect(ui.locator("#brand")).to_be_visible()

        # a file nobody has set up, but with frames already named to the guideline: the client is read, not asked
        saved_file = ev("figma.root.getPluginData('utilitykit.file.v1')")
        ev("figma.root.setPluginData('utilitykit.file.v1', '')")
        ev("launch()")
        expect(ui.locator("#version")).to_have_text("v2.1.0")
        ui.locator('[data-go="renamer"]').click()
        expect(ui.locator("#rnForm")).to_be_visible()
        expect(ui.locator("#rnAsk")).to_be_hidden()
        expect(ui.locator("#rnClientName")).to_have_text("AllfitAutomotiveAndParts")
        ui.locator("#back").click()
        ev("(v) => figma.root.setPluginData('utilitykit.file.v1', v)", saved_file)
        ev("launch()")
        expect(ui.locator("#version")).to_have_text("v2.1.0")

        # a new session: the deliverable typed earlier is not remembered; the box is empty again
        ui.locator('[data-go="renamer"]').click()
        ui.locator('input[name="rnMode"][value="marketing"]').check(force=True)
        expect(ui.locator("#rnDeliverable")).to_have_value("")
        expect(ui.locator("#rnExampleName")).to_have_text("1600x3000_Homepage_AllfitAutomotiveAndParts_V1R1")
        ui.locator('input[name="rnMode"][value="web"]').check(force=True)
        ui.locator("#back").click()

        # ── Flatten & Merge: one action; the layers become [Print Section], in place ──
        ev("env.select([demo.a, demo.b])")
        ui.locator('[data-go="flatten"]').click()
        expect(ui.locator('section[data-screen="flatten"] .btn')).to_have_count(1)     # one button, no options
        expect(ui.locator("#flMerge")).to_have_text("Merge into one")
        expect(ui.locator("#flEach, #flScale, #flConfirm, input[name=flOriginals]")).to_have_count(0)
        expect(ui.locator('section[data-screen="flatten"]')).not_to_contain_text("Options")
        expect(ui.locator("#flSummary")).to_contain_text("1,440 × 1,600 px")
        expect(ui.locator("#flSummary")).to_contain_text("[Print Section]")
        expect(ui.locator("#flSummary")).to_contain_text("takes the place of these layers")
        shot("06-flatten")
        before = ev("env.all().length")
        top_level = ev("figma.currentPage.children.length")
        ui.locator("#flMerge").click()
        expect(ui.locator("#flBanner .note.success")).to_contain_text("Merged 2 layers into [Print Section]")
        expect(ui.locator("#flBanner .note.success")).to_contain_text("It is where the layers were")
        assert ev("env.all().length") == before - 1, "two layers out, one image in"
        assert ev("figma.currentPage.children.length") == top_level, "no new layer beside the artboard"
        assert ev("[demo.a.removed, demo.b.removed, demo.c.removed]") == [True, True, False]
        assert ev("demo.art.children.map(c => c.name)") == ["[Print Section]", "About - Design - Acme Corp - V1"]   # same spot in the layer list
        sel = "figma.currentPage.selection[0]"
        assert ev("[%s.name, %s.type, %s.parent === demo.art]" % (sel, sel, sel)) == ["[Print Section]", "RECTANGLE", True]
        assert ev("[%s.x, %s.y, %s.width, %s.height]" % (sel, sel, sel, sel)) == [0, 0, 1440, 1600]          # same place, same size
        assert ev("env.log.exports[env.log.exports.length - 1].scale") == 1
        assert ev("env.log.undo") >= 1
        # the image is what is selected now: the screen shows the result, not an offer to merge it again
        expect(ui.locator("#selText")).to_have_text("1 selected")
        expect(ui.locator("#flSummary")).to_be_hidden()
        expect(ui.locator("#flMerge")).to_be_disabled()
        expect(ui.locator("#flMerge")).to_have_text("Select other layers to merge again")
        shot("07-flatten-done")
        ui.locator("#flBanner .btn").click()
        page.wait_for_function("env.log.zoomed && env.log.zoomed.length === 1")

        # too big for one Figma image: pieces that fit together, in a [Print Section] group, still in place
        ev("window.longPage = env.add('FRAME', { name: 'Long page', x: 9000, y: 100, width: 1600, height: 9000 }); env.select([longPage])")
        expect(ui.locator("#flBanner .note")).to_have_count(0)      # the old result message is gone
        expect(ui.locator("#flMerge")).to_be_enabled()
        expect(ui.locator("#flSummary")).to_contain_text("1,600 × 9,000 px")
        expect(ui.locator("#flSummary")).to_contain_text("takes the place of this layer")
        expect(ui.locator("#flSummary .note.info")).to_contain_text("3 pieces that fit together exactly")
        shot("08-flatten-large")
        ui.locator("#flMerge").click()
        expect(ui.locator("#flBanner .note.success")).to_contain_text("Turned 1 layer into [Print Section]")
        expect(ui.locator("#flBanner .note.success")).to_contain_text("3 pieces")
        assert ev("[%s.name, %s.type, %s.x, %s.y]" % (sel, sel, sel, sel)) == ["[Print Section]", "GROUP", 9000, 100]
        assert ev("%s.children.map(c => c.name)" % sel) == ["Part 1", "Part 2", "Part 3"]
        assert ev("longPage.removed") is True
        assert ev("env.all().filter(n => /UtilityKit temp/.test(n.name)).length") == 0
        assert ev("[demo.d1.removed, demo.d2.removed, demo.m1.removed, demo.c.removed]") == [False, False, False, False]

        # nothing selected
        ev("env.select([])")
        expect(ui.locator("#flSummary")).to_contain_text("Nothing selected")
        expect(ui.locator("#flBanner .note")).to_have_count(0)
        expect(ui.locator("#flMerge")).to_be_disabled()
        expect(ui.locator("#flMerge")).to_have_text("Select layers to merge")
        shot("09-flatten-empty")
        ui.locator("#back").click()

        # ── Google Drive Links: one link, copy it or open it ──
        ev("env.select([demo.c])")
        ui.locator('[data-go="drive"]').click()
        expect(ui.locator("#selPill")).to_be_hidden()               # the selection has nothing to do with this screen
        expect(ui.locator("#drLabel")).to_have_count(0)             # only the link is asked for
        expect(ui.locator('section[data-screen="drive"]')).not_to_contain_text("Label")
        expect(ui.locator("#drStatus")).to_contain_text("No “For Designers” page")
        expect(ui.locator("#drAddCard")).to_be_visible()
        expect(ui.locator("#drAddText")).to_have_text("Create page & add link")
        shot("10-drive-no-page")
        ui.locator("#drUrl").fill("https://dropbox.com/s/abc")
        ui.locator("#drAdd").click()
        expect(ui.locator("#drError")).to_contain_text("isn’t a Google Drive or Google Docs link")
        assert ev("figma.root.children.length") == 1, "no page created for a rejected link"
        ui.locator("#drUrl").fill("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz")
        ui.locator("#drUrl").press("Enter")
        # one card says it once: the link is there, copy it or open it; nothing more to add
        expect(ui.locator("#drStatus .status-text b")).to_have_text("Google Drive link found")
        expect(ui.locator("#drStatus .link")).to_have_count(1)
        expect(ui.locator("#drStatus .link .btn")).to_have_text(["Copy link", "Open link"])
        expect(ui.locator("#drStatus")).not_to_contain_text("first")
        expect(ui.locator("#drLinks")).to_have_count(0)
        expect(ui.locator("#drAddCard")).to_be_hidden()
        assert ev("figma.root.children.map(p => p.name)") == ["2026-05 - Homepage", "For Designers"]
        # on the page it is a text link that says "GDrive link to folder"
        added = "figma.root.children[1].children[0].children[1]"
        assert ev("[%s.type, %s.characters, %s.textDecoration]" % (added, added, added)) == ["TEXT", "GDrive link to folder", "UNDERLINE"]
        assert ev("%s._links[0].url" % added) == "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz"
        expect(ui.locator("#drStatus .link-label")).to_have_text("GDrive link to folder")
        page.frames[1].evaluate("document.getElementById('toast').hidden = true")
        shot("11-drive-link")
        ui.locator("#drStatus .link .btn").nth(1).click()           # Open link
        page.wait_for_function("env.log.opened.length === 1")
        assert ev("env.log.opened") == ["https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz"]
        ui.locator("#drStatus .link .btn").nth(0).click()           # Copy link
        expect(ui.locator("#toast")).to_have_text("Link copied")

        # other Google links on the page are not listed: still the one link
        ev("""(() => { const pg = figma.root.children[1]; const t = env.make('TEXT', { name: 'Sheet', y: -50, characters: 'Asset tracker',
              links: [{ start: 0, end: 13, url: 'https://docs.google.com/spreadsheets/d/1trk/edit' }] }); pg.children.push(t); t.parent = pg; })()""")
        ui.locator('#drStatus button[title="Look again"]').click()
        expect(ui.locator("#toast")).to_have_text("Google Drive link found")
        expect(ui.locator("#drStatus .link")).to_have_count(1)
        expect(ui.locator("#drStatus .link-label")).to_have_text("GDrive link to folder")
        expect(ui.locator("#drStatus")).not_to_contain_text("Asset tracker")

        # the link is deleted in Figma: the screen offers to add it again
        ev("%s.remove()" % added)
        ev("figma.root.children[1].children[1].remove()")
        ui.locator('#drStatus button[title="Look again"]').click()
        expect(ui.locator("#drStatus .status-text b")).to_have_text("No Google Drive link yet")
        expect(ui.locator("#drAddCard")).to_be_visible()
        expect(ui.locator("#drAddText")).to_have_text("Add link")
        page.frames[1].evaluate("document.getElementById('toast').hidden = true")
        shot("11-drive-empty")
        ui.locator("#back").click()

        # ── narrow window + dark theme ──
        ev("env.select([demo.d1])")
        page.set_viewport_size({"width": 300, "height": 560})
        ui.locator('[data-go="renamer"]').click()
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_Mockups_AllfitAutomotiveAndParts_V1R1")
        shot("12-renamer-narrow")
        overflow = page.frames[1].evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        assert not overflow, "no horizontal scroll at 300px"
        page.set_viewport_size({"width": 360, "height": 600})
        page.frames[1].evaluate("document.documentElement.classList.add('figma-dark')")
        shot("13-renamer-dark")
        ui.locator("#back").click()
        shot("14-home-dark")
        page.frames[1].evaluate("document.documentElement.classList.remove('figma-dark')")

        # ── the plugin never went online ──
        assert ev("env.log.fetched || []") == [], "no network request was made"

        browser.close()
        server.shutdown()

run()
if errors:
    print("PAGE ERRORS:\n  " + "\n  ".join(errors)); sys.exit(1)
print(f"e2e ok — screenshots in {OUT}")
