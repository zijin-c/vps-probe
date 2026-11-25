package probe

import (
	"log"
	"os"
	"sync/atomic"
	"time"
)

var restartRequested atomic.Bool

// RestartRequested 供 main 在优雅退出后判断是否需要以非零码退出（触发 docker/systemd 重启）。
func RestartRequested() bool { return restartRequested.Load() }

// RequestRestart 触发优雅退出；依赖 docker restart 策略或 systemd Restart=always 拉起，
// 新进程启动时会应用 data/restore-pending.tar.gz。
func RequestRestart() {
	restartRequested.Store(true)
	time.Sleep(time.Second) // 让 HTTP 响应先发出去
	if p, err := os.FindProcess(os.Getpid()); err == nil {
		if err := p.Signal(os.Interrupt); err == nil {
			time.Sleep(20 * time.Second)
		}
	}
	log.Println("PROBE>> 优雅退出超时，强制退出以完成恢复")
	os.Exit(3)
}
