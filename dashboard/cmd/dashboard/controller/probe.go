package controller

import (
	_ "embed"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-json"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/probe"
	"github.com/nezhahq/nezha/service/singleton"
)

//go:embed probe_backup.html
var probeBackupPage []byte

const probeRestoreMaxBytes = 2 << 30 // 上传上限 2GiB

// registerProbeRoutes 注册只读分支的备份/恢复接口。
// 独立分组，不走 /api/v1 的请求体限长（备份文件可能较大），但沿用同一套
// JWT/PAT 认证与 CSRF 校验，且只允许管理员。
func registerProbeRoutes(r *gin.Engine, authMw, optionalAuthMw gin.HandlerFunc) {
	// IP / 线路质量：Agent 用自己的密钥 + UUID 上报与拉取检测计划
	r.GET("/api/v1/probe/agent/quality", probeAgentSchedule)
	r.POST("/api/v1/probe/agent/quality", probeAgentUpload)
	// 前台读取（访客可看，IP 遮罩；对访客隐藏的服务器不返回）
	r.GET("/api/v1/probe/quality", optionalAuthMw, probeQualitySummary)
	r.GET("/api/v1/probe/quality/:id", optionalAuthMw, probeGetQuality)
	// 后台：请求某台服务器重新检测
	r.POST("/api/v1/probe/quality/:id/refresh", authMw, csrfMiddleware(), restScopeMiddleware(model.ScopeAdminAll), probeAdminOnly, probeRefreshQuality)

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
	g.GET("/backups", probeListBackups)
	g.POST("/backups", probeCreateBackup)
	g.GET("/backups/:name", probeDownloadLocalBackup)
	g.DELETE("/backups/:name", probeDeleteLocalBackup)
	g.POST("/backups/:name/restore", probeRestoreLocalBackup)
	g.GET("/config", probeGetConfig)
	g.PATCH("/config", probeSaveConfig)
	g.POST("/telegram/test", probeTestTelegram)
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

const probeQualityMaxBytes = 1 << 20

func probeAgentServer(c *gin.Context) (uint64, bool) {
	id, err := probe.AuthAgent(c.GetHeader("X-Agent-UUID"), c.GetHeader("X-Agent-Secret"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, newErrorResponse(err))
		return 0, false
	}
	return id, true
}

func probeAgentSchedule(c *gin.Context) {
	id, ok := probeAgentServer(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, model.CommonResponse[map[string]any]{Success: true, Data: probe.QualitySchedule(id)})
}

func probeAgentUpload(c *gin.Context) {
	id, ok := probeAgentServer(c)
	if !ok {
		return
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, probeQualityMaxBytes+1))
	if err != nil || len(body) > probeQualityMaxBytes {
		c.JSON(http.StatusBadRequest, newErrorResponse(errors.New("report too large")))
		return
	}
	var probeJSON map[string]any
	if json.Unmarshal(body, &probeJSON) != nil {
		c.JSON(http.StatusBadRequest, newErrorResponse(errors.New("invalid json")))
		return
	}
	if err := probe.SaveQuality(id, body); err != nil {
		c.JSON(http.StatusInternalServerError, newErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.CommonResponse[any]{Success: true})
}

func probeServerParam(c *gin.Context) (uint64, *model.Server, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusOK, newErrorResponse(errors.New("server not found")))
		return 0, nil, false
	}
	s, ok := singleton.ServerShared.Get(id)
	if !ok || s == nil {
		c.JSON(http.StatusOK, newErrorResponse(errors.New("server not found")))
		return 0, nil, false
	}
	return id, s, true
}

func probeGetQuality(c *gin.Context) {
	id, s, ok := probeServerParam(c)
	if !ok {
		return
	}
	_, signedIn := c.Get(model.CtxKeyAuthorizedUser)
	if !signedIn && s.HideForGuest {
		c.JSON(http.StatusOK, newErrorResponse(errors.New("server not found")))
		return
	}
	c.JSON(http.StatusOK, model.CommonResponse[map[string]any]{Success: true, Data: probe.GetQuality(id, !signedIn)})
}

// probeQualitySummary 返回所有可见服务器的线路 / 解锁摘要，供首页卡片自动显示。
func probeQualitySummary(c *gin.Context) {
	_, signedIn := c.Get(model.CtxKeyAuthorizedUser)
	var ids []uint64
	for _, s := range singleton.ServerShared.GetSortedList() {
		if signedIn || !s.HideForGuest {
			ids = append(ids, s.ID)
		}
	}
	data := map[string]probe.QualityBrief{}
	for id, b := range probe.QualitySummaries(ids) {
		data[strconv.FormatUint(id, 10)] = b
	}
	c.JSON(http.StatusOK, model.CommonResponse[map[string]probe.QualityBrief]{Success: true, Data: data})
}

func probeRefreshQuality(c *gin.Context) {
	id, _, ok := probeServerParam(c)
	if !ok {
		return
	}
	var body struct {
		Parts []string `json:"parts"`
	}
	_ = c.ShouldBindJSON(&body)
	parts := probe.RequestQualityRefresh(id, body.Parts)
	c.JSON(http.StatusOK, model.CommonResponse[[]string]{Success: true, Data: parts})
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

func probeListBackups(c *gin.Context) {
	items, err := probe.ListBackups()
	if err != nil {
		c.JSON(http.StatusInternalServerError, newErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.CommonResponse[[]probe.BackupEntry]{Success: true, Data: items})
}

func probeCreateBackup(c *gin.Context) {
	var body struct {
		IncludeHistory bool `json:"include_history"`
	}
	_ = c.ShouldBindJSON(&body)
	keep := probe.GetConfigView().Backup.Keep
	if keep <= 0 {
		keep = 7
	}
	path, err := probe.BackupToDir(body.IncludeHistory, keep)
	if err != nil {
		c.JSON(http.StatusInternalServerError, newErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.CommonResponse[string]{Success: true, Data: filepath.Base(path)})
}

func probeDownloadLocalBackup(c *gin.Context) {
	name := c.Param("name")
	p, err := probe.BackupPath(name)
	if err != nil {
		c.JSON(http.StatusBadRequest, newErrorResponse(err))
		return
	}
	c.Header("Content-Type", "application/gzip")
	c.Header("Content-Disposition", `attachment; filename="`+name+`"`)
	c.Header("Cache-Control", "no-store")
	c.File(p)
}

func probeDeleteLocalBackup(c *gin.Context) {
	name := c.Param("name")
	if err := probe.DeleteBackup(name); err != nil {
		c.JSON(http.StatusBadRequest, newErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.CommonResponse[any]{Success: true})
}

func probeRestoreLocalBackup(c *gin.Context) {
	name := c.Param("name")
	if err := probe.StageLocalBackupRestore(name); err != nil {
		c.JSON(http.StatusBadRequest, newErrorResponse(err))
		return
	}
	log.Printf("PROBE>> 已选定本地备份 %s，面板即将重启以应用", name)
	c.JSON(http.StatusOK, model.CommonResponse[string]{Success: true, Data: "备份校验通过，面板正在重启并恢复数据，约 10 秒后刷新页面"})
	go probe.RequestRestart()
}

func probeGetConfig(c *gin.Context) {
	c.JSON(http.StatusOK, model.CommonResponse[probe.ConfigView]{Success: true, Data: probe.GetConfigView()})
}

func probeSaveConfig(c *gin.Context) {
	var patch probe.ConfigPatch
	if err := c.ShouldBindJSON(&patch); err != nil {
		c.JSON(http.StatusBadRequest, newErrorResponse(err))
		return
	}
	needRestart, err := probe.SaveConfigPatch(patch)
	if err != nil {
		c.JSON(http.StatusInternalServerError, newErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.CommonResponse[map[string]any]{
		Success: true,
		Data: map[string]any{
			"need_restart": needRestart,
			"config":       probe.GetConfigView(),
		},
	})
}

func probeTestTelegram(c *gin.Context) {
	var body struct {
		BotToken string  `json:"bot_token"`
		APIBase  string  `json:"api_base"`
		ChatIDs  []int64 `json:"chat_ids"`
	}
	_ = c.ShouldBindJSON(&body)
	if err := probe.TestTelegram(body.BotToken, body.APIBase, body.ChatIDs); err != nil {
		c.JSON(http.StatusOK, newErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.CommonResponse[string]{Success: true, Data: "测试消息已发送"})
}
