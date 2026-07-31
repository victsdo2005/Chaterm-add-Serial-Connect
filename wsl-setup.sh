#!/usr/bin/env bash
# ===========================================================================
# 在 WSL2 Ubuntu 内构建并运行 Chaterm —— 本机 Windows 无需安装任何 MSVC / C++
# 构建工具。串口设备用 Windows 的 COM 口，在 WSL2 中映射为 /dev/ttyS*。
#
# 用法（在你的 WSL2 Ubuntu 终端里，进入 Chaterm 项目目录后执行）：
#     bash wsl-setup.sh
# ===========================================================================
set -euo pipefail
cd "$(dirname "$0")"

echo ">> [1/4] 安装 Linux 构建工具链 (gcc/python，仅装在 WSL，不碰 Windows MSVC)"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
    curl git ca-certificates \
    build-essential python3 python3-pip pkg-config libssl-dev \
    libgtk-3-0 libnss3 libasound2 libdrm2 libgbm1 libxshmfence1 \
    libx11-xcb1 libxcb-dri3-0 libxcomposite1 libxcursor1 libxdamage1 \
    libxi6 libxtst6 libpango-1.0-0 libcairo2 libcups2 libxrandr2 \
    dpkg fakeroot

echo ">> [2/4] 安装 Node.js 22"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs

echo ">> [3/4] npm install（在 WSL 内编译 serialport + better-sqlite3 为 Linux 原生模块）"
npm install --registry=https://registry.npmmirror.com

echo ">> [4/4] 构建并打包 Linux AppImage/deb（在 WSL2 内运行）"
npm run build
npx electron-builder --linux --x64

echo ">> 完成。产物在 ./dist"
echo ">> 运行：chmod +x dist/Chaterm-*-linux-x64.AppImage && ./dist/Chaterm-*-linux-x64.AppImage"
echo ">> Windows COM 口在 WSL2 中对应：COM1=/dev/ttyS0, COM2=/dev/ttyS1, COM3=/dev/ttyS2 ..."
