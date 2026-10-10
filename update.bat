@echo off
rem UtilityKit updater for Windows. Double-click this file.
rem - If this folder is a git clone, it runs "git pull".
rem - Otherwise it opens the download so you can replace the files here.
rem Afterwards, run UtilityKit again in Figma.
setlocal
cd /d "%~dp0"

echo UtilityKit updater
echo Folder: %cd%
echo.

if not exist manifest.json (
  echo This doesn't look like the UtilityKit plugin folder ^(manifest.json not found^).
  echo Keep update.bat inside the plugin folder and run it from there.
  goto done
)

if not exist .git goto download
where git >nul 2>nul
if errorlevel 1 goto download

echo Updating with git...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo Git couldn't update this folder. Usual causes: files here were edited, or you
  echo are not signed in to GitHub with access to the repository.
) else (
  echo.
  echo Done. Run UtilityKit again in Figma to use the new version.
)
goto done

:download
echo This folder is not a git clone, so it can't update itself.
echo Opening the download in your browser...
start "" "https://github.com/hiteshramawat01-oss/UtilityKit/archive/refs/heads/main.zip"
echo.
echo Unzip it and copy the files over the ones in this folder:
echo   %cd%
echo Then run UtilityKit again in Figma.

:done
echo.
pause
