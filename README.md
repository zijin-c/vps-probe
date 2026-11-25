# 只读版哪吒探针（vps-probe / nezha-ro）

基于 [nezhahq/nezha](https://github.com/nezhahq/nezha)（面板）与 [nezhahq/agent](https://github.com/nezhahq/agent) 深度裁剪与二次开发：

- **纯只读安全**：在面板端与 Agent 端双侧彻底移除 Web 终端、远程命令、计划任务、文件管理、NAT 穿透、自动更新与 MCP 等远程控制能力，防止面板沦陷导致所有 VPS 被控。
- **自研 Liquid Glass 前后台**（`web/`）：一套 React + TypeScript 轻量前端同时提供前台展示与 `/dashboard` 管理后台，支持明暗主题与移动端适配。
- **开箱即用的运维增强**：内置三网回程 / IP 质量 / 流媒体解锁检测、账单与剩余价值计算、Telegram 交互机器人、可视化扩展配置与一键备份/恢复。

```text
vps-probe/
├── web/              自研前端（React + Vite），同时作为前台与 /dashboard 后台
├── dashboard/        面板源码（git subtree 引入 nezhahq/nezha）
├── agent/            Agent 源码（git subtree 引入 nezhahq/agent）
├── deploy/panel.sh   面板一键部署 / 更新脚本（Docker Compose）
├── deploy/install.sh Agent 一键安装脚本（从你自己的面板下载只读 Agent）
├── Dockerfile        一次构建面板 + 4 种架构的 Agent
├── docker-compose.yml
└── build.sh          不用 Docker 时的本地构建
```

## 快速部署

### 1. 面板一键部署（推荐）

自动检查/安装 Docker 与 Git，拉取代码并构建启动容器（默认目录 `/opt/vps-probe`，端口 `8008`）：

```bash
curl -fsSL https://raw.githubusercontent.com/zijin-c/vps-probe/main/deploy/panel.sh | sudo sh
```

常用参数：

```bash
# 自定义端口与安装目录
curl -fsSL https://raw.githubusercontent.com/zijin-c/vps-probe/main/deploy/panel.sh | sudo sh -s -- --port 8008 --dir /opt/vps-probe

# 卸载容器（保留 data 数据目录）
curl -fsSL https://raw.githubusercontent.com/zijin-c/vps-probe/main/deploy/panel.sh | sudo sh -s -- --uninstall
```

或者手动 Docker Compose 部署：

```bash
git clone https://github.com/zijin-c/vps-probe.git && cd vps-probe
docker compose up -d --build
```

部署完成后打开 `http://你的IP:8008/dashboard`，默认账号 **`admin / admin`**，请登录后立刻在「账户」里修改用户名与密码。
建议前面套 Nginx / Caddy 反代开启 HTTPS（gRPC 与网页共用端口，反代需开启 HTTP/2 / gRPC 转发）。

### 2. 安装只读 Agent（每台 VPS）

登录后台 →「服务器」→「添加服务器」，可直接复制带密钥的一键安装命令（也支持自定义 `--uuid`）：

```bash
# 面板有 HTTPS（推荐）
curl -fsSL https://probe.example.com/probe/agent/install.sh | sudo sh -s -- \
  --panel https://probe.example.com --server probe.example.com:443 --tls --secret 你的agent_secret_key

# 面板没有 HTTPS
curl -fsSL http://1.2.3.4:8008/probe/agent/install.sh | sudo sh -s -- \
  --panel http://1.2.3.4:8008 --server 1.2.3.4:8008 --secret 你的agent_secret_key
```

Agent 安装在 `/opt/nezha-ro/`，systemd 服务名 `nezha-ro-agent`，常驻内存约 10~15 MB。卸载只需将命令参数改为 `--uninstall`。

> ⚠️ 不要使用官方哪吒的安装脚本：官方脚本会拉取包含远程执行能力与自动更新的官方 Agent。

---

## 核心特性与改动

### 1. 双侧移除远程控制

| 能力 | Agent 侧 | 面板侧 |
| --- | --- | --- |
| 远程命令 / 计划任务 | 任务分发白名单拒绝 | `/api/v1/cron` 新建/修改/手动触发 → 403 |
| Web 终端 | 同上 | `/api/v1/terminal`、`/ws/terminal` → 403 |
| 文件管理 | 同上 | `/api/v1/file`、`/ws/file` → 403 |
| NAT 内网穿透 | 同上 | `/api/v1/nat` 新建/修改 → 403 |
| 远程读/改 Agent 配置 | 同上 | `/api/v1/server/config` → 403 |
| 远程升级 / 自动更新 | 删除启动时自动更新；升级任务被拒绝 | `/api/v1/force-update/server` → 403 |
| MCP（AI 远程 exec / 读写文件） | 同上 | `/mcp`、`/mcp/upload`、`/mcp/download` → 403 |
| 服务器迁移时的密钥轮换下发 | 同上 | — |

Agent 只会执行 4 种任务：HTTP GET、ICMP Ping、TCP Ping（三网延迟/服务监控）、心跳。相关 handler 已从编译二进制中彻底移除。

### 2. 自研前后台（Liquid Glass 风格）
- **前台**：实时状态概览、分组与状态筛选、关键词搜索（按 `/` 快捷聚焦）、多维度排序、卡片/列表双视图、三网延迟 Sparkline、账单剩余天数与剩余价值、服务器详情页（历史曲线 + IP 质量 / 解锁 / 三网回程追踪）。
- **管理后台（`/dashboard`）**：
  - **概览**：在线率、30 天临期提醒、周期流量预警排行、安全与配置检查清单、快捷下载备份。
  - **服务器**：实时在线状态、搜索/状态/分组筛选、列排序、批量操作（批量重测、批量分组、批量显隐、批量删除）、表单化编辑账单与套餐。
  - **分组 / 延迟监控 / 告警规则 / 通知方式**：告警规则支持列表一键开关与多条件编辑；支持快速创建周期流量配额。
  - **探针配置**：直接在后台可视化编辑 `data/probe.yaml`（Telegram 机器人配置与一键测试推送、IP 质量检测间隔与 API 密钥）。
  - **备份与恢复**：手动点击打包并通过浏览器直接下载 `.tar.gz`；支持拖拽上传恢复（自动备份旧数据到 `data/backups/pre-restore-时间/` 并重启生效）。

### 3. Telegram 机器人（后台「探针配置」或 `data/probe.yaml`）
- 交互命令：`/list` 概览、`/status 名称` 详情、`/traffic` 周期流量、`/expire` 续费一览、`/backup` 立即打包并发送备份文件、`/id` 查看会话 ID。
- 主动提醒：离线/恢复、周期流量达到 80/90/100%、到期前 7/3/1 天与已到期。
- 仅响应 `chat_ids` 白名单会话；支持 `api_base` 配置自建反代。

### 4. IP 质量 / 流媒体解锁 / 三网回程（Agent 内置 `pkg/quality`）
- 新装 Agent 自动执行首次检测，之后按配置间隔（默认 24 小时）重测，也可在后台或详情页手动触发重测。
- 首页卡片自动展示三网回程线路（精品线路金色高亮）与原生/广播 IP；流媒体解锁与详细跳点可在服务器详情页查看。
- 所有检测均为固定出站查询，面板无法指定任意目标或命令；可在 Agent 配置中加 `disable_quality_check: true` 关闭。

| 项目 | 做法 |
| --- | --- |
| IP 质量 | 本机出口 IPv4 / IPv6 查询 ipapi.is、ip-api.com、ipinfo（免密钥）；可选配置 ipinfo / AbuseIPDB / IP2Location 密钥 |
| 原生 / 广播 IP | RDAP 注册国家与地理位置国家一致为原生，否则为广播 |
| 流媒体 / AI | Netflix、YouTube Premium、Disney+、Prime Video、TikTok、ChatGPT、Reddit |
| 三网回程 | 纯 Go 原始 ICMP traceroute 到北京/上海/广州三网，按途经骨干网识别 CN2 GIA / GT / 163 / 9929 / 4837 / CUG / CMIN2 / CMI / CTGNet |

### 5. 其它改动
- SQLite 驱动替换为纯 Go（`glebarez/sqlite`），无需 CGO，与上游 `sqlite.db` 完全兼容。
- 面板通过 `/probe/agent/<文件>` 分发本分支编译的只读 Agent 与安装脚本。
- 命令行备份/恢复：`./app -backup x.tar.gz`、`./app -restore x.tar.gz`（恢复前先停面板）。

---

## 使用说明

### 账单 / 剩余天数 / 剩余价值
在后台「服务器 → 编辑」里直接填表（价格、周期、到期日、自动续费、带宽、流量、线路标签），底层存为与官方前端兼容的公开备注 JSON，也可勾选「直接编辑 JSON」手写。

### 流量配额
在后台「告警规则」点「流量配额」新建周期流量规则（如 `transfer_all_cycle`，每月 1 号重置，上限 256GB），首页进度条、后台概览、`/traffic` 与 TG 阈值提醒均基于它。

### 三网延迟
在后台「延迟监控」新建 ICMP Ping 或 TCPing 监控（建议电信/联通/移动各选一个测速节点），覆盖全部服务器即可。

## 更新上游

项目通过 `git subtree`（squash）引入上游：

```bash
git subtree pull --prefix=dashboard https://github.com/nezhahq/nezha.git master --squash
git subtree pull --prefix=agent     https://github.com/nezhahq/agent.git main   --squash
```

合并后务必确认 Agent 的 `task_dispatch.go` 白名单仍生效且 `main.go` 没有恢复自动更新。

## 已知限制
- 自研后台聚焦只读探针核心场景，未提供 DDNS、多用户、API Token、WAF 等上游界面（底层接口仍在）。
- 不测去程与单线程测速（避免消耗大量流量配额）；三网回程目前仅测 IPv4。
- 面板上 4 个上游告警规则单测在 Windows 下本就失败，与本分支无关。
