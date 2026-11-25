import { useState } from 'react'
import { IEdit, IPlus, ITrash } from '../components/icons'
import { Field, Modal } from '../components/ui'
import { api, type Notification, type NotificationGroup } from '../lib/api'
import { PageHead, confirmDelete, useAction, useList } from './common'

export default function Notifications() {
  const { data, reload } = useList<Notification>('/notification')
  const { data: groups, reload: reloadGroups } = useList<NotificationGroup>('/notification-group')
  const [edit, setEdit] = useState<Notification | 'new' | null>(null)
  const [editGroup, setEditGroup] = useState<NotificationGroup | 'new' | null>(null)
  const { run } = useAction()

  const del = async (n: Notification) => {
    if (!confirmDelete(n.name)) return
    if (await run(() => api('/batch-delete/notification', { method: 'POST', body: [n.id] }), '已删除')) reload()
  }
  const delGroup = async (g: NotificationGroup) => {
    if (!confirmDelete(g.group.name)) return
    if (await run(() => api('/batch-delete/notification-group', { method: 'POST', body: [g.group.id] }), '已删除')) reloadGroups()
  }

  return (
    <>
      <PageHead title="通知方式" desc={<>面板自带的 Webhook 通知，用于告警规则与延迟监控。交互式 TG 机器人（/list、到期提醒、自动备份）在 <code>data/probe.yaml</code> 里配置。</>}>
        <button className="btn primary" onClick={() => setEdit('new')}><IPlus />添加通知</button>
      </PageHead>
      <div className="glass table-wrap" style={{ marginBottom: 24 }}>
        <table className="t">
          <thead><tr><th>名称</th><th>方式</th><th /></tr></thead>
          <tbody>
            {data?.length === 0 && <tr><td colSpan={3} className="empty">还没有通知方式</td></tr>}
            {data?.map((n) => (
              <tr key={n.id}>
                <td><b>{n.name}</b></td>
                <td><span className="tag plain">{n.request_method === 2 ? 'POST' : 'GET'}</span> <span className="tag plain">{n.request_type === 2 ? 'Form' : 'JSON'}</span></td>
                <td><div className="act">
                  <button className="btn sm" onClick={() => setEdit(n)}><IEdit />编辑</button>
                  <button className="btn sm danger" onClick={() => del(n)}><ITrash /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PageHead title="通知组" desc="告警规则和监控按组发送通知。">
        <button className="btn" onClick={() => setEditGroup('new')}><IPlus />新建通知组</button>
      </PageHead>
      <div className="glass table-wrap">
        <table className="t">
          <thead><tr><th>名称</th><th>包含</th><th /></tr></thead>
          <tbody>
            {groups?.length === 0 && <tr><td colSpan={3} className="empty">还没有通知组</td></tr>}
            {groups?.map((g) => (
              <tr key={g.group.id}>
                <td><b>{g.group.name}</b></td>
                <td><div className="wrap">{(g.notifications || []).map((id) => <span key={id} className="tag plain">{data?.find((n) => n.id === id)?.name || `#${id}`}</span>)}</div></td>
                <td><div className="act">
                  <button className="btn sm" onClick={() => setEditGroup(g)}><IEdit />编辑</button>
                  <button className="btn sm danger" onClick={() => delGroup(g)}><ITrash /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <NotifModal n={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
      {editGroup && <GroupModal g={editGroup === 'new' ? null : editGroup} notifs={data || []} onClose={() => setEditGroup(null)} onSaved={() => { setEditGroup(null); reloadGroups() }} />}
    </>
  )
}

function NotifModal({ n, onClose, onSaved }: { n: Notification | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: n?.name || '', url: '', request_method: n?.request_method || 1, request_type: n?.request_type || 1,
    request_header: '', request_body: '', verify_tls: n ? !!n.verify_tls : true, format_metric_units: n ? !!n.format_metric_units : true, skip_check: false,
  })
  const [tg, setTg] = useState({ token: '', chat: '' })
  const { busy, run } = useAction()
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })

  const fillTelegram = () => {
    if (!tg.token || !tg.chat) return
    set({
      name: f.name || 'Telegram', request_method: 2, request_type: 1,
      url: `https://api.telegram.org/bot${tg.token}/sendMessage`,
      request_body: JSON.stringify({ chat_id: tg.chat, text: '#NEZHA#' }),
    })
  }

  const save = async () => {
    const ok = await run(() => n ? api(`/notification/${n.id}`, { method: 'PATCH', body: f }) : api('/notification', { method: 'POST', body: f }), '已保存')
    if (ok) onSaved()
  }

  return (
    <Modal title={n ? '编辑通知' : '添加通知'} onClose={onClose} width={680} footer={<>
      <button className="btn" onClick={onClose}>取消</button>
      <button className="btn primary" disabled={busy || !f.name.trim() || (!n && !f.url.trim())} onClick={save}>保存</button>
    </>}>
      <div className="form">
        {!n && <>
          <div className="form-sec" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>Telegram 快速填写（可选）</div>
          <Field label="Bot Token"><input className="input" value={tg.token} onChange={(e) => setTg({ ...tg, token: e.target.value })} placeholder="123456:ABC…" /></Field>
          <Field label="Chat ID"><input className="input" value={tg.chat} onChange={(e) => setTg({ ...tg, chat: e.target.value })} placeholder="123456789" /></Field>
          <div className="full"><button type="button" className="btn sm" onClick={fillTelegram} disabled={!tg.token || !tg.chat}>填入下方</button></div>
          <div className="form-sec">Webhook</div>
        </>}
        <Field label="名称" full><input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="URL" full hint={n ? '留空则保持原值（列表里不回显 URL，防止泄露密钥）' : '可在 URL 或请求体中使用 #NEZHA# 作为消息内容占位符'}>
          <input className="input" value={f.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" />
        </Field>
        <Field label="请求方式">
          <select className="select" value={f.request_method} onChange={(e) => set({ request_method: Number(e.target.value) })}>
            <option value={1}>GET</option><option value={2}>POST</option>
          </select>
        </Field>
        <Field label="请求体格式">
          <select className="select" value={f.request_type} onChange={(e) => set({ request_type: Number(e.target.value) })}>
            <option value={1}>JSON</option><option value={2}>Form</option>
          </select>
        </Field>
        <Field label="请求头（JSON）" full hint={n ? '留空则保持原值' : undefined}><textarea className="textarea" rows={2} value={f.request_header} onChange={(e) => set({ request_header: e.target.value })} placeholder='{"Authorization":"…"}' /></Field>
        <Field label="请求体" full hint={n ? '留空则保持原值' : undefined}><textarea className="textarea" rows={3} value={f.request_body} onChange={(e) => set({ request_body: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={f.verify_tls} onChange={(e) => set({ verify_tls: e.target.checked })} />校验 TLS 证书</label>
        <label className="check"><input type="checkbox" checked={f.format_metric_units} onChange={(e) => set({ format_metric_units: e.target.checked })} />格式化指标单位</label>
        <label className="check full"><input type="checkbox" checked={f.skip_check} onChange={(e) => set({ skip_check: e.target.checked })} />保存时不发送测试消息</label>
      </div>
    </Modal>
  )
}

function GroupModal({ g, notifs, onClose, onSaved }: { g: NotificationGroup | null; notifs: Notification[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(g?.group.name || '')
  const [sel, setSel] = useState<number[]>(g?.notifications || [])
  const { busy, run } = useAction()
  const save = async () => {
    const body = { name, notifications: sel }
    const ok = await run(() => g ? api(`/notification-group/${g.group.id}`, { method: 'PATCH', body }) : api('/notification-group', { method: 'POST', body }), '已保存')
    if (ok) onSaved()
  }
  return (
    <Modal title={g ? '编辑通知组' : '新建通知组'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>取消</button>
      <button className="btn primary" disabled={busy || !name.trim()} onClick={save}>保存</button>
    </>}>
      <div className="form">
        <Field label="名称" full><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <div className="fld full">
          <span>包含的通知方式</span>
          {notifs.length === 0 ? <div className="muted">先添加通知方式</div> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
              {notifs.map((n) => (
                <label key={n.id} className="check">
                  <input type="checkbox" checked={sel.includes(n.id)} onChange={(e) => setSel(e.target.checked ? [...sel, n.id] : sel.filter((x) => x !== n.id))} />
                  {n.name}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
