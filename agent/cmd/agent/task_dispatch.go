package main

import (
	"context"

	"github.com/nezhahq/agent/model"
	pb "github.com/nezhahq/agent/proto"
)

func receiveTasksDaemon(tasks *requestTaskSession, session *connectionSession) {
	execution := agentTaskExecution{
		parent:  tasks.Context(),
		session: session,
		send:    tasks.Send,
		cancel:  func() { session.signalExit(context.Canceled) },
	}
	for {
		task, err := tasks.Recv()
		if err != nil {
			printf("receiveTasks exit: %v", err)
			session.signalExit(err)
			return
		}
		execution.dispatch(task)
	}
}

func dispatchAgentTask(task *pb.Task, send func(*pb.TaskResult) error, cancel context.CancelFunc) {
	agentTaskExecution{
		parent: context.Background(),
		send:   send,
		cancel: cancel,
	}.dispatch(task)
}

type agentTaskRunner func(context.Context, *model.AgentConfig, *pb.Task) *pb.TaskResult

type agentTaskExecution struct {
	parent     context.Context
	session    *connectionSession
	send       func(*pb.TaskResult) error
	cancel     context.CancelFunc
	runTask    agentTaskRunner
	onTaskExit func()
}

// isReadOnlyTask 列出本分支 Agent 唯一会执行的任务类型（只读探测）。
// 远程命令、终端、文件管理、NAT、远程升级、远程改配置/读配置、服务器迁移、
// MCP exec/fs 等能力在这里被硬性拒绝，面板无论下发什么都不会执行；
// 这些 handler 不再被引用，链接器也会把它们从二进制中剔除。
func isReadOnlyTask(taskType uint64) bool {
	switch taskType {
	case model.TaskTypeHTTPGet, model.TaskTypeICMPPing, model.TaskTypeTCPPing, model.TaskTypeKeepalive:
		return true
	}
	return false
}

func (e agentTaskExecution) dispatch(task *pb.Task) {
	if !isReadOnlyTask(task.GetType()) {
		printf("只读模式，拒绝任务类型: %d", task.GetType())
		return
	}
	config := loadRuntimeConfig()
	go e.runAgentTask(e.parent, config, task)
}

func (e agentTaskExecution) runAgentTask(
	taskContext context.Context,
	config *model.AgentConfig,
	task *pb.Task,
) {
	if e.onTaskExit != nil {
		defer e.onTaskExit()
	}
	defer func() {
		if err := recover(); err != nil {
			println("task panic", task, err)
		}
	}()
	runTask := e.runTask
	if runTask == nil {
		runTask = doTaskWithSnapshot
	}
	result := runTask(taskContext, config, task)
	if result == nil {
		return
	}
	if err := e.send(result); err != nil {
		printf("send task result exit: %v", err)
		e.cancel()
	}
}

func doTask(task *pb.Task) *pb.TaskResult {
	return doTaskWithSnapshot(context.Background(), loadRuntimeConfig(), task)
}

func doTaskWithContext(parent context.Context, task *pb.Task) *pb.TaskResult {
	return doTaskWithSnapshot(parent, loadRuntimeConfig(), task)
}

func doTaskWithSnapshot(
	parent context.Context,
	config *model.AgentConfig,
	task *pb.Task,
) *pb.TaskResult {
	_ = parent
	if !isReadOnlyTask(task.GetType()) {
		printf("只读模式，拒绝任务类型: %d", task.GetType())
		return nil
	}
	result := &pb.TaskResult{Id: task.GetId(), Type: task.GetType()}
	gates := taskFeatureGatesFrom(config)
	switch task.GetType() {
	case model.TaskTypeHTTPGet:
		handleHttpGetTaskWithConfig(gates, task, result)
	case model.TaskTypeICMPPing:
		handleIcmpPingTaskWithConfig(gates, task, result)
	case model.TaskTypeTCPPing:
		handleTcpPingTaskWithConfig(gates, task, result)
	case model.TaskTypeKeepalive:
	}
	return result
}
