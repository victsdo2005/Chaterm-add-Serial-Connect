# Chaterm Linux build image
# ---------------------------------------------------------------------------
# Compiles the native modules (serialport, better-sqlite3) INSIDE the
# container, so the Windows host needs NO MSVC / C++ build tools at all.
# Produces a Linux AppImage + deb (per electron-builder.yml `linux` target).
# ---------------------------------------------------------------------------
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# --- Linux-side toolchain + Electron runtime libraries ----------------------
# (none of this touches Windows; it lives entirely in the container)
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl git ca-certificates gnupg \
        build-essential python3 python3-pip pkg-config libssl-dev \
        libgtk-3-0 libnss3 libasound2 libdrm2 libgbm1 libxshmfence1 \
        libx11-xcb1 libxcb-dri3-0 libxcomposite1 libxcursor1 libxdamage1 \
        libxi6 libxtst6 libpango-1.0-0 libcairo2 libcups2 libxrandr2 \
        dpkg fakeroot \
    && rm -rf /var/lib/apt/lists/*

# --- Node.js 22 (matches the project's managed runtime) --------------------
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Faster CN mirrors (override with --build-arg to use upstream)
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
ENV ELECTRON_MIRROR=${ELECTRON_MIRROR}

WORKDIR /build

# Install deps first for better layer caching.
# The postinstall (`electron-builder install-app-deps`) rebuilds the native
# modules for Electron/Linux — the exact step that failed on Windows.
COPY package.json package-lock.json* ./
RUN npm install --registry=${NPM_REGISTRY}

# Copy the rest of the source
COPY . .

# Build renderer/main bundles, then package a Linux AppImage + deb.
# npmRebuild:true (electron-builder.yml) recompiles native deps for Electron.
# If `check:ffmpeg` / `check:external-deps` fail due to network, replace the
# first command with: npx electron-vite build
RUN npm run build \
    && npx electron-builder --linux --x64

CMD ["/bin/bash"]
