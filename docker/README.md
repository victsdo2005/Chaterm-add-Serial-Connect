# Chaterm — Linux Docker 构建

目标：在 Linux 容器里编译原生模块（`serialport`、`better-sqlite3`）并打包
Chaterm，**本机（Windows）无需安装任何 MSVC / C++ 构建工具**。

> ⚠️ 平台说明：容器里编出的原生模块是 Linux 格式（`.node` ELF），
> **只能在 Linux 上运行，不能在 Windows 上跑**。
> 因此此方案成立的前提是：**串口设备接在那台 Linux 上，且 Chaterm 也跑在那台 Linux 上**
> （典型场景：USB-TTL 接树莓派 / 路由器 / 嵌入式板 console）。

## 用法

在装有 Docker 的 Linux 机器上，把整个 Chaterm 项目目录拷过去（含本 `docker/` 文件夹），然后：

```bash
cd Chaterm
bash docker/build.sh
```

构建完成后，产物（`.AppImage`、`.deb`）导出到 `./dist-linux`。

或者直接手敲：

```bash
docker build -t chaterm-builder -f docker/Dockerfile .
# 进容器调试：
docker run --rm -it -v "$PWD":/src chaterm-builder bash
```

## 运行 Chaterm（需要图形界面）

打包出的 AppImage 需要 Linux 桌面环境。在无显示服务器的远程 Linux 上：

- **X11 转发**（推荐，终端类应用足够）：
  ```bash
  ssh -X user@linux-server
  # 在服务器上：
  chmod +x dist-linux/Chaterm-*-linux-x64.AppImage
  ./dist-linux/Chaterm-*-linux-x64.AppImage
  ```
- **VNC / 桌面会话**：在服务器装 `x11vnc` 或 `gnome`，用 VNC 客户端连入。

## 串口设备

把串口设备挂进运行环境即可，例如 `/dev/ttyUSB0`、`/dev/ttyACM0`、
`/dev/ttyS0`。在「新建主机」里选择 **Serial / 串口设备**，
路径填 `/dev/ttyUSB0`，再设波特率等参数。

## 自定义

- 换上游源：`docker build --build-arg NPM_REGISTRY=https://registry.npmjs.org --build-arg ELECTRON_MIRROR=https://github.com/electron/electron/releases/download .`
- 编其他架构（如 arm64）：把 `build.sh` / Dockerfile 里的 `--x64` 改为 `--arm64`。
- 若 `npm run build` 里的 `check:ffmpeg` / `check:external-deps` 因网络失败，
  把 Dockerfile 中 `RUN npm run build` 改为 `RUN npx electron-vite build`。
