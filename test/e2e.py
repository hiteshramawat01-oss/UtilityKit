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
        expect(ui.locator("#version")).to_have_text("v1.3.1")
        expect(ui.locator("#selText")).to_have_text("0 selected")
        shot("01-home")

        # ── Check for updates ──
        ui.locator("#updCheck").click()                              # repository has no version.json / is private
        expect(ui.locator("#toast")).to_contain_text("may be private")
        expect(ui.locator("#updBox")).to_be_hidden()
        assert "raw.githubusercontent.com/hiteshramawat01-oss/UtilityKit/main/version.json" in ev("env.log.fetched[0]")
        ev("window.__versionJson = 'offline'")
        ui.locator("#updCheck").click()
        expect(ui.locator("#toast")).to_contain_text("Couldn’t reach GitHub")
        ev("window.__versionJson = JSON.stringify({ version: UK.VERSION })")
        ui.locator("#updCheck").click()
        expect(ui.locator("#toast")).to_have_text("You’re up to date (v1.3.1).")
        expect(ui.locator("#updBox")).to_be_hidden()
        ev("""window.__versionJson = JSON.stringify({ version: '9.9.0', released: '2026-11-02',
              notes: ['New: Export presets.', 'Fix: renaming inside instances.'],
              download: 'https://evil.example.com/malware.zip' })""")
        ui.locator("#updCheck").click()
        expect(ui.locator("#updBox")).to_contain_text("Version 9.9.0 is available")
        expect(ui.locator("#updBox")).to_contain_text("You have v1.3.1. Released 2026-11-02.")
        expect(ui.locator("#updBox li")).to_have_count(2)
        expect(ui.locator("#updCheck")).to_have_text("Check for updates")
        expect(ui.locator('#updBox [data-act="install"]')).to_have_text("Update now")
        shot("01b-home-update")
        ui.locator('#updBox [data-act="download"]').click()            # "Get the files instead"
        page.wait_for_function("env.log.opened.length === 1")
        assert ev("env.log.opened") == ["https://github.com/hiteshramawat01-oss/UtilityKit/archive/refs/heads/main.zip"], "a foreign download link is never opened"
        ev("env.log.opened.length = 0")
        ui.locator("#updBox .btn", has_text="Later").click()
        expect(ui.locator("#updBox")).to_be_hidden()

        # ── Settings (gear, top right) ──
        box = ui.locator("#openSettings").bounding_box()
        assert box["x"] + box["width"] > 360 - 16 and box["y"] < 48, "gear sits in the top-right corner"
        ui.locator("#openSettings").click()
        expect(ui.locator("#title")).to_have_text("Settings")
        expect(ui.locator("#openSettings")).to_be_hidden()
        expect(ui.locator("#stVersion")).to_have_text("Installed: v1.3.1")
        expect(ui.locator("#stRemove")).to_be_hidden()
        expect(ui.locator("#stUpdBox")).to_be_hidden()               # "Later" was pressed on Home
        ev("window.__versionJson = JSON.stringify({ version: '3.0.0', notes: ['New: something.'] })")
        ui.locator("#stCheck").click()
        expect(ui.locator("#stUpdBox")).to_contain_text("Version 3.0.0 is available")
        expect(ui.locator("#stCheck")).to_have_text("Check for updates")
        ui.locator("#stRepo").click()
        page.wait_for_function("env.log.opened.length === 1")
        assert ev("env.log.opened") == ["https://github.com/hiteshramawat01-oss/UtilityKit"]
        ev("env.log.opened.length = 0")
        shot("01c-settings")
        ui.locator("#stUpdBox .btn", has_text="Later").click()
        ui.locator("#back").click()
        expect(ui.locator("#brand")).to_be_visible()
        expect(ui.locator("#openSettings")).to_be_visible()

        # ── Layer Renamer ──
        ui.locator('[data-go="renamer"]').click()
        expect(ui.locator("#rnPreviewBtn")).to_be_disabled()
        expect(ui.locator("#rnExampleName")).to_have_text("Select layers on the canvas")
        ev("env.select([demo.a, demo.b, demo.c])")
        expect(ui.locator("#selText")).to_have_text("3 selected")
        ui.locator('[data-key="phase"] input.input').fill("design")
        ui.locator('[data-key="client"] input.input').fill("acme corp")
        ui.locator('[data-key="version"] input.input').fill("1")
        expect(ui.locator("#rnExampleName")).to_have_text("Home Page - Design - Acme Corp - V1")
        expect(ui.locator("#rnPreviewBtn")).to_have_text("Preview 3 layers")
        shot("02-renamer")

        # reorder + switch off + separator all feed the live preview
        ui.locator('[data-key="client"] button[title="Move earlier"]').click()
        ui.locator('[data-key="client"] button[title="Move earlier"]').click()
        expect(ui.locator("#rnExampleName")).to_have_text("Acme Corp - Home Page - Design - V1")
        ui.locator('[data-key="phase"] .switch').click()
        expect(ui.locator("#rnExampleName")).to_have_text("Acme Corp - Home Page - V1")
        ui.locator("#rnAdvanced summary").click()
        ui.locator('#rnSeparator [data-value="pipe"]').click()
        expect(ui.locator("#rnExampleName")).to_have_text("Acme Corp | Home Page | V1")
        shot("03-renamer-advanced")
        # put it back
        ui.locator('#rnSeparator [data-value="dash"]').click()
        ui.locator('[data-key="phase"] .switch').click()
        ui.locator('[data-key="client"] button[title="Move later"]').click()
        ui.locator('[data-key="client"] button[title="Move later"]').click()
        expect(ui.locator("#rnExampleName")).to_have_text("Home Page - Design - Acme Corp - V1")

        # all fields off -> blocked with a reason
        for key in ["page", "phase", "client", "version"]:
            ui.locator(f'[data-key="{key}"] .switch').click()
        expect(ui.locator("#rnExampleName")).to_have_text("Add at least one field")
        expect(ui.locator("#rnPreviewBtn")).to_be_disabled()
        for key in ["page", "phase", "client", "version"]:
            ui.locator(f'[data-key="{key}"] .switch').click()

        # ── Rename Preview ──
        ui.locator("#rnPreviewBtn").click()
        expect(ui.locator("#title")).to_have_text("Rename Preview")
        expect(ui.locator("#pvSelected")).to_have_text("3")
        expect(ui.locator("#pvRename")).to_have_text("2")
        expect(ui.locator("#pvUnchanged")).to_have_text("1")
        expect(ui.locator("#pvApply")).to_have_text("Apply to 2 layers")
        assert ev("demo.a.name") == "2026-05 - home page", "preview must not rename"
        shot("04-preview")

        # selection changes while previewing -> preview follows it
        ev("env.select([demo.a, demo.b])")
        expect(ui.locator("#pvSelected")).to_have_text("2")
        ev("env.select([demo.a, demo.b, demo.c])")
        expect(ui.locator("#pvSelected")).to_have_text("3")

        ui.locator("#pvApply").click()
        expect(ui.locator("#pvRenameLabel")).to_have_text("Renamed")
        expect(ui.locator("#pvApply")).to_have_text("Done")
        assert ev("[demo.a.name, demo.b.name, demo.c.name]") == [
            "Home Page - Design - Acme Corp - V1", "Pricing Page - Design - Acme Corp - V1", "About - Design - Acme Corp - V1"]
        shot("05-preview-applied")
        ui.locator("#pvApply").click()
        expect(ui.locator("#brand")).to_be_visible()

        # settings were saved and come back
        assert ev("JSON.parse(env.storage['utilitykit.settings.v1']).renamer.client") == "acme corp"
        assert ev("JSON.parse(figma.root.getPluginData('utilitykit.file.v1')).client") == "acme corp"

        # ── Settings: reset, opened from inside a utility, and Back returns there ──
        ui.locator('[data-go="renamer"]').click()
        ui.locator("#openSettings").click()
        ui.locator("#stReset").click()
        expect(ui.locator("#stResetConfirm")).to_be_visible()
        ui.locator("#stResetCancel").click()
        assert ev("JSON.parse(env.storage['utilitykit.settings.v1']).renamer.client") == "acme corp", "cancel changes nothing"
        ui.locator("#stReset").click()
        shot("01d-settings-reset")
        ui.locator("#stResetYes").click()
        expect(ui.locator("#toast")).to_have_text("Settings reset to defaults")
        assert ev("JSON.parse(env.storage['utilitykit.settings.v1']).renamer.client") == ""
        assert ev("JSON.parse(figma.root.getPluginData('utilitykit.file.v1')).client") == "acme corp", "the file keeps its own client"
        ui.locator("#back").click()
        expect(ui.locator("#title")).to_have_text("Layer Renamer")
        expect(ui.locator('[data-key="client"] input.input')).to_have_value("")
        ui.locator("#back").click()

        # ── Flatten & Merge ──
        ui.locator('[data-go="flatten"]').click()
        expect(ui.locator("#flMerge")).to_be_visible()
        expect(ui.locator("#flEach")).to_have_text("Flatten each (3)")
        shot("06-flatten")
        before = ev("env.all().length")
        ui.locator("#flMerge").click()
        expect(ui.locator("#flBanner .note.success")).to_contain_text("Merged 3 layers into one image")
        assert ev("env.all().length") == before + 3, "three seamless tiles in one group (2880 x 4800 px at 2x)"
        assert ev("figma.currentPage.selection[0].name") == "Merged — 3 layers"
        assert ev("[demo.a.removed, demo.b.removed, demo.c.removed]") == [False, False, False]
        shot("07-flatten-done")
        ui.locator("#flBanner .btn").click()
        page.wait_for_function("env.log.zoomed && env.log.zoomed.length === 1")

        # replace asks first
        ev("env.select([demo.a, demo.b])")
        ui.locator('input[name="flOriginals"][value="replace"]').check(force=True)
        ui.locator("#flEach").click()
        expect(ui.locator("#flConfirm")).to_be_visible()
        expect(ui.locator("#flConfirmText")).to_contain_text("Replace 2 original layers")
        expect(ui.locator("#flBanner .note")).to_have_count(0)      # old result message is gone
        assert ev("[demo.a.removed, demo.b.removed]") == [False, False]
        shot("08-flatten-confirm")
        ui.locator("#flCancel").click()
        expect(ui.locator("#flActions")).to_be_visible()
        assert ev("[demo.a.removed, demo.b.removed]") == [False, False]
        ui.locator("#flEach").click()
        ui.locator("#flConfirmBtn").click()
        expect(ui.locator("#flBanner .note.success")).to_contain_text("2 originals replaced")
        assert ev("[demo.a.removed, demo.b.removed, demo.c.removed]") == [True, True, False]

        # nothing selected
        ev("env.select([])")
        expect(ui.locator("#flSummary")).to_contain_text("Nothing selected")
        expect(ui.locator("#flBanner .note")).to_have_count(0)
        expect(ui.locator("#flEach")).to_be_disabled()
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
        assert ev("figma.root.children.map(p => p.name)") == ["Page 1", "For Designers"]
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
        ev("env.select([demo.c])")
        page.set_viewport_size({"width": 300, "height": 560})
        ui.locator('[data-go="renamer"]').click()
        expect(ui.locator("#rnExampleName")).to_have_text("About - Design - Acme Corp - V1")
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
        ui.locator("#updCheck").click()
        expect(ui.locator("#updBox")).to_contain_text("Version 9.9.0 is available")
        ui.locator('#updBox [data-act="install"]').click()
        expect(ui.locator("#toast")).to_contain_text("still being published")
        expect(ui.locator('#updBox [data-act="install"]')).to_have_text("Update now")
        assert saved() is None
        expect(ui.locator("#version")).to_have_text("v1.3.1")

        # the real thing
        ev(load_release, release("9.9.0", "UPDATED BUILD 9.9.0"))
        ui.locator('#updBox [data-act="install"]').click()
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
        expect(ui.locator("#rnExampleName")).to_have_text("About - Design - Acme Corp - V1")   # this file's own client/phase/version came back
        ui.locator("#back").click()
        ui.locator("#updCheck").click()
        expect(ui.locator("#toast")).to_have_text("You’re up to date (v9.9.0).")

        # closing and reopening the plugin keeps the update
        ev("launch()")
        expect(ui.locator(".lede")).to_have_text("UPDATED BUILD 9.9.0")
        expect(ui.locator("#version")).to_have_text("v9.9.0")
        ui.locator("#openSettings").click()
        expect(ui.locator("#stVersion")).to_have_text("Installed: v9.9.0")
        expect(ui.locator("#stSource")).to_contain_text("The plugin folder still holds v1.3.1")
        expect(ui.locator("#stRemove")).to_have_text("Go back to v1.3.1")
        shot("16-settings-updated")

        # going back
        ui.locator("#stRemove").click()
        expect(ui.locator("#version")).to_have_text("v1.3.1")
        expect(ui.locator(".lede")).to_have_text("Everyday design utilities in one place.")
        page.wait_for_function("env.storage['%s'] === undefined" % KEY)

        # safety net: an update that started but never finished loading is dropped on the next launch
        ui.locator("#updCheck").click()
        ui.locator('#updBox [data-act="install"]').click()
        expect(ui.locator("#version")).to_have_text("v9.9.0")
        page.wait_for_function("JSON.parse(env.storage['%s']).pending === false" % KEY)
        ev("(() => { const s = JSON.parse(env.storage['%s']); s.pending = true; env.storage['%s'] = JSON.stringify(s); })()" % (KEY, KEY))
        ev("launch()")
        expect(ui.locator("#version")).to_have_text("v1.3.1")
        expect(ui.locator("#toast")).to_contain_text("Update 9.9.0 didn’t start properly")
        assert saved() is None

        browser.close()
        server.shutdown()

run()
if errors:
    print("PAGE ERRORS:\n  " + "\n  ".join(errors)); sys.exit(1)
print(f"e2e ok — screenshots in {OUT}")
