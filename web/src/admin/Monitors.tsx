import { useState } from 'react'
import { IEdit, IPlus, ITrash } from '../components/icons'
import { Field, Modal } from '../components/ui'
import { api, type NotificationGroup, type ServerRow, type Service } from '../lib/api'
import { PageHead, ServerPicker, useAction, useConfirmDelete, useList } from './common'

const TYPES: Record<number, string> = { 1: 'HTTP GET', 2: 'ICMP Ping', 3: 'TCPing' }

export default function Monitors() {
  const { data, reload } = useList<Service>('/service/list')
  const { data: servers } = useList<ServerRow>('/server')
  const { data: groups } = useList<NotificationGroup>('/notification-group')
  const [edit, setEdit] = useState<Service | 'new' | null>(null)
  const { run } = useAction()
  const confirmDelete = useConfirmDelete()

  const del = async (s: Service) => {
    if (!(await confirmDelete(s.name))) return
    if (await run(() => api('/batch-delete/service', { method: 'POST', body: [s.id] }), '已删除')) reload()
  }
  const coverText = (s: Service) => {
    const n = Object.keys(s.skip_servers || {}).length
    return s.cover === 1 ? `仅 ${n} 台` : n ? `全部（排除 ${n} 台）` : '全部服务器'
  }

  return (
    <>
      <PageHead title="延迟监控" desc="由各 Agent 定时探测目标，结果显示为前台卡片上的三网延迟与丢包。建议每家运营商各选一个测速节点。">
        <button className="btn primary" onClick={() => setEdit('new')}><IPlus />添加监控</button>
      </PageHead>
      <div className="glass table-wrap">
        <table className="t stack">
          <thead><tr><th>名称</th><th>类型</th><th>目标</th><th>间隔</th><th>覆盖</th><th>通知</th><th /></tr></thead>
          <tbody>
            {data === null && <tr><td colSpan={7} className="empty">加载中…</td></tr>}
            {data?.length === 0 && <tr><td colSpan={7} className="empty">还没有监控。例：名称「电信」，类型 TCPing，目标 某电信节点:80</td></tr>}
            {data?.map((s) => (
              <tr key={s.id}>
                <td className="first"><b>{s.name}</b>{s.hide_for_guest && <span className="tag plain" style={{ marginLeft: 6 }}>隐藏</span>}</td>
                <td data-l="类型"><span className="tag plain">{TYPES[s.type] || s.type}</span></td>
                <td data-l="目标" className="mono" style={{ fontSize: 12.5 }}>{s.target}</td>
                <td data-l="间隔" className="tnum">{s.duration}s</td>
                <td data-l="覆盖">{coverText(s)}</td>
                <td data-l="通知">{s.notify || s.latency_notify ? <span className="tag ok">开启</span> : <span className="muted">—</span>}</td>
                <td><div className="act">
                  <button className="btn sm" onClick={() => setEdit(s)}><IEdit />编辑</button>
                  <button className="btn sm ghost danger" onClick={() => del(s)} aria-label="删除"><ITrash /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <MonitorModal s={edit === 'new' ? null : edit} servers={servers || []} groups={groups || []}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
    </>
  )
}

function MonitorModal({ s, servers, groups, onClose, onSaved }: {
  s: Service | null; servers: ServerRow[]; groups: NotificationGroup[]; onClose: () => void; onSaved: () => void
}) {
  const [f, setF] = useState({
    name: s?.name || '', type: s?.type || 3, target: s?.target || '', duration: s?.duration || 30,
    cover: s?.cover ?? 0, skip_servers: s?.skip_servers || {}, hide_for_guest: !!s?.hide_for_guest,
    notify: !!s?.notify, latency_notify: !!s?.latency_notify, min_latency: s?.min_latency || 0, max_latency: s?.max_latency || 0,
    notification_group_id: s?.notification_group_id || 0, display_index: s?.display_index || 0,
  })
  const { busy, run } = useAction()
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })
  const placeholder = f.type === 1 ? 'https://example.com' : f.type === 2 ? '1.2.3.4 或域名' : '1.2.3.4:80'

  const save = async () => {
    const body = {
      ...f, type: Number(f.type), duration: Number(f.duration), cover: Number(f.cover),
      min_latency: Number(f.min_latency), max_latency: Number(f.max_latency), display_index: Number(f.display_index),
      enable_trigger_task: false, fail_trigger_tasks: [], recover_trigger_tasks: [],
    }
    const ok = await run(() => s ? api(`/service/${s.id}`, { method: 'PATCH', body }) : api('/service', { method: 'POST', body }), '已保存')
    if (ok) onSaved()
  }

  return (
    <Modal title={s ? '编辑监控' : '添加监控'} onClose={onClose} width={680} footer={<>
      <button className="btn" onClick={onClose}>取消</button>
      <button className="btn primary" disabled={busy || !f.name.trim() || !f.target.trim()} onClick={save}>保存</button>
    </>}>
      <div className="form">
        <Field label="名称" hint="会显示在卡片上，建议短一些，如「电信」「联通」"><input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
        <Field label="类型">
          <select className="select" value={f.type} onChange={(e) => set({ type: Number(e.target.value) })}>
            <option value={3}>TCPing（推荐，无需 root）</option>
            <option value={2}>ICMP Ping</option>
            <option value={1}>HTTP GET</option>
          </select>
        </Field>
        <Field label="目标"><input className="input" placeholder={placeholder} value={f.target} onChange={(e) => set({ target: e.target.value })} /></Field>
        <Field label="探测间隔（秒）"><input className="input" type="number" min={5} value={f.duration} onChange={(e) => set({ duration: Number(e.target.value) })} /></Field>
        <Field label="覆盖范围">
          <select className="select" value={f.cover} onChange={(e) => set({ cover: Number(e.target.value) })}>
            <option value={0}>全部服务器（可排除）</option>
            <option value={1}>仅选中的服务器</option>
          </select>
        </Field>
        <Field label="排序" hint="越大越靠前"><input className="input" type="number" value={f.display_index} onChange={(e) => set({ display_index: Number(e.target.value) })} /></Field>
        <div className="fld full">
          <span>{f.cover === 1 ? '由这些服务器探测' : '排除这些服务器'}</span>
          <ServerPicker servers={servers} value={f.skip_servers} onChange={(v) => set({ skip_servers: v })} />
        </div>
        <label className="check full"><input type="checkbox" checked={f.hide_for_guest} onChange={(e) => set({ hide_for_guest: e.target.checked })} />对访客隐藏</label>

        <div className="form-sec">通知</div>
        <label className="check"><input type="checkbox" checked={f.notify} onChange={(e) => set({ notify: e.target.checked })} />不可达时通知</label>
        <label className="check"><input type="checkbox" checked={f.latency_notify} onChange={(e) => set({ latency_notify: e.target.checked })} />延迟超出范围时通知</label>
        {f.latency_notify && <>
          <Field label="最低延迟（ms）"><input className="input" type="number" value={f.min_latency} onChange={(e) => set({ min_latency: Number(e.target.value) })} /></Field>
          <Field label="最高延迟（ms）"><input className="input" type="number" value={f.max_latency} onChange={(e) => set({ max_latency: Number(e.target.value) })} /></Field>
        </>}
        {(f.notify || f.latency_notify) && (
          <Field label="通知组" full>
            <select className="select" value={f.notification_group_id} onChange={(e) => set({ notification_group_id: Number(e.target.value) })}>
              <option value={0}>— 请选择 —</option>
              {groups.map((g) => <option key={g.group.id} value={g.group.id}>{g.group.name}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  )
}
