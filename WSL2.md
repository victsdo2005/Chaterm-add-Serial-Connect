# Chaterm — WSL2 构建（Windows COM 口，免装 MSVC）

目标：**在 Windows 上用 Chaterm 连 COM 口，但本机不装任何 Visual Studio / MSVC**。
做法：在 WSL2 的 Ubuntu 里构建并运行 Chaterm（Linux 原生模块在 WSL 内编译），
Windows 的 COM 口会在 WSL2 中映射成 `/dev/ttyS*`，直接在 Chaterm 里填即可。

## 1. 启用 WSL2（Windows 自带功能，不是"下载构建工具"）

以**管理员**打开 PowerShell，执行：

```powershell
wsl --install
# 装完重启；默认会装 Ubuntu。想指定发行版：
# wsl --install -d Ubuntu
```

装好后第一次打开 Ubuntu 会让你设用户名/密码。

## 2. 在 WSL2 Ubuntu 里构建

把 Chaterm 项目（含本 `wsl-setup.sh`）放进 WSL 的家目录或任意位置，然后：

```bash
cd Chaterm
bash wsl-setup.sh
```

脚本会：装 Linux gcc/python（仅 WSL 内）→ 装 Node22 → `npm install`（编原生模块）
→ `npm run build` + `electron-builder --linux`（出 AppImage/deb）。全程不碰 Windows MSVC。

## 3. 运行 Chaterm（需要图形界面）

- **Windows 11 + WSLg**：直接双击 AppImage 或 `./Chaterm-*.AppImage`，窗口会显示在你的 Windows 桌面上。
- **Windows 10 / 无 WSLg**：装一个 X Server（如 VcXsrv），设 `export DISPLAY=:0`，再运行 AppImage；
  或用 VNC（`x11vnc` / `tigervnc`）连入 WSL 桌面。

## 4. 串口怎么填

| Windows 设备管理器 | WSL2 中的路径 |
|---|---|
| COM1 | `/dev/ttyS0` |
| COM2 | `/dev/ttyS1` |
| COM3 | `/dev/ttyS2` |
| COM4 | `/dev/ttyS3` |

在 Chaterm「新建主机」选 **Serial / 串口设备**，路径填 `/dev/ttyS2`（对应 COM3），
再设波特率等参数即可。

> 提示：若 WSL2 看不到 COM 口，先确认 Windows 设备管理器里有该 COM，且未被其他程序占用。
> 也可把 USB-TTL 直接插在机器上，由 Windows 分配 COM，WSL2 自动映射。

## 5. 为什么不用"外部 Linux 服务器 + Docker"

那套（见 `docker/`）产出的是 **Linux 格式的原生模块**，只能在 Linux 上跑，
不能在 Windows 加载。除非你打算把串口设备和 Chaterm 都放在那台 Linux 服务器上，
否则对"Windows COM 口"场景无效。WSL2 是在同一台 Windows 机器上同时获得
"Linux 构建工具链"和"Windows COM 口可见性"的最佳折中。
