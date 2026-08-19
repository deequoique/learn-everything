@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0learning_ext\web"

where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 构建前端需要 Node.js 20.19 或更高版本。
    exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)"
if errorlevel 1 (
    echo [错误] Node.js 版本过低，需要 20.19 或更高版本。
    exit /b 1
)

echo [1/3] 安装锁定的前端依赖...
call npm ci
if errorlevel 1 exit /b 1
echo [2/3] 运行前端测试...
call npm run test -- --run
if errorlevel 1 exit /b 1
echo [3/3] 构建生产前端...
call npm run build
if errorlevel 1 exit /b 1
if not exist "dist\index.html" (
    echo [错误] 前端构建未生成 dist\index.html
    exit /b 1
)
echo [OK] 前端构建完成。
