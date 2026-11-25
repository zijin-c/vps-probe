# 只读版哪吒探针（nezha-ro）

基于 [nezhahq/nezha](https://github.com/nezhahq/nezha)（面板）与 [nezhahq/agent](https://github.com/nezhahq/agent) 二次修改：
**保留**监控、三网延迟、流量周期、账单展示；**去掉**一切远程控制能力；
**新增**自研前台与后台界面（`web/`）、Telegram 交互机器人与一键备份/恢复。

```
vps-probe/
├── web/              自研前端（React + Vite），同时作为前台与 /dashboard 后台
├── dashboard/        面板源码（git subtree 引入 nezhahq/nezha）
├── agent/            Agent 源码（git subtree 引入 nezhahq/agent）
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

### 5. 新增：IP 质量 / 流媒体解锁 / 三网回程（Agent 内置，`pkg/quality`）
新装的 Agent 会自动做第一次检测，之后每 24 小时（`probe.yaml` 的 `quality.interval_hours`）重测一次。
也可以手动触发：登录后在服务器详情页每个分区右上角点「开始检测 / 重新检测」，或用「一键检测全部」；
Agent 每分钟询问一次，1 分钟内开始，页面会显示"排队中 / 检测中"并在完成后自动刷新。
三项（三网回程 / 流媒体解锁 / IP 质量）可以单独重测。

检测结果会**自动**显示在首页卡片上：每家运营商取各城市中最常见的回程线路（如"电信 CN2 GIA · 联通 9929 · 移动 CMIN2"，精品线路金色），
外加原生 IP 与已解锁的流媒体。没有检测结果时才使用公开备注里手填的线路。
检测都是**固定的出站查询**，面板只能说"再跑某一项"，不能指定目标或命令。

| 项目 | 做法 |
| --- | --- |
| IP 质量 | 本机出口 IPv4 / IPv6 分别查询 ipapi.is、ip-api.com、ipinfo（免密钥）；可选 AbuseIPDB、IP2Location 密钥（填在 `data/probe.yaml` 的 `quality`） |
| 原生 / 广播 IP | RDAP（RIR 注册国家）与地理位置国家一致为原生，否则为广播 |
| 流媒体 / AI | Netflix、YouTube Premium、Disney+、Prime Video、TikTok、ChatGPT、Reddit；随机子域泛解析 / 内网解析视为 DNS 解锁 |
| 三网回程 | 纯 Go 原始 ICMP traceroute 到北京/上海/广州三网，按途经骨干网前缀判断 CN2 GIA / GT / 163 / 9929 / 4837 / CUG / CMIN2 / CMI / CTGNet，每个目标测 3 次合并 |

参考：判定思路来自 [xykt/IPQuality](https://github.com/xykt/IPQuality)、[oneclickvirt/backtrace](https://github.com/oneclickvirt/backtrace)（Apache-2.0）、
[zhanghanyun/backtrace](https://github.com/zhanghanyun/backtrace)（MIT），代码为独立实现，未使用 IPQuality 作者的代理 API。

- 回程检测需要 root（原始 ICMP 套接字）；安装脚本装的 systemd 服务默认就是 root。
- 只测**回程**：去程（国内 → VPS）必须从国内节点发起探测，VPS 上无法测，开源脚本也没有可靠方案。
- 不做测速：会消耗大量流量配额。
- 不想检测可在 Agent 配置里加 `disable_quality_check: true`。

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

在后台「服务器 → 编辑」里直接填表即可（价格、周期、到期日、自动续费、带宽、流量、线路标签）。
底层存的是服务器 **公开备注** 里的 JSON（与官方前端格式兼容），也可以勾选"直接编辑 JSON"手写：

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

整个项目是一个仓库，两个上游以 `git subtree`（squash）方式引入，在仓库根目录执行：

```bash
git subtree pull --prefix=dashboard https://github.com/nezhahq/nezha.git master --squash
git subtree pull --prefix=agent     https://github.com/nezhahq/agent.git main   --squash
```

合并后务必检查 Agent 的 `task_dispatch.go` 白名单仍然生效（新增的任务类型默认会被拒绝，这是安全的），
以及 `main.go` 里没有重新出现自动更新。改动集中在少数文件，冲突一般很小：
- Agent：`cmd/agent/task_dispatch.go`、`cmd/agent/main.go`（`run()` 开头）
- 面板：`cmd/dashboard/controller/controller.go`（路由）、`cmd/dashboard/main.go`、`service/singleton/sqlite_dialector_default.go`，
  新增 `controller/readonly.go`、`controller/probe*.go`、`cmd/dashboard/probe_cli.go`、`service/probe/`

## 已知限制
- 自研后台只做了只读探针需要的页面；DDNS、多用户、API Token、WAF 等上游功能没有界面（接口仍在）。
- 去程线路、单线程测速不检测（原因见上）；三网回程目前只测 IPv4。
- 流媒体解锁依赖各站点当前的页面结构，站点改版后个别项目可能显示"检测失败"，需要跟进调整。
- 面板上的 4 个上游告警规则单测在 Windows 下本就失败（上游代码同样如此），与本分支改动无关。
