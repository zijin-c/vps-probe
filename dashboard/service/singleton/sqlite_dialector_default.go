//go:build !agentcompat || !linux

package singleton

import (
	// 只读分支：改用纯 Go 的 SQLite 驱动（基于 modernc.org/sqlite），
	// 无需 CGO 即可交叉编译各架构；数据库文件格式与上游完全兼容。
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func openSQLiteDialector(path string) gorm.Dialector {
	return sqlite.Open(path)
}
