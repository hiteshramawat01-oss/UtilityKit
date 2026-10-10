#!/bin/bash
# UtilityKit updater for macOS.
# Double-click this file, or run:  bash update.command
#
# - If this folder is a git clone, it runs "git pull".
# - Otherwise it downloads the latest files from GitHub and copies them over
#   the ones here. Nothing is deleted.
# Afterwards, run UtilityKit again in Figma: Figma reads the files fresh each time.

REPO="hiteshramawat01-oss/UtilityKit"
BRANCH="main"
ZIP_URL="${UTILITYKIT_ZIP_URL:-https://github.com/$REPO/archive/refs/heads/$BRANCH.zip}"

cd "$(dirname "$0")" || exit 1

installed() { sed -n 's/.*"version"[^"]*"\([^"]*\)".*/\1/p' version.json 2>/dev/null | head -1; }
finish() {
  echo
  if [ -t 0 ]; then read -n 1 -s -r -p "Press any key to close."; echo; fi
  exit "$1"
}

echo "UtilityKit updater"
echo "Folder:    $(pwd)"
if [ ! -f manifest.json ] || [ ! -f code.js ]; then
  echo "This doesn't look like the UtilityKit plugin folder (manifest.json / code.js not found)."
  echo "Keep update.command inside the plugin folder and run it from there."
  finish 1
fi
before="$(installed)"
echo "Installed: ${before:-unknown}"
echo

if [ -d .git ] && command -v git >/dev/null 2>&1; then
  echo "Updating with git..."
  if ! git pull --ff-only; then
    echo
    echo "Git couldn't update this folder. Usual causes: files here were edited, or you"
    echo "are not signed in to GitHub with access to the repository."
    finish 1
  fi
else
  tmp="$(mktemp -d)" || finish 1
  trap 'rm -rf "$tmp"' EXIT
  echo "Downloading the latest version..."
  if ! curl -fsSL "$ZIP_URL" -o "$tmp/utilitykit.zip"; then
    echo
    echo "The download failed. If the repository is private, download the ZIP in your"
    echo "browser instead (Code > Download ZIP) and replace the files in this folder:"
    echo "  https://github.com/$REPO"
    finish 1
  fi
  if ! unzip -q "$tmp/utilitykit.zip" -d "$tmp/unzipped"; then
    echo "The downloaded file could not be unzipped. Nothing was changed."
    finish 1
  fi
  manifest="$(find "$tmp/unzipped" -maxdepth 2 -name manifest.json -print | head -1)"
  src="$(dirname "$manifest")"
  if [ -z "$manifest" ] || [ ! -f "$src/code.js" ] || [ ! -f "$src/ui.html" ] || ! grep -q '"name"[^"]*"UtilityKit"' "$manifest"; then
    echo "The download doesn't contain the UtilityKit plugin files. Nothing was changed."
    finish 1
  fi
  if ! cp -R "$src"/. .; then
    echo "Some files could not be copied into this folder."
    finish 1
  fi
fi

after="$(installed)"
echo
if [ "$before" = "$after" ]; then
  echo "Already up to date (${after:-unknown})."
else
  echo "Updated: ${before:-unknown} -> ${after:-unknown}"
fi
echo "Run UtilityKit again in Figma to use it."
finish 0
