@echo off
chcp 65001 >nul
title LearnEverything
cd /d "%~dp0"
echo 学习 Agent 启动中... (首次约 90 秒，请稍候)
echo.
kotaemon\.venv\Scripts\python.exe launcher.py
pause
