package controller

import (
	_ "embed"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/probe"
)

//go:embed probe_backup.html
var probeBackupPage []byte

const probeRestoreMaxBytes = 2 << 30 // 上传上限 2GiB

// registerProbeRoutes 注册只读分支的备份/恢复接口。
// 独立分组，不走 /api/v1 的请求体限长（备份文件可能较大），但沿用同一套
// JWT/PAT 认证与 CSRF 校验，且只允许管理员。
func registerProbeRoutes(r *gin.Engine, authMw gin.HandlerFunc) {
	r.GET("/probe/backup", func(c *gin.Context) {
		c.Header("X-Frame-Options", "DENY")
		c.Header("Cache-Control", "no-store")
		c.Data(http.StatusOK, "text/html; charset=utf-8", probeBackupPage)
	})
	// 分发本分支的只读 Agent 与安装脚本（只允许白名单文件名，目录由 PROBE_AGENT_DIR 指定）
	r.GET("/probe/agent/:file", probeServeAgent)
	g := r.Group("api/v1/probe", authMw, csrfMiddleware(), restScopeMiddleware(model.ScopeAdminAll), probeAdminOnly)
	g.GET("/backup", probeDownloadBackup)
	g.POST("/restore", probeUploadRestore)
}

var probeAgentFiles = map[string]string{
	"install.sh":              "text/x-shellscript; charset=utf-8",
	"nezha-agent-linux-amd64": "application/octet-stream",
	"nezha-agent-linux-arm64": "application/octet-stream",
	"nezha-agent-linux-armv7": "application/octet-stream",
	"nezha-agent-linux-386":   "application/octet-stream",
}

func probeServeAgent(c *gin.Context) {
	name := c.Param("file")
	ctype, ok := probeAgentFiles[name]
	if !ok {
		c.Status(http.StatusNotFound)
		return
	}
	dir := os.Getenv("PROBE_AGENT_DIR")
	if dir == "" {
		dir = "agent-dist"
	}
	path := filepath.Join(dir, name)
	if _, err := os.Stat(path); err != nil {
		c.String(http.StatusNotFound, "未找到 %s：请把编译好的 Agent 放到 %s 目录", name, dir)
		return
	}
	c.Header("Content-Type", ctype)
	c.File(path)
}

func probeAdminOnly(c *gin.Context) {
	auth, ok := c.Get(model.CtxKeyAuthorizedUser)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, newErrorResponse(errors.New("unauthorized")))
		return
	}
	if u, ok := auth.(*model.User); !ok || !u.Role.IsAdmin() {
		c.AbortWithStatusJSON(http.StatusForbidden, newErrorResponse(errors.New("permission denied")))
		return
	}
	c.Next()
}

func probeDownloadBackup(c *gin.Context) {
	history := c.Query("history") == "1"
	c.Header("Content-Type", "application/gzip")
	c.Header("Content-Disposition", `attachment; filename="`+probe.BackupFileName(time.Now())+`"`)
	c.Header("Cache-Control", "no-store")
	c.Status(http.StatusOK)
	if err := probe.WriteBackup(c.Writer, history); err != nil {
		// 头已发出，只能记日志并中断连接，客户端会得到不完整文件（校验会失败）
		log.Printf("PROBE>> 下载备份失败: %v", err)
		_ = c.Error(err)
		c.Abort()
	}
}

func probeUploadRestore(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, probeRestoreMaxBytes)
	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, newErrorResponse(errors.New("请选择备份文件")))
		return
	}
	src, err := fh.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, newErrorResponse(err))
		return
	}
	defer src.Close()
	tmp, err := os.CreateTemp(probe.DataDir(), ".upload-*.tar.gz")
	if err != nil {
		c.JSON(http.StatusInternalServerError, newErrorResponse(err))
		return
	}
	tmpName := tmp.Name()
	_, err = io.Copy(tmp, src)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmpName)
		c.JSON(http.StatusInternalServerError, newErrorResponse(err))
		return
	}
	if err := probe.StagePendingRestore(tmpName); err != nil {
		os.Remove(tmpName)
		c.JSON(http.StatusBadRequest, newErrorResponse(err))
		return
	}
	log.Printf("PROBE>> 已接收恢复文件 %s，面板即将重启以应用", filepath.Base(fh.Filename))
	c.JSON(http.StatusOK, model.CommonResponse[string]{Success: true, Data: "备份校验通过，面板正在重启并恢复数据，约 10 秒后刷新页面"})
	go probe.RequestRestart()
}
