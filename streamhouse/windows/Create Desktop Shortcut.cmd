@echo off
rem Puts a double-clickable StreamHouse icon on the desktop and Start Menu.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0shortcut.ps1"
pause
