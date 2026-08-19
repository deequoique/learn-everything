#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$ROOT_DIR/learning_ext/web"

if ! command -v node >/dev/null 2>&1; then
    echo "构建前端需要 Node.js 20.19 或更高版本。"
    exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)'
npm ci
npm run test -- --run
npm run build
test -f dist/index.html
echo "[OK] 前端构建完成。"
