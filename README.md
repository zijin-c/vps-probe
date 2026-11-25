# 只读版哪吒探针（nezha-ro）

基于 [nezhahq/nezha](https://github.com/nezhahq/nezha)（面板）与 [nezhahq/agent](https://github.com/nezhahq/agent) 二次修改：
**保留**监控、三网延迟、流量周期、账单展示、官方前端主题；**去掉**一切远程控制能力；
**新增** Telegram 交互机器人与一键备份/恢复。

```
vps-probe/
├── dashboard/        面板源码（上游 fork，git remote 仍指向上游，便于合并更新）
├── agent/            Agent 源码（上游 fork）
├── deploy/install.sh Agent 一键安装脚本（从你自己的面板下载 Agent）
├── Dockerfile        一次构建面板 + 4 种架构的 Agent
├── docker-compose.yml
└── build.sh          不用 Docker 时的本地构建
```

## 改了什么

### 1. 去掉远程控制（两侧都做，任一侧都足以阻止执行）

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

Agent 只会执行 4 种任务：HTTP GET、ICMP Ping、TCP Ping（三网延迟/服务监控）、心跳。
相关 handler 不再被引用，已用 `go tool nm` 确认**它们不在编译出的二进制里**（shell/pty/文件管理包也没有被链接）。

> ⚠️ 自动更新必须去掉：上游会从 GitHub 拉取官方 Agent 覆盖二进制，那样会悄悄恢复全部远程能力。
> 所以 **不要** 使用面板后台里生成的"安装命令"（那是官方脚本），请用下面本项目的安装命令。

### 2. 其它改动
- SQLite 驱动换成纯 Go（`glebarez/sqlite`），无需 CGO，数据库文件与上游完全兼容，可直接沿用旧的 `sqlite.db`。
- 面板提供 `/probe/agent/<文件>`，用来下发本分支编译的 Agent 与安装脚本。

### 3. 新增：Telegram 机器人（`data/probe.yaml`）
- 命令：`/list` 概览、`/status 名称` 详情、`/traffic` 周期流量、`/expire` 续费一览、`/backup` 立即备份并发文件、`/id`
- 通知：离线/恢复、周期流量达到 80/90/100%、到期前 7/3/1 天、已到期
- 只响应 `chat_ids` 里的会话；支持 `api_base` 换成自建反代（国内机器）

### 4. 新增：备份与恢复
- 网页：登录后台后打开 `https://面板/probe/backup`，下载或上传恢复
- 命令行：`./app -backup x.tar.gz`、`./app -restore x.tar.gz`（恢复前先停面板）
- 每天自动备份到 `data/backups/`，保留 7 份，可选同时发到 TG
- 备份包含：服务器与 Agent 密钥、分组、账单备注、告警/通知/服务监控、流量记录、用户、`config.yaml`、`probe.yaml`；可选包含 TSDB 历史
- **重新部署后导入，Agent 不用重装就会自动连回来**（密钥与 UUID 都在备份里）
- 恢复前的旧数据会自动另存到 `data/backups/pre-restore-时间/`

## 部署

### 面板（Docker）

```bash
git clone/上传 本目录到服务器 && cd vps-probe
docker compose up -d --build
```

浏览器打开 `http://IP:8008/dashboard`，默认账号 `admin / admin`，**立刻改密码**。
建议用 Nginx/Caddy 反代上 HTTPS（gRPC 与网页共用一个端口，反代需开启 HTTP/2 / gRPC 转发，配置同官方文档）。

### Agent（每台 VPS）

`agent_secret_key` 在面板 `data/config.yaml` 里。

```bash
# 面板有 HTTPS（推荐）
curl -fsSL https://probe.example.com/probe/agent/install.sh | sudo sh -s -- \
  --panel https://probe.example.com --server probe.example.com:443 --tls --secret 你的agent_secret_key

# 面板没有 HTTPS
curl -fsSL http://1.2.3.4:8008/probe/agent/install.sh | sudo sh -s -- \
  --panel http://1.2.3.4:8008 --server 1.2.3.4:8008 --secret 你的agent_secret_key
```

Agent 装在 `/opt/nezha-ro/`，systemd 服务名 `nezha-ro-agent`，常驻内存约 10~15 MB。
卸载：在命令末尾改成 `--uninstall`。

### Telegram

1. 找 @BotFather 建机器人拿 token
2. 编辑 `data/probe.yaml` 填 `bot_token`，重启面板
3. 给机器人发 `/id`，把返回的 chat id 填到 `chat_ids`，再重启

### 账单 / 剩余天数 / 剩余价值

在后台编辑服务器的 **公开备注**，填入官方前端同款 JSON，首页卡片和机器人都会读取：

```json
{"billingDataMod":{"startDate":"2025-11-29T00:00:00+08:00","endDate":"2026-11-29T00:00:00+08:00","autoRenewal":"1","cycle":"年","amount":"$10"},
 "planDataMod":{"bandwidth":"1Gbps","trafficVol":"256GB","trafficType":"2","IPv4":"1","IPv6":"1","networkRoute":"CN2 GIA,9929,CMIN2","extra":""}}
```

- `cycle`：月 / 季 / 半年 / 年（或 Month/Quarter/Half/Year，可写 `2年`）
- `autoRenewal: "1"`：过期后按周期自动顺延
- `endDate` 以 `0000` 开头表示永久

### 流量配额（卡片上的 "3.7 GB / 256 GB"）

后台「告警规则」新建一条规则，类型选 **周期流量**（如 `transfer_all_cycle`，每月 1 号重置，上限 256GB），
勾选要统计的服务器。首页进度条、`/traffic` 与 TG 阈值提醒都基于它。

### 三网延迟

后台「服务」新建 ICMP Ping 或 TCPing 监控（例如三家运营商各取一个测速节点），覆盖全部服务器即可，
卡片和详情页会显示延迟与丢包。

## 更新上游

```bash
cd dashboard && git fetch origin && git merge origin/master   # agent 同理
```

改动集中在少数文件，冲突一般很小：
- Agent：`cmd/agent/task_dispatch.go`、`cmd/agent/main.go`（`run()` 开头）
- 面板：`cmd/dashboard/controller/controller.go`（路由）、`cmd/dashboard/main.go`、`service/singleton/sqlite_dialector_default.go`，
  新增 `controller/readonly.go`、`controller/probe*.go`、`cmd/dashboard/probe_cli.go`、`service/probe/`

## 已知限制
- 管理后台（官方前端）里终端、文件管理、计划任务、NAT 的按钮还在，点了会提示"只读分支已禁用"。
- 线路识别、IP 质量、流媒体解锁、单线程测速等信息不会自动检测，可以手动写进公开备注的 `networkRoute` / `extra`。
- 面板上的 4 个上游告警规则单测在 Windows 下本就失败（上游代码同样如此），与本分支改动无关。
