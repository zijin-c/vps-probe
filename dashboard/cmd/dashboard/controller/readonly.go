package controller

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// errReadOnlyFork 由只读分支返回：远程命令、终端、文件管理、NAT 穿透、
// 计划任务（执行命令）、远程改 Agent 配置、远程升级、MCP exec/fs 均已禁用。
// 对应的 Agent 侧也在任务分发处硬性拒绝，两边任意一侧都足以阻止执行。
var errReadOnlyFork = errors.New("此探针为只读分支：远程命令/终端/文件管理/NAT/计划任务/远程配置/远程升级已禁用")

func readOnlyForbidden(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusForbidden, newErrorResponse(errReadOnlyFork))
}
