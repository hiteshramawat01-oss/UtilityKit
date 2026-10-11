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

def release(version, marker):
    """The real plugin files re-stamped as another version: what a later release looks like on GitHub."""
    code = (ROOT.parent / "code.js").read_text()
    html = (ROOT.parent / "ui.html").read_text()
    code = re.sub(r"var UK = \{ VERSION: '[\d.]+' \}", "var UK = { VERSION: '%s' }" % version, code)
    html = re.sub(r'(utilitykit-version" content=")[\d.]+', r"\g<1>%s" % version, html)
    html = html.replace("Everyday design utilities in one place.", marker)
    return {"v": '{"version":"%s","notes":["New: something useful."]}' % version, "code": code, "html": html}

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
        expect(ui.locator("#version")).to_have_text("v1.7.0")
        expect(ui.locator("#selPill")).to_be_hidden()                # no selection count on Home
        expect(ui.locator("#updCheck")).to_have_count(0)             # the footer is just the version…
        vbox = ui.locator("#version").bounding_box()
        assert abs((vbox["x"] + vbox["width"] / 2) - 180) < 2, "…centred"
        box = ui.locator("#openSettings").bounding_box()
        assert box["x"] + box["width"] > 360 - 16 and box["y"] < 48, "gear sits in the top-right corner"
        shot("01-home")

        # ── Settings: check for updates ──
        ui.locator("#openSettings").click()
        expect(ui.locator("#title")).to_have_text("Settings")
        expect(ui.locator("#openSettings")).to_be_hidden()
        expect(ui.locator("#selPill")).to_be_hidden()
        expect(ui.locator("#stVersion")).to_have_text("Installed: v1.7.0")
        expect(ui.locator("#stRemove")).to_be_hidden()
        ui.locator("#stCheck").click()                               # repository has no version.json / is private
        expect(ui.locator("#toast")).to_contain_text("may be private")
        expect(ui.locator("#stUpdBox")).to_be_hidden()
        assert "raw.githubusercontent.com/hiteshramawat01-oss/UtilityKit/main/version.json" in ev("env.log.fetched[0]")
        ev("window.__versionJson = 'offline'")
        ui.locator("#stCheck").click()
        expect(ui.locator("#toast")).to_contain_text("Couldn’t reach GitHub")
        ev("window.__versionJson = JSON.stringify({ version: UK.VERSION })")
        ui.locator("#stCheck").click()
        expect(ui.locator("#toast")).to_have_text("You’re up to date (v1.7.0).")
        expect(ui.locator("#stUpdBox")).to_be_hidden()
        ev("""window.__versionJson = JSON.stringify({ version: '9.9.0', released: '2026-11-02',
              notes: ['New: Export presets.', 'Fix: renaming inside instances.'],
              download: 'https://evil.example.com/malware.zip' })""")
        ui.locator("#stCheck").click()
        expect(ui.locator("#stUpdBox")).to_contain_text("Version 9.9.0 is available")
        expect(ui.locator("#stUpdBox")).to_contain_text("You have v1.7.0. Released 2026-11-02.")
        expect(ui.locator("#stUpdBox li")).to_have_count(2)
        expect(ui.locator("#stCheck")).to_have_text("Check for updates")
        expect(ui.locator('#stUpdBox [data-act="install"]')).to_have_text("Update now")
        shot("01c-settings")
        ui.locator('#stUpdBox [data-act="download"]').click()          # "Get the files instead"
        page.wait_for_function("env.log.opened.length === 1")
        assert ev("env.log.opened") == ["https://github.com/hiteshramawat01-oss/UtilityKit/archive/refs/heads/main.zip"], "a foreign download link is never opened"
        ev("env.log.opened.length = 0")
        ui.locator("#stRepo").click()
        page.wait_for_function("env.log.opened.length === 1")
        assert ev("env.log.opened") == ["https://github.com/hiteshramawat01-oss/UtilityKit"]
        ev("env.log.opened.length = 0")
        ui.locator("#stUpdBox .btn", has_text="Later").click()
        expect(ui.locator("#stUpdBox")).to_be_hidden()
        ui.locator("#back").click()
        expect(ui.locator("#brand")).to_be_visible()
        expect(ui.locator("#openSettings")).to_be_visible()

        # ── Layer Renamer: the client is asked once, before anything else ──
        CLIENT = "All-fit Automotive & Parts"
        FILE = "JSON.parse(figma.root.getPluginData('utilitykit.file.v1') || '{}')"
        ui.locator('[data-go="renamer"]').click()
        expect(ui.locator("#rnAsk")).to_be_visible()
        expect(ui.locator("#rnAskTitle")).to_have_text("Who is this file for?")
        expect(ui.locator("#rnForm")).to_be_hidden()
        expect(ui.locator("#rnActions")).to_be_hidden()
        expect(ui.locator("#openSettings")).to_be_hidden()           # no settings icon inside a utility
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

        # Marketing uses the same client; size is read from the frame
        ui.locator('input[name="rnMode"][value="marketing"]').check(force=True)
        expect(ui.locator("#rnWeb")).to_be_hidden()
        expect(ui.locator("#rnExampleName")).to_have_text("Add the deliverable type, for example MetaAds.")
        expect(ui.locator("#rnRenameBtn")).to_be_disabled()
        ui.locator("#rnDeliverable").fill("Meta Ads")
        ui.locator("#rnTask").fill("the black friday sale")
        expect(ui.locator("#rnExampleName")).to_have_text("1600x3000_MetaAds_BlackFridaySale_AllfitAutomotiveAndParts_V1")
        ui.locator("#rnVariation").fill("b")
        expect(ui.locator("#rnExampleName")).to_have_text("1600x3000_MetaAds_BlackFridaySale_AllfitAutomotiveAndParts_V1_B")
        ui.locator("#rnIncludeSize").uncheck(force=True)
        expect(ui.locator("#rnExampleName")).to_have_text("MetaAds_BlackFridaySale_AllfitAutomotiveAndParts_V1_B")
        shot("03-renamer-marketing")
        ui.locator("#rnIncludeSize").check(force=True)
        ui.locator("#rnVariation").fill("")
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
        assert ev(FILE) == {"client": CLIENT, "phase": "Mockups", "mode": "web", "deliverable": "Meta Ads", "task": "the black friday sale"}
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
        expect(ui.locator("#version")).to_have_text("v1.7.0")
        ui.locator('[data-go="renamer"]').click()
        expect(ui.locator("#rnForm")).to_be_visible()
        expect(ui.locator("#rnAsk")).to_be_hidden()
        expect(ui.locator("#rnClientName")).to_have_text("AllfitAutomotiveAndParts")
        ui.locator("#back").click()
        ev("(v) => figma.root.setPluginData('utilitykit.file.v1', v)", saved_file)
        ev("launch()")
        expect(ui.locator("#version")).to_have_text("v1.7.0")

        # ── Settings: reset ──
        ui.locator("#openSettings").click()
        ui.locator("#stReset").click()
        expect(ui.locator("#stResetConfirm")).to_be_visible()
        ui.locator("#stResetCancel").click()
        assert ev("JSON.parse(env.storage['utilitykit.settings.v1']).renamer.phase") == "Mockups", "cancel changes nothing"
        ui.locator("#stReset").click()
        shot("01d-settings-reset")
        ui.locator("#stResetYes").click()
        expect(ui.locator("#toast")).to_have_text("Settings reset to defaults")
        assert ev("JSON.parse(env.storage['utilitykit.settings.v1']).renamer.phase") == ""
        assert ev(FILE + ".client") == CLIENT, "the file keeps its own client"
        ui.locator("#back").click()
        ui.locator('[data-go="renamer"]').click()
        expect(ui.locator("#rnClientName")).to_have_text(CLIENT)                # still known: not asked again
        expect(ui.locator("#rnAsk")).to_be_hidden()
        ui.locator("#back").click()

        # ── Flatten & Merge: one action; the layers become [Print], in place ──
        ev("env.select([demo.a, demo.b])")
        ui.locator('[data-go="flatten"]').click()
        expect(ui.locator('section[data-screen="flatten"] .btn')).to_have_count(1)     # one button, no options
        expect(ui.locator("#flMerge")).to_have_text("Merge into one")
        expect(ui.locator("#flEach, #flScale, #flConfirm, input[name=flOriginals]")).to_have_count(0)
        expect(ui.locator('section[data-screen="flatten"]')).not_to_contain_text("Options")
        expect(ui.locator("#flSummary")).to_contain_text("1,440 × 1,600 px")
        expect(ui.locator("#flSummary")).to_contain_text("[Print]")
        expect(ui.locator("#flSummary")).to_contain_text("takes the place of these layers")
        shot("06-flatten")
        before = ev("env.all().length")
        top_level = ev("figma.currentPage.children.length")
        ui.locator("#flMerge").click()
        expect(ui.locator("#flBanner .note.success")).to_contain_text("Merged 2 layers into [Print]")
        expect(ui.locator("#flBanner .note.success")).to_contain_text("It is where the layers were")
        assert ev("env.all().length") == before - 1, "two layers out, one image in"
        assert ev("figma.currentPage.children.length") == top_level, "no new layer beside the artboard"
        assert ev("[demo.a.removed, demo.b.removed, demo.c.removed]") == [True, True, False]
        assert ev("demo.art.children.map(c => c.name)") == ["[Print]", "About - Design - Acme Corp - V1"]   # same spot in the layer list
        sel = "figma.currentPage.selection[0]"
        assert ev("[%s.name, %s.type, %s.parent === demo.art]" % (sel, sel, sel)) == ["[Print]", "RECTANGLE", True]
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

        # too big for one Figma image: pieces that fit together, in a [Print] group, still in place
        ev("window.longPage = env.add('FRAME', { name: 'Long page', x: 9000, y: 100, width: 1600, height: 9000 }); env.select([longPage])")
        expect(ui.locator("#flBanner .note")).to_have_count(0)      # the old result message is gone
        expect(ui.locator("#flMerge")).to_be_enabled()
        expect(ui.locator("#flSummary")).to_contain_text("1,600 × 9,000 px")
        expect(ui.locator("#flSummary")).to_contain_text("takes the place of this layer")
        expect(ui.locator("#flSummary .note.info")).to_contain_text("3 pieces that fit together exactly")
        shot("08-flatten-large")
        ui.locator("#flMerge").click()
        expect(ui.locator("#flBanner .note.success")).to_contain_text("Turned 1 layer into [Print]")
        expect(ui.locator("#flBanner .note.success")).to_contain_text("3 pieces")
        assert ev("[%s.name, %s.type, %s.x, %s.y]" % (sel, sel, sel, sel)) == ["[Print]", "GROUP", 9000, 100]
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

        # ── Google Drive Links ──
        ui.locator('[data-go="drive"]').click()
        expect(ui.locator("#drStatus")).to_contain_text("No “For Designers” page")
        expect(ui.locator("#drAddText")).to_have_text("Create page & add link")
        shot("10-drive-no-page")
        ui.locator("#drLabel").fill("Project folder")
        ui.locator("#drUrl").fill("https://dropbox.com/s/abc")
        ui.locator("#drAdd").click()
        expect(ui.locator("#drError")).to_contain_text("isn’t a Google Drive or Google Docs link")
        assert ev("figma.root.children.length") == 1, "no page created for a rejected link"
        ui.locator("#drUrl").fill("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz")
        ui.locator("#drAdd").click()
        expect(ui.locator("#drStatus")).to_contain_text("1 link found")
        ui.locator("#drLabel").fill("Creative brief")
        ui.locator("#drUrl").fill("docs.google.com/document/d/1xyz/edit")
        ui.locator("#drUrl").press("Enter")
        expect(ui.locator("#drStatus")).to_contain_text("2 links found")
        expect(ui.locator("#drLinks .link-label").nth(1)).to_have_text("Creative brief")
        assert ev("figma.root.children.map(p => p.name)") == ["2026-05 - Homepage", "For Designers"]
        shot("11-drive-links")
        ui.locator("#drStatus .quick .btn").nth(1).click()          # Open first
        page.wait_for_function("env.log.opened.length === 1")
        assert ev("env.log.opened") == ["https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz"]
        ui.locator("#drStatus .quick .btn").nth(0).click()          # Copy first
        expect(ui.locator("#toast")).to_be_visible()
        # a link added by hand in Figma shows up on rescan
        ev("""(() => { const pg = figma.root.children[1]; const t = env.make('TEXT', { name: 'Sheet', y: -50, characters: 'Asset tracker',
              links: [{ start: 0, end: 13, url: 'https://docs.google.com/spreadsheets/d/1trk/edit' }] }); pg.children.push(t); t.parent = pg; })()""")
        ui.locator('#drStatus button[title="Rescan"]').click()
        expect(ui.locator("#drStatus")).to_contain_text("3 links found")
        expect(ui.locator("#drLinks .link-label").first).to_have_text("Asset tracker")
        ui.locator("#back").click()

        # ── narrow window + dark theme ──
        ev("env.select([demo.d1])")
        page.set_viewport_size({"width": 300, "height": 560})
        ui.locator('[data-go="renamer"]').click()
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Desktop_AllfitAutomotiveAndParts_V1R1")
        shot("12-renamer-narrow")
        overflow = page.frames[1].evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        assert not overflow, "no horizontal scroll at 300px"
        page.set_viewport_size({"width": 360, "height": 600})
        page.frames[1].evaluate("document.documentElement.classList.add('figma-dark')")
        shot("13-renamer-dark")
        ui.locator("#back").click()
        shot("14-home-dark")
        page.frames[1].evaluate("document.documentElement.classList.remove('figma-dark')")

        # ── Update now: installs inside Figma, no files to replace ──
        KEY = "utilitykit.update.v1"
        load_release = "(f) => { window.__versionJson = f.v; window.__remoteFiles = { 'code.js': f.code, 'ui.html': f.html }; }"
        saved = lambda: ev("env.storage['%s'] ? JSON.parse(env.storage['%s']) : null" % (KEY, KEY))

        # a release that is only half published is refused and nothing changes
        half = release("9.9.0", "UPDATED BUILD 9.9.0")
        half["code"] = half["code"].replace("VERSION: '9.9.0'", "VERSION: '9.8.0'")
        ev(load_release, half)
        ui.locator("#openSettings").click()
        ui.locator("#stCheck").click()
        expect(ui.locator("#stUpdBox")).to_contain_text("Version 9.9.0 is available")
        ui.locator('#stUpdBox [data-act="install"]').click()
        expect(ui.locator("#toast")).to_contain_text("still being published")
        expect(ui.locator('#stUpdBox [data-act="install"]')).to_have_text("Update now")
        assert saved() is None
        expect(ui.locator("#stVersion")).to_have_text("Installed: v1.7.0")

        # the real thing
        ev(load_release, release("9.9.0", "UPDATED BUILD 9.9.0"))
        ui.locator('#stUpdBox [data-act="install"]').click()
        expect(ui.locator("#version")).to_have_text("v9.9.0")                   # the window restarted into the new version
        expect(ui.locator(".lede")).to_have_text("UPDATED BUILD 9.9.0")
        expect(ui.locator("#updBox")).to_be_hidden()
        page.wait_for_function("JSON.parse(env.storage['%s']).pending === false" % KEY)
        assert ev("env.listeners.selectionchange.length") == 1
        assert any("now on version 9.9.0" in n["message"] for n in ev("env.log.notifications"))
        shot("15-updated")
        # the updated copy is fully working
        ev("env.select([demo.c])")
        expect(ui.locator("#selText")).to_have_text("1 selected")
        ui.locator('[data-go="renamer"]').click()
        expect(ui.locator("#rnExampleName")).to_have_text("Homepage_Mockups_AllfitAutomotiveAndParts_V1")   # this file's own client and phase came back
        ui.locator("#back").click()
        ui.locator("#openSettings").click()
        ui.locator("#stCheck").click()
        expect(ui.locator("#toast")).to_have_text("You’re up to date (v9.9.0).")
        ui.locator("#back").click()

        # closing and reopening the plugin keeps the update
        ev("launch()")
        expect(ui.locator(".lede")).to_have_text("UPDATED BUILD 9.9.0")
        expect(ui.locator("#version")).to_have_text("v9.9.0")
        ui.locator("#openSettings").click()
        expect(ui.locator("#stVersion")).to_have_text("Installed: v9.9.0")
        expect(ui.locator("#stSource")).to_contain_text("The plugin folder still holds v1.7.0")
        expect(ui.locator("#stRemove")).to_have_text("Go back to v1.7.0")
        shot("16-settings-updated")

        # going back
        ui.locator("#stRemove").click()
        expect(ui.locator("#version")).to_have_text("v1.7.0")
        expect(ui.locator(".lede")).to_have_text("Everyday design utilities in one place.")
        page.wait_for_function("env.storage['%s'] === undefined" % KEY)

        # safety net: an update that started but never finished loading is dropped on the next launch
        ui.locator("#openSettings").click()
        ui.locator("#stCheck").click()
        ui.locator('#stUpdBox [data-act="install"]').click()
        expect(ui.locator("#version")).to_have_text("v9.9.0")
        page.wait_for_function("JSON.parse(env.storage['%s']).pending === false" % KEY)
        ev("(() => { const s = JSON.parse(env.storage['%s']); s.pending = true; env.storage['%s'] = JSON.stringify(s); })()" % (KEY, KEY))
        ev("launch()")
        expect(ui.locator("#version")).to_have_text("v1.7.0")
        expect(ui.locator("#toast")).to_contain_text("Update 9.9.0 didn’t start properly")
        assert saved() is None

        browser.close()
        server.shutdown()

run()
if errors:
    print("PAGE ERRORS:\n  " + "\n  ".join(errors)); sys.exit(1)
print(f"e2e ok — screenshots in {OUT}")
