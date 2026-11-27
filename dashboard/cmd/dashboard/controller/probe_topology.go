package controller

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/probe"
	"github.com/nezhahq/nezha/service/singleton"
)

// registerTopologyRoutes 注册网络拓扑（前台公开读取）与账号记录（仅管理员）接口。
func registerTopologyRoutes(r *gin.Engine, authMw, optionalAuthMw gin.HandlerFunc) {
	r.GET("/api/v1/probe/topology", optionalAuthMw, probeGetTopology)
	admin := r.Group("api/v1/probe", authMw, csrfMiddleware(), restScopeMiddleware(model.ScopeAdminAll), probeAdminOnly)
	admin.PUT("/topology", probeSaveTopology)
	admin.GET("/accounts", probeListAccounts)
	admin.PUT("/accounts", probeSaveAccounts)
}

// probeGetTopology 返回拓扑图。访客看不到"对访客隐藏"的服务器的关联信息
// （节点本身由管理员主动放进拓扑，仍然展示，只是去掉 server_id，不暴露其实时状态）。
func probeGetTopology(c *gin.Context) {
	t := probe.GetTopology()
	if _, signedIn := c.Get(model.CtxKeyAuthorizedUser); !signedIn {
		for i := range t.Nodes {
			if id := t.Nodes[i].ServerID; id != 0 {
				if s, ok := singleton.ServerShared.Get(id); !ok || s == nil || s.HideForGuest {
					t.Nodes[i].ServerID = 0
				}
			}
		}
	}
	c.JSON(http.StatusOK, model.CommonResponse[probe.Topology]{Success: true, Data: t})
}

func probeSaveTopology(c *gin.Context) {
	var in probe.Topology
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, newErrorResponse(err))
		return
	}
	out, err := probe.SaveTopology(in)
	if err != nil {
		c.JSON(http.StatusOK, newErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.CommonResponse[probe.Topology]{Success: true, Data: out})
}

func probeListAccounts(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, model.CommonResponse[[]probe.AccountRecord]{Success: true, Data: probe.ListAccounts()})
}

func probeSaveAccounts(c *gin.Context) {
	var in []probe.AccountRecord
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, newErrorResponse(err))
		return
	}
	out, err := probe.SaveAccounts(in)
	if err != nil {
		c.JSON(http.StatusOK, newErrorResponse(err))
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, model.CommonResponse[[]probe.AccountRecord]{Success: true, Data: out})
}
