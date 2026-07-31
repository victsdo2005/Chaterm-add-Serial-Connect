<div align="center">
  <a href="./README_zh.md">中文</a> / English
</div>
<br>

<p align="center">
  <a href="https://www.tbench.ai/leaderboard/terminal-bench/1.0"><img src="https://img.shields.io/badge/Terminal--Bench-Ranked_%232-00D94E?style=for-the-badge&logo=github&logoColor=white" alt="Terminal-Bench"></a>
  <a href="https://aws.amazon.com/cn/blogs/china/chaterm-aws-kms-envelope-encryption-for-zero-trust-security-en/"><img src="https://img.shields.io/badge/AWS-Security-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white&labelColor=232F3E" alt="AWS Security"></a>
  <a href="https://landscape.cncf.io/?item=provisioning--automation-configuration--chaterm"><img src="https://img.shields.io/badge/CNCF-Landscape-0086FF?style=for-the-badge&logo=kubernetes&logoColor=white" alt="CNCF Landscape"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/chaterm/Chaterm"><img src="https://api.scorecard.dev/projects/github.com/chaterm/Chaterm/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://www.bestpractices.dev/projects/12617"><img src="https://www.bestpractices.dev/projects/12617/badge" alt="OpenSSF Best Practices"></a>
  <img src="https://img.shields.io/codecov/c/github/chaterm/Chaterm?style=flat&logo=codecov" alt="Coverage">
  <img src="https://img.shields.io/badge/AI-Native-blue?style=flat" alt="AI Native">
  <a href="https://x.com/chaterm_ai"><img src="https://img.shields.io/twitter/follow/chaterm_ai?style=flat&logo=x&logoColor=white&label=Follow" alt="Follow on X"></a>
  <a href="https://deepwiki.com/chaterm/Chaterm"><img src="https://deepwiki.com/badge.svg" alt="DeepWiki"></a>
</p>

<p align="center">
  <a href="https://chaterm.ai/download/"><img src="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
</p>

# Chaterm

Chaterm is an AI-native terminal built for infrastructure and cloud resource management. Describe tasks in natural language, and the built-in Agent plans and executes them across servers, Kubernetes, and now **serial (UART) devices**.

![Preview image](resources/hero.webp)

## Key Features

- 🤖 **AI Agent** — understands the target, plans, diagnoses root causes across hosts, and closes the loop autonomously; every step is auditable and rollback-ready.
- 🧠 **Smart completion** — habit + local-memory + context aware command suggestions; safe local echo on high-latency SSH.
- 🧩 **Knowledge Base** — import manuals / docs / scripts to build a personal maintenance knowledge system.
- ⚡ **Agent Skill** — encapsulate complex workflows into reusable, reliable AI skills.
- 🔌 **Plugin System** — unified auth, dynamic authorization, and encrypted connections for public cloud & Kubernetes.
- 🗄️ **Database Workspace** — browse MySQL / PostgreSQL / SQLite / Oracle, query, inspect DDL, edit rows.
- 🔌 **Serial (UART) Connection** 🆕 — drive switches, routers, and embedded devices' Console port by natural language. *See below.*

# 🆕 New: Serial (UART) Connection

On top of the existing SSH / Telnet support, this branch adds a **Serial (UART) connection type** and lets Chaterm's built-in AI Agent **manage serial sessions** just like SSH — driving switches, routers, and embedded devices with natural language by sending commands and reading the output.

Typical use cases: device Console ports (e.g. Cisco / Huawei switches), routers, industrial controllers, IoT gateways, and dev boards (Raspberry Pi / ESP32, etc.).

## Highlights

- **New connection type**: asset type `person-serial`, on par with `person-ssh` / `person-telnet`, managed and grouped uniformly in the asset library.
- **COM port auto-detection**: when creating a serial asset, the port field enumerates the machine's available COM ports via `getSerialPorts`, with a free-text fallback (e.g. `/dev/ttyUSB0`).
- **Full serial parameters**: baud rate, data bits, stop bits, parity, and flow control are all configurable, covering the vast majority of device CLIs.
- **AI-driven serial ops**: just tell the AI what to do, for example:
  - "Check the switch status"
  - "Show interface brief"
  - "Display current configuration"
  - The AI uses the built-in `execute_command` tool to write commands to the serial port, read the output, and summarize the result.
- **Smart handling of long device output**: serial output often triggers `---- More ----` pagination when too long. The capture layer does **line buffering + idle-driven completion + cross-chunk auto-paging** (sends a space to continue), so the AI receives the complete output across pages instead of getting stuck at `More`.
- **Batched output buffering**: serial output is coalesced (accumulated and flushed on a short timer), avoiding renderer jank from per-chunk IPC flooding at high baud rates.

## Serial Connection Parameters

The following parameters are available when creating a serial connection (defaults suit most devices):

| Parameter | Values | Default | Notes |
| --- | --- | --- | --- |
| `baudRate` | any integer (common: 9600 / 19200 / 115200) | `9600` | Negotiated speed |
| `dataBits` | `5` / `6` / `7` / `8` | `8` | Data bits per frame |
| `stopBits` | `1` / `1.5` / `2` | `1` | Stop bits per frame |
| `parity` | `none` / `even` / `odd` / `mark` / `space` | `none` | Parity check |
| `flowControl` | `none` / `hardware`(RTS/CTS) / `software`(XON/XOFF) / `both` | `none` | Handshake |

> Tip: Network device Console ports (Cisco / Huawei, etc.) commonly use **9600 8N1 (no flow control)** — i.e. `baudRate=9600, dataBits=8, stopBits=1, parity=none, flowControl=none`.

## How the AI Manages a Serial Session

1. Create a `person-serial` asset in the library with the correct COM port and parameters;
2. Open that serial session (or let the AI open it from the conversation);
3. Describe your goal in natural language in the AI chat box, e.g. "Check the switch status";
4. The AI calls the command-execution tool, writes commands to the serial port (auto-normalized to `\r\n` line endings), reads the device echo (including the fully auto-paged content), and returns a diagnosis or next-step suggestion.

Relevant implementation:
- `src/main/ssh/serialHandle.ts` — serial lifecycle, parameter parsing, output buffering and pagination handling
- `src/preload/index.ts` — exposes the `getSerialPorts` serial IPC bridge
- `src/renderer/.../AssetForm.vue` — serial asset form and port dropdown

## Development Guide

### Install

```bash
node scripts/patch-package-lock.js
npm install
```

If Electron reports a native module ABI mismatch, rebuild native dependencies for Electron instead of the local Node.js runtime:

```bash
npm run rebuild:native
```

### Development

```bash
npm run dev
```

> Note: Do **not** run with the `ELECTRON_RUN_AS_NODE` environment variable set, or Electron will be executed as a Node process and fail. If that variable leaks in your environment, run `env -u ELECTRON_RUN_AS_NODE npm run dev`.

### Build

```bash
# For Windows (CN edition; output: dist/cn/chaterm-<ver>-cn-setup-x64.exe)
npm run build:win:cn
```

## Acknowledgements

Chaterm builds upon excellent open-source projects. We gratefully acknowledge:

- **[Cline](https://github.com/cline/cline)** — portions of the AI Agent system are adapted from Cline.
- **[RTK](https://github.com/rtk-ai/rtk)** — command output filtering to reduce token usage in agent workflows.
- **[serialport (node-serialport)](https://github.com/serialport/node-serialport)** — the serial connection capability in this branch is built on this project.
