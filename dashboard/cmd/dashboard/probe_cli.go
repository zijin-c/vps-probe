package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/nezhahq/nezha/service/probe"
	"github.com/nezhahq/nezha/service/singleton"
)

// runProbeCli 处理只读分支的启动前逻辑：
//   - -restore 文件：恢复后退出（返回 true）
//   - -backup 文件：导出备份后退出（返回 true）
//   - 正常启动：先应用面板上传的待恢复备份，再加载 probe.yaml（返回 false）
func runProbeCli() bool {
	p := probe.Paths{Config: dashboardCliParam.ConfigFile, DB: dashboardCliParam.DatabaseLocation}
	dir := filepath.Dir(dashboardCliParam.ConfigFile)
	probe.SetPaths(p)

	if dashboardCliParam.Restore != "" {
		if err := probe.ApplyRestore(dashboardCliParam.Restore, p, dir); err != nil {
			log.Fatalf("恢复失败: %v", err)
		}
		fmt.Println("恢复完成，现在可以启动面板了。")
		return true
	}

	if dashboardCliParam.Backup != "" {
		must := func(err error) {
			if err != nil {
				log.Fatalf("备份失败: %v", err)
			}
		}
		must(probe.Init(dir))
		must(singleton.InitConfigFromPath(dashboardCliParam.ConfigFile))
		must(singleton.InitTimezoneAndCache())
		must(singleton.InitDBFromPath(dashboardCliParam.DatabaseLocation))
		f, err := os.OpenFile(dashboardCliParam.Backup, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		must(err)
		// 命令行备份不含 TSDB 历史：面板运行时 TSDB 目录被占用
		must(probe.WriteBackup(f, false))
		must(f.Close())
		fmt.Println("备份已写入", dashboardCliParam.Backup)
		return true
	}

	if err := probe.ApplyPendingRestore(p, dir); err != nil {
		log.Printf("PROBE>> %v", err)
	}
	if err := probe.Init(dir); err != nil {
		log.Fatalf("PROBE>> %v", err)
	}
	return false
}
