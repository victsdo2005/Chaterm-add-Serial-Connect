<div align="center">
  中文 / <a href="./README.md">English</a>
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

Chaterm 是一款 AI 原生的终端，专为基础设施与云资源管理而打造。用自然语言描述任务，内置 Agent 即可在服务器、Kubernetes，以及现在的**串口（UART）设备**上自主规划并执行。

![Preview image](resources/hero.webp)

## 核心特性

- 🤖 **AI 智能代理** — 理解目标、自主规划、跨主机定位根因并自动闭环；每一步可审计、可回滚。
- 🧠 **智能命令推荐** — 结合习惯、本地记忆与上下文推荐命令；高延迟 SSH 下安全本地回显。
- 🧩 **用户知识库** — 导入手册 / 文档 / 脚本，构建个人运维知识体系。
- ⚡ **Agent Skill** — 把复杂运维流程封装为可复用、可靠的 AI 技能。
- 🔌 **插件系统** — 对公有云与 Kubernetes 实现统一认证、动态授权与安全加密连接。
- 🗄️ **数据库工作区** — 连接 MySQL / PostgreSQL / SQLite / Oracle，查询、查看 DDL、编辑行。
- 🔌 **串口（Serial / UART）连接** 🆕 — 用自然语言驱动交换机 / 路由器 / 嵌入式设备的 Console 口。见下文。

# 🆕 新增功能：串口（Serial）连接

在原有 SSH / Telnet 之外，本分支新增了**串口（Serial / UART）连接类型**，并让 Chaterm 内嵌的 AI Agent 能够像管理 SSH 会话一样去**管理串口会话**——用自然语言向交换机、路由器、嵌入式设备发送命令并读取回显。

典型场景：设备 Console 口（如 Cisco / 华为交换机）、路由器、工控设备、IoT 网关、开发板（树莓派 / ESP32 等）的串口调试。

## 功能亮点

- **新增连接类型**：资产类型 `person-serial`，与 `person-ssh` / `person-telnet` 同级，可在资产库中统一管理与分组。
- **COM 端口自动检测**：新建串口资产时，串口头会调用本机串口枚举接口（`getSerialPorts`）自动填充可用 COM 端口下拉列表，同时允许手动填写兜底（如 `/dev/ttyUSB0`）。
- **完整串口参数**：支持波特率、数据位、停止位、校验位、流控的全量配置，覆盖绝大多数设备 CLI 需求。
- **AI 驱动串口运维**：直接用自然语言即可让 AI 操作串口设备，例如：
  - “检查交换机状态”
  - “查看接口 brief”
  - “显示当前配置”
  - AI 通过内置 `execute_command` 工具向串口发送命令、读取输出并归纳结论。
- **设备 CLI 长输出智能处理**：串口输出常因过长触发 `---- More ----` 分页。采集层做了**行缓冲 + 空闲驱动完成 + 跨块分页自动翻页**（自动发送空格继续），AI 能完整拿到分页后的全部内容，不再卡在 `More`。
- **输出批量缓冲**：串口输出采用合并缓冲（累积后按短定时器刷新），高波特率下避免逐块 IPC 刷屏导致的渲染卡顿。

## 串口连接参数

新建串口连接时支持以下参数（默认值已适配多数设备）：

| 参数 | 可选值 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `baudRate` 波特率 | 任意整数（常用 9600 / 19200 / 115200） | `9600` | 设备与主机协商的速率 |
| `dataBits` 数据位 | `5` / `6` / `7` / `8` | `8` | 每帧数据位 |
| `stopBits` 停止位 | `1` / `1.5` / `2` | `1` | 每帧停止位 |
| `parity` 校验位 | `none` / `even` / `odd` / `mark` / `space` | `none` | 奇偶校验 |
| `flowControl` 流控 | `none` / `hardware`(RTS/CTS) / `software`(XON/XOFF) / `both` | `none` | 握手方式 |

> 提示：Cisco / 华为等网络设备 Console 口常见配置为 **9600 8N1（无流控）**，即 `baudRate=9600, dataBits=8, stopBits=1, parity=none, flowControl=none`。

## AI 如何管理串口会话

1. 在资产库新建一个 `person-serial` 资产，填写正确的 COM 端口与参数；
2. 打开该串口会话（或让 AI 在对话中发起连接）；
3. 在 AI 对话框中用自然语言描述目标，例如“检查交换机状态”；
4. AI 会调用命令执行工具，向串口写入命令（自动按 `\r\n` 换行），读取设备回显（含自动翻页后的完整内容），并给出诊断结论或下一步建议。

相关实现位于：
- `src/main/ssh/serialHandle.ts` — 串口生命周期、参数解析、输出缓冲与分页处理
- `src/preload/index.ts` — 暴露 `getSerialPorts` 等串口 IPC 桥接
- `src/renderer/.../AssetForm.vue` — 串口资产生成表单与端口下拉

## 开发指南

### Install

```bash
node scripts/patch-package-lock.js
npm install
```

如在大陆网络环境下安装 Electron 缓慢，可先配置镜像源再安装：

```bash
npm config set registry https://registry.npmmirror.com
npm config edit   # 添加 electron_mirror=https://cdn.npmmirror.com/binaries/electron/ 与 electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
npm i electron -D
```

若 Electron 提示原生模块 ABI 不匹配，请按 Electron 运行时重建原生依赖：

```bash
npm run rebuild:native
```

### Development

```bash
npm run dev
```

> 注意：构建/启动请**不要携带** `ELECTRON_RUN_AS_NODE` 环境变量，否则 Electron 会被当成 Node 进程运行而报错。如环境已泄漏该变量，可用 `env -u ELECTRON_RUN_AS_NODE npm run dev` 运行。

### Build

```bash
# For Windows（CN 版安装包，产物为 dist/cn/chaterm-<ver>-cn-setup-x64.exe）
npm run build:win:cn
```

## 致谢

Chaterm 受益于优秀的开源项目，在此特别感谢：

- **[Cline](https://github.com/cline/cline)** — AI Agent 系统的部分实现参考并改编自 Cline。
- **[RTK](https://github.com/rtk-ai/rtk)** — 用于命令输出过滤，在 Agent 工作流中减少 token 消耗。
- **[serialport (node-serialport)](https://github.com/serialport/node-serialport)** — 本分支的串口连接能力基于该项目实现。
