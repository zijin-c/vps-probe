package probe

import (
	"bytes"
	"context"
	"fmt"
	"html"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/goccy/go-json"

	"github.com/nezhahq/nezha/service/singleton"
)

type tgUpdate struct {
	UpdateID int64 `json:"update_id"`
	Message  *struct {
		Text string `json:"text"`
		Chat struct {
			ID int64 `json:"id"`
		} `json:"chat"`
	} `json:"message"`
}

type bot struct {
	conf   TelegramConf
	client *http.Client
}

func (b *bot) endpoint(method string) string {
	return fmt.Sprintf("%s/bot%s/%s", b.conf.APIBase, b.conf.BotToken, method)
}

func (b *bot) allowed(chatID int64) bool { return slices.Contains(b.conf.ChatIDs, chatID) }

func (b *bot) call(ctx context.Context, method string, params url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.endpoint(method), strings.NewReader(params.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return b.do(req, out)
}

func (b *bot) do(req *http.Request, out any) error {
	resp, err := b.client.Do(req)
	if err != nil {
		// 错误信息里会带上含 token 的 URL，脱敏后再返回
		return fmt.Errorf("telegram 请求失败: %s", strings.ReplaceAll(err.Error(), b.conf.BotToken, "***"))
	}
	defer resp.Body.Close()
	var r struct {
		OK          bool            `json:"ok"`
		Description string          `json:"description"`
		Result      json.RawMessage `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&r); err != nil {
		return err
	}
	if !r.OK {
		return fmt.Errorf("telegram: %s", r.Description)
	}
	if out != nil {
		return json.Unmarshal(r.Result, out)
	}
	return nil
}

func (b *bot) send(chatID int64, text string) {
	p := url.Values{}
	p.Set("chat_id", strconv.FormatInt(chatID, 10))
	p.Set("text", text)
	p.Set("parse_mode", "HTML")
	p.Set("disable_web_page_preview", "true")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := b.call(ctx, "sendMessage", p, nil); err != nil {
		log.Printf("PROBE>> 发送 TG 消息失败: %v", err)
	}
}

func (b *bot) broadcast(text string) {
	for _, id := range b.conf.ChatIDs {
		b.send(id, text)
	}
}

func (b *bot) sendFile(chatID int64, path, caption string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("chat_id", strconv.FormatInt(chatID, 10))
	_ = mw.WriteField("caption", caption)
	fw, err := mw.CreateFormFile("document", filepath.Base(path))
	if err != nil {
		return err
	}
	if _, err := io.Copy(fw, f); err != nil {
		return err
	}
	mw.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.endpoint("sendDocument"), &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return b.do(req, nil)
}

var commands = []struct{ cmd, desc string }{
	{"list", "所有服务器状态概览"},
	{"status", "单台详情：/status 名称关键字"},
	{"traffic", "周期流量用量"},
	{"expire", "续费/到期一览"},
	{"backup", "立即备份并发送文件"},
	{"id", "查看当前 chat id"},
	{"help", "帮助"},
}

func (b *bot) registerCommands() {
	type c struct {
		Command     string `json:"command"`
		Description string `json:"description"`
	}
	var list []c
	for _, x := range commands {
		list = append(list, c{x.cmd, x.desc})
	}
	j, _ := json.Marshal(list)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := b.call(ctx, "setMyCommands", url.Values{"commands": {string(j)}}, nil); err != nil {
		log.Printf("PROBE>> 注册 TG 命令失败: %v", err)
	}
}

func (b *bot) poll() {
	var offset int64
	for {
		p := url.Values{}
		p.Set("timeout", "50")
		p.Set("offset", strconv.FormatInt(offset, 10))
		p.Set("allowed_updates", `["message"]`)
		var updates []tgUpdate
		ctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
		err := b.call(ctx, "getUpdates", p, &updates)
		cancel()
		if err != nil {
			log.Printf("PROBE>> TG 轮询失败: %v", err)
			time.Sleep(10 * time.Second)
			continue
		}
		for _, u := range updates {
			offset = u.UpdateID + 1
			if u.Message != nil {
				b.handle(u.Message.Chat.ID, strings.TrimSpace(u.Message.Text))
			}
		}
	}
}

func (b *bot) handle(chatID int64, text string) {
	if !strings.HasPrefix(text, "/") {
		return
	}
	fields := strings.Fields(text)
	cmd := strings.ToLower(strings.TrimPrefix(fields[0], "/"))
	if i := strings.IndexByte(cmd, '@'); i >= 0 {
		cmd = cmd[:i]
	}
	arg := strings.TrimSpace(strings.TrimPrefix(text, fields[0]))

	if cmd == "id" || cmd == "start" {
		msg := fmt.Sprintf("当前 chat id: <code>%d</code>", chatID)
		if !b.allowed(chatID) {
			msg += "\n未授权：把它加入 data/probe.yaml 的 telegram.chat_ids 后重启面板。"
		}
		b.send(chatID, msg)
		return
	}
	if !b.allowed(chatID) {
		return
	}
	now := time.Now()
	switch cmd {
	case "list":
		b.send(chatID, renderList(collectServers(now), now))
	case "status":
		b.send(chatID, renderStatus(collectServers(now), arg, now))
	case "traffic":
		b.send(chatID, renderTraffic(collectServers(now)))
	case "expire":
		b.send(chatID, renderExpire(collectServers(now), now))
	case "backup":
		b.send(chatID, "正在生成备份…")
		path, err := BackupToDir(getConf().Backup.IncludeHistory, getConf().Backup.Keep)
		if err != nil {
			b.send(chatID, "备份失败: "+html.EscapeString(err.Error()))
			return
		}
		if err := b.sendFile(chatID, path, "探针备份（含密钥，请妥善保管）。恢复：面板 /probe/backup 页面上传，或 dashboard -restore 文件"); err != nil {
			b.send(chatID, "发送备份文件失败: "+html.EscapeString(err.Error()))
		}
	default:
		var sb strings.Builder
		sb.WriteString("<b>可用命令</b>\n")
		for _, c := range commands {
			fmt.Fprintf(&sb, "/%s — %s\n", c.cmd, c.desc)
		}
		b.send(chatID, sb.String())
	}
}

// ---- 渲染 ----

func esc(s string) string { return html.EscapeString(s) }

func renderList(vs []ServerView, now time.Time) string {
	if len(vs) == 0 {
		return "还没有服务器"
	}
	var sb strings.Builder
	online := 0
	for _, v := range vs {
		if v.Online {
			online++
		}
	}
	fmt.Fprintf(&sb, "<b>服务器 %d/%d 在线</b>\n\n", online, len(vs))
	for _, v := range vs {
		switch {
		case !v.Seen:
			fmt.Fprintf(&sb, "⚪ <b>%s</b> 从未上线\n", esc(v.Name))
		case !v.Online:
			fmt.Fprintf(&sb, "🔴 <b>%s</b> 离线 %s\n", esc(v.Name), fmtDuration(now.Sub(v.Last)))
		default:
			st, h := v.State, v.Host
			mem := 0.0
			if st != nil && h != nil {
				mem = pct(st.MemUsed, h.MemTotal)
			}
			cpu := 0.0
			var in, out uint64
			if st != nil {
				cpu, in, out = st.CPU, st.NetInSpeed, st.NetOutSpeed
			}
			fmt.Fprintf(&sb, "🟢 <b>%s</b> CPU %.1f%% 内存 %.0f%% ↑%s/s ↓%s/s\n", esc(v.Name), cpu, mem, fmtBytes(out), fmtBytes(in))
		}
	}
	return sb.String()
}

func findServer(vs []ServerView, q string) []ServerView {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return nil
	}
	var exact, part []ServerView
	for _, v := range vs {
		n := strings.ToLower(v.Name)
		if n == q || strconv.FormatUint(v.ID, 10) == q {
			exact = append(exact, v)
		} else if strings.Contains(n, q) {
			part = append(part, v)
		}
	}
	if len(exact) > 0 {
		return exact
	}
	return part
}

func renderStatus(vs []ServerView, q string, now time.Time) string {
	if strings.TrimSpace(q) == "" {
		return "用法：/status 名称关键字（或 ID）"
	}
	m := findServer(vs, q)
	if len(m) == 0 {
		return "没有找到匹配的服务器"
	}
	if len(m) > 1 {
		var names []string
		for _, v := range m {
			names = append(names, esc(v.Name))
		}
		return "匹配到多台，请写得更具体：\n" + strings.Join(names, "\n")
	}
	v := m[0]
	var sb strings.Builder
	state := "🟢 在线"
	if !v.Seen {
		state = "⚪ 从未上线"
	} else if !v.Online {
		state = "🔴 离线 " + fmtDuration(now.Sub(v.Last))
	}
	fmt.Fprintf(&sb, "<b>%s</b>  %s\n", esc(v.Name), state)
	if h := v.Host; h != nil {
		cpuModel := ""
		if len(h.CPU) > 0 {
			cpuModel = h.CPU[0]
		}
		fmt.Fprintf(&sb, "系统：%s %s %s\n", esc(h.Platform), esc(h.PlatformVersion), esc(h.Arch))
		if cpuModel != "" {
			fmt.Fprintf(&sb, "CPU：%s\n", esc(cpuModel))
		}
		if h.Virtualization != "" {
			fmt.Fprintf(&sb, "虚拟化：%s\n", esc(h.Virtualization))
		}
	}
	if st, h := v.State, v.Host; st != nil && h != nil {
		fmt.Fprintf(&sb, "\nCPU %.1f%%  负载 %.2f / %.2f / %.2f\n", st.CPU, st.Load1, st.Load5, st.Load15)
		fmt.Fprintf(&sb, "内存 %s / %s (%.1f%%)\n", fmtBytes(st.MemUsed), fmtBytes(h.MemTotal), pct(st.MemUsed, h.MemTotal))
		if h.SwapTotal > 0 {
			fmt.Fprintf(&sb, "Swap %s / %s\n", fmtBytes(st.SwapUsed), fmtBytes(h.SwapTotal))
		}
		fmt.Fprintf(&sb, "硬盘 %s / %s (%.1f%%)\n", fmtBytes(st.DiskUsed), fmtBytes(h.DiskTotal), pct(st.DiskUsed, h.DiskTotal))
		fmt.Fprintf(&sb, "网速 ↑%s/s ↓%s/s\n", fmtBytes(st.NetOutSpeed), fmtBytes(st.NetInSpeed))
		fmt.Fprintf(&sb, "开机累计 ↑%s ↓%s\n", fmtBytes(st.NetOutTransfer), fmtBytes(st.NetInTransfer))
		fmt.Fprintf(&sb, "连接 TCP %d / UDP %d  进程 %d\n", st.TcpConnCount, st.UdpConnCount, st.ProcessCount)
		fmt.Fprintf(&sb, "运行 %s\n", fmtDuration(time.Duration(st.Uptime)*time.Second))
	}
	if t := v.Traffic; t.Known {
		fmt.Fprintf(&sb, "\n周期流量 %s / %s (%.1f%%)\n周期 %s ~ %s\n", fmtBytes(t.Used), fmtBytes(t.Limit), t.Percent(),
			t.From.In(singleton.Loc).Format("01-02"), t.To.In(singleton.Loc).Format("01-02"))
	}
	sb.WriteString(renderBillingLine(v.Billing, now))
	return sb.String()
}

func renderBillingLine(b Billing, now time.Time) string {
	if !b.Known {
		return ""
	}
	if b.Permanent {
		return fmt.Sprintf("\n续费：%s 永久\n", esc(b.Amount))
	}
	s := fmt.Sprintf("\n续费：%s / %s，到期 %s（剩余 %d 天）", esc(b.Amount), esc(b.Cycle), b.End.In(singleton.Loc).Format("2006-01-02"), b.DaysLeft(now))
	if v := b.RemainingValue(now); v != "" {
		s += "，剩余价值 " + esc(v)
	}
	if b.AutoRenewal {
		s += "，自动续费"
	}
	if b.Route != "" {
		s += "\n线路：" + esc(b.Route)
	}
	return s + "\n"
}

func renderTraffic(vs []ServerView) string {
	var sb strings.Builder
	sb.WriteString("<b>周期流量</b>\n\n")
	n := 0
	for _, v := range vs {
		if t := v.Traffic; t.Known {
			n++
			icon := "🟢"
			switch p := t.Percent(); {
			case p >= 90:
				icon = "🔴"
			case p >= 70:
				icon = "🟡"
			}
			fmt.Fprintf(&sb, "%s <b>%s</b> %s / %s (%.1f%%) 重置于 %s\n", icon, esc(v.Name), fmtBytes(t.Used), fmtBytes(t.Limit), t.Percent(),
				t.To.In(singleton.Loc).Format("01-02"))
		} else if v.State != nil {
			fmt.Fprintf(&sb, "⚪ <b>%s</b> 开机累计 ↑%s ↓%s（未配置周期规则）\n", esc(v.Name), fmtBytes(v.State.NetOutTransfer), fmtBytes(v.State.NetInTransfer))
		}
	}
	if n == 0 {
		sb.WriteString("\n提示：在面板「告警规则」里添加类型为「周期流量」的规则（如每月 256GB）后，这里会显示配额进度并在达到阈值时提醒。")
	}
	return sb.String()
}

func renderExpire(vs []ServerView, now time.Time) string {
	type row struct {
		v    ServerView
		days int
	}
	var rows []row
	for _, v := range vs {
		if v.Billing.Known && !v.Billing.Permanent {
			rows = append(rows, row{v, v.Billing.DaysLeft(now)})
		}
	}
	if len(rows) == 0 {
		return "没有服务器填写账单信息。\n在面板编辑服务器的「公开备注」，填入 billingDataMod（与官方前端格式相同）即可。"
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].days < rows[j].days })
	var sb strings.Builder
	sb.WriteString("<b>续费一览</b>\n\n")
	for _, r := range rows {
		icon := "🟢"
		switch {
		case r.days <= 0:
			icon = "⛔"
		case r.days <= 7:
			icon = "🔴"
		case r.days <= 30:
			icon = "🟡"
		}
		line := fmt.Sprintf("%s <b>%s</b> %s 剩 %d 天 (%s/%s)", icon, esc(r.v.Name), r.v.Billing.End.In(singleton.Loc).Format("2006-01-02"), r.days, esc(r.v.Billing.Amount), esc(r.v.Billing.Cycle))
		if val := r.v.Billing.RemainingValue(now); val != "" {
			line += " 余值 " + esc(val)
		}
		sb.WriteString(line + "\n")
	}
	return sb.String()
}

// ---- 提醒去重状态 ----

type notifyState struct {
	mu   sync.Mutex
	Sent map[string]int64 `json:"sent"`
}

func (s *notifyState) path() string { return filepath.Join(dataDir, "probe-state.json") }

func (s *notifyState) load() {
	s.Sent = map[string]int64{}
	if b, err := os.ReadFile(s.path()); err == nil {
		_ = json.Unmarshal(b, s)
		if s.Sent == nil {
			s.Sent = map[string]int64{}
		}
	}
}

// mark 返回 true 表示首次标记（应发送）。
func (s *notifyState) mark(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.Sent[key]; ok {
		return false
	}
	s.Sent[key] = time.Now().Unix()
	// 清理 120 天前的记录
	cutoff := time.Now().Add(-120 * 24 * time.Hour).Unix()
	for k, t := range s.Sent {
		if t < cutoff {
			delete(s.Sent, k)
		}
	}
	b, _ := json.Marshal(s)
	_ = os.WriteFile(s.path(), b, 0o600)
	return true
}

// ---- 后台任务 ----

var (
	botRunMu   sync.RWMutex
	botRunning bool
)

func isBotRunning() bool {
	botRunMu.RLock()
	defer botRunMu.RUnlock()
	return botRunning
}

// TestTelegram 使用当前配置（或传入的临时覆盖项）向指定 chat_ids 发送一条测试消息。
func TestTelegram(tokenOverride string, apiBaseOverride string, chatIDsOverride []int64) error {
	c := getConf().Telegram
	if strings.TrimSpace(tokenOverride) != "" && strings.TrimSpace(tokenOverride) != "-" {
		c.BotToken = strings.TrimSpace(tokenOverride)
	}
	if strings.TrimSpace(apiBaseOverride) != "" {
		c.APIBase = strings.TrimRight(strings.TrimSpace(apiBaseOverride), "/")
	}
	if len(chatIDsOverride) > 0 {
		c.ChatIDs = chatIDsOverride
	}
	if c.BotToken == "" {
		return fmt.Errorf("未配置 Bot Token")
	}
	if len(c.ChatIDs) == 0 {
		return fmt.Errorf("未配置 Chat ID")
	}
	tb := &bot{conf: c, client: &http.Client{Timeout: 20 * time.Second}}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var firstErr error
	for _, id := range c.ChatIDs {
		p := url.Values{}
		p.Set("chat_id", strconv.FormatInt(id, 10))
		p.Set("text", "✅ <b>VPS 探针</b>：Telegram 通知测试成功。")
		p.Set("parse_mode", "HTML")
		p.Set("disable_web_page_preview", "true")
		if err := tb.call(ctx, "sendMessage", p, nil); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// Start 启动机器人与定时任务（备份即使不配置 TG 也会运行）。
func Start() {
	c := getConf()
	st := &notifyState{}
	st.load()

	var b *bot
	if c.Telegram.BotToken != "" {
		b = &bot{conf: c.Telegram, client: &http.Client{Timeout: 90 * time.Second}}
		botRunMu.Lock()
		botRunning = true
		botRunMu.Unlock()
		go b.registerCommands()
		go b.poll()
		log.Printf("PROBE>> Telegram 机器人已启动，授权 chat: %v", c.Telegram.ChatIDs)
	} else {
		log.Printf("PROBE>> 未配置 Telegram bot_token，跳过机器人（编辑 %s）", confPath)
	}
	go loop(b, st)
}

func loop(b *bot, st *notifyState) {
	started := time.Now()
	online := map[uint64]bool{}
	lastDay := map[string]string{}
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for now := range tick.C {
		c := getConf()
		vs := collectServers(now)
		local := now.In(singleton.Loc)
		today := local.Format("2006-01-02")

		if b != nil {
			// 离线/恢复：启动后先观察 3 分钟，避免面板重启时误报
			for _, v := range vs {
				if !v.Seen {
					continue
				}
				prev, known := online[v.ID]
				online[v.ID] = v.Online
				if !known || now.Sub(started) < 3*time.Minute || !c.Telegram.NotifyOffline || prev == v.Online {
					continue
				}
				if v.Online {
					b.broadcast(fmt.Sprintf("🟢 <b>%s</b> 已恢复在线", esc(v.Name)))
				} else {
					b.broadcast(fmt.Sprintf("🔴 <b>%s</b> 离线（最后上报 %s）", esc(v.Name), v.Last.In(singleton.Loc).Format("01-02 15:04:05")))
				}
			}
			// 周期流量阈值
			for _, v := range vs {
				t := v.Traffic
				if !t.Known || t.Limit == 0 {
					continue
				}
				p := t.Percent()
				hit := 0
				for _, th := range c.Telegram.TrafficPercents {
					if p >= float64(th) && th > hit {
						hit = th
					}
				}
				if hit > 0 && st.mark(fmt.Sprintf("traffic:%d:%d:%d", v.ID, t.From.Unix(), hit)) {
					b.broadcast(fmt.Sprintf("📶 <b>%s</b> 周期流量已用 %.1f%%\n%s / %s，%s 重置", esc(v.Name), p, fmtBytes(t.Used), fmtBytes(t.Limit), t.To.In(singleton.Loc).Format("01-02")))
				}
			}
			// 到期提醒：每天 notify_hour 检查一次
			if local.Hour() >= c.Telegram.NotifyHour && lastDay["expire"] != today {
				lastDay["expire"] = today
				for _, v := range vs {
					bl := v.Billing
					if !bl.Known || bl.Permanent {
						continue
					}
					d := bl.DaysLeft(now)
					end := bl.End.Format("20060102")
					if d <= 0 && !bl.AutoRenewal {
						if st.mark(fmt.Sprintf("expired:%d:%s", v.ID, end)) {
							b.broadcast(fmt.Sprintf("⛔ <b>%s</b> 已于 %s 到期（%s/%s）", esc(v.Name), bl.End.In(singleton.Loc).Format("2006-01-02"), esc(bl.Amount), esc(bl.Cycle)))
						}
						continue
					}
					if slices.Contains(c.Telegram.ExpireDays, d) && st.mark(fmt.Sprintf("expire:%d:%s:%d", v.ID, end, d)) {
						b.broadcast(fmt.Sprintf("⏰ <b>%s</b> 还有 %d 天到期（%s）\n续费 %s / %s", esc(v.Name), d, bl.End.In(singleton.Loc).Format("2006-01-02"), esc(bl.Amount), esc(bl.Cycle)))
					}
				}
			}
		}

		// 每日自动备份
		if c.Backup.Daily && local.Hour() >= c.Backup.Hour && lastDay["backup"] != today {
			lastDay["backup"] = today
			if !hasBackupForDay(local) {
				path, err := BackupToDir(c.Backup.IncludeHistory, c.Backup.Keep)
				if err != nil {
					log.Printf("PROBE>> 自动备份失败: %v", err)
					if b != nil {
						b.broadcast("⚠️ 自动备份失败: " + esc(err.Error()))
					}
				} else {
					log.Printf("PROBE>> 自动备份完成: %s", path)
					if b != nil && c.Backup.SendToTelegram {
						for _, id := range b.conf.ChatIDs {
							if err := b.sendFile(id, path, "每日自动备份 "+today); err != nil {
								log.Printf("PROBE>> 备份发送 TG 失败: %v", err)
							}
						}
					}
				}
			}
		}
	}
}

func hasBackupForDay(local time.Time) bool {
	matches, _ := filepath.Glob(filepath.Join(dataDir, "backups", "probe-backup-"+local.Format("20060102")+"-*.tar.gz"))
	return len(matches) > 0
}
