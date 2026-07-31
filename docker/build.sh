#!/usr/bin/env bash
# Build Chaterm Linux artifacts with Docker — no Windows MSVC required.
# Run from the Chaterm project root:
#     bash docker/build.sh
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE=chaterm-builder:local
echo ">> Building Docker image ${IMAGE} ..."
docker build -t "${IMAGE}" -f docker/Dockerfile .

echo ">> Extracting build artifacts (AppImage + deb) ..."
docker create --name chaterm-extract "${IMAGE}" >/dev/null
mkdir -p dist-linux
# electron-builder default out is dist/; some configs use release/
docker cp chaterm-extract:/build/dist/. dist-linux/ 2>/dev/null || true
docker cp chaterm-extract:/build/release/. dist-linux/ 2>/dev/null || true
docker rm -f chaterm-extract >/dev/null

echo ">> Done. Artifacts are in ./dist-linux"
ls -lh dist-linux 2>/dev/null || true
