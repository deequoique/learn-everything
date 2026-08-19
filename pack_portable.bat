@echo off
chcp 65001 >nul
title 学习 Agent - 组装便携版

cd /d "%~dp0"

echo ============================================================
echo   学习 Agent - 组装可分发的便携版
echo ============================================================
echo.

call build_web.bat
if errorlevel 1 (
    echo [错误] 前端构建失败，停止组装便携版
    exit /b 1
)

REM 1. 先确保 exe 已打包
if not exist "dist\LearnEverything\LearnEverything.exe" (
    echo [!] 未找到打包好的 exe，先执行 build_exe.bat
    call build_exe.bat
)

REM 2. 组装便携版目录
set PORTABLE=dist\LearnEverything-Portable
echo [1/4] 清理旧的便携版目录...
if exist "%PORTABLE%" rmdir /s /q "%PORTABLE%"

echo [2/4] 复制 exe 和运行时...
mkdir "%PORTABLE%"
xcopy /E /I /Y "dist\LearnEverything\*" "%PORTABLE%\" >nul

echo [3/4] 复制学习 Agent 代码...
copy /Y custom_app.py "%PORTABLE%\" >nul
robocopy learning_ext "%PORTABLE%\learning_ext" /E /XD node_modules coverage playwright-report test-results /XF *.pyc >nul
if errorlevel 8 (
    echo [错误] learning_ext 复制失败
    exit /b 1
)
if not exist "%PORTABLE%\learning_ext\web\dist\index.html" (
    echo [错误] 便携版缺少前端构建产物
    exit /b 1
)
if exist "%PORTABLE%\learning_ext\web\node_modules" (
    echo [错误] 便携版不应包含 node_modules
    exit /b 1
)
if exist "%PORTABLE%\learning_ext\app.py" (
    echo [错误] 便携版不应包含已移除的旧 Web 入口
    exit /b 1
)
if exist "%PORTABLE%\learning_ext\pages" (
    echo [错误] 便携版不应包含已移除的页面目录
    exit /b 1
)
copy /Y README.md "%PORTABLE%\" >nul
copy /Y .env "%PORTABLE%\" >nul

echo [4/4] 复制 Kotaemon 运行时 (venv，体积较大，请耐心等待)...
xcopy /E /I /Y "kotaemon\.venv" "%PORTABLE%\kotaemon\.venv" >nul
REM 复制 Kotaemon 必需的非 venv 文件
copy /Y "kotaemon\flowsettings.py" "%PORTABLE%\kotaemon\" >nul
copy /Y "kotaemon\app.py" "%PORTABLE%\kotaemon\" >nul
xcopy /E /I /Y "kotaemon\libs" "%PORTABLE%\kotaemon\libs" >nul
if exist "kotaemon\templates" xcopy /E /I /Y "kotaemon\templates" "%PORTABLE%\kotaemon\templates" >nul

echo.
echo ============================================================
echo   便携版组装完成！
echo   位置: %PORTABLE%
echo.
echo   分发方式:
echo     把整个 LearnEverything-Portable 文件夹打包成 zip 即可分发
echo     用户解压后双击 LearnEverything.exe 直接运行 (首次需配 LLM key)
echo ============================================================
echo.
echo 提示: 便携版体积较大 (因含完整 Python venv)。
echo       如需更小体积，可去掉 venv，让用户首次运行 setup.bat 联网安装。
pause
