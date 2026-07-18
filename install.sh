#!/usr/bin/env bash
# opti-moa 一键安装脚本
# Usage: curl -fsSL https://raw.githubusercontent.com/haichen1985/opti-moa/main/install.sh | bash
set -euo pipefail

echo "╔══════════════════════════════════╗"
echo "║     opti-moa 一键安装            ║"
echo "╚══════════════════════════════════╝"

# Check Node.js >= 18
if ! command -v node &>/dev/null; then
  echo "❌ 需要 Node.js >= 18，请先安装: https://nodejs.org"
  exit 1
fi
NODE_VER=$(node -v | cut -dv -f2 | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js 版本过低 ($(node -v))，需要 >= 18"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# Check npm
if ! command -v npm &>/dev/null; then
  echo "❌ npm 未安装"
  exit 1
fi

# Install globally
echo "📦 安装 opti-moa..."
npm install -g opti-moa 2>/dev/null || {
  # Fallback: install from source
  echo "📦 从源码安装..."
  TMPDIR=$(mktemp -d)
  git clone --depth 1 https://github.com/haichen1985/opti-moa.git "$TMPDIR/opti-moa"
  cd "$TMPDIR/opti-moa"
  npm install
  npm run build
  npm install -g .
  cd - >/dev/null
  rm -rf "$TMPDIR"
}

echo ""
echo "✅ 安装完成！"
echo ""
echo "使用方法:"
echo "  opti-moa          # 首次运行会进入配置向导"
echo "  opti-moa --help   # 查看帮助"
echo ""
echo "配置完成后，将任何 OpenAI 兼容客户端的 base_url 指向:"
echo "  http://127.0.0.1:8080/v1"
echo ""
