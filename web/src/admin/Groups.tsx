import { useState } from 'react'
import { IEdit, IPlus, ITrash } from '../components/icons'
import { Field, Modal } from '../components/ui'
import { api, type ServerGroup, type ServerRow } from '../lib/api'
import { PageHead, ServerPicker, useAction, useConfirmDelete, useList } from './common'

export default function Groups() {
  const { data, reload } = useList<ServerGroup>('/server-group')
  const { data: servers } = useList<ServerRow>('/server')
  const [edit, setEdit] = useState<ServerGroup | 'new' | null>(null)
  const { run } = useAction()
  const confirmDelete = useConfirmDelete()
  const nameOf = (id: number) => servers?.find((s) => s.id === id)?.name || `#${id}`

  const del = async (g: ServerGroup) => {
    if (!(await confirmDelete(g.group.name))) return
    if (await run(() => api('/batch-delete/server-group', { method: 'POST', body: [g.group.id] }), '已删除')) reload()
  }

  return (
    <>
      <PageHead title="分组" desc="前台可按分组筛选服务器。">
        <button className="btn primary" onClick={() => setEdit('new')}><IPlus />新建分组</button>
      </PageHead>
      <div className="glass table-wrap">
        <table className="t stack">
          <thead><tr><th>名称</th><th>数量</th><th>服务器</th><th /></tr></thead>
          <tbody>
            {data === null && <tr><td colSpan={4} className="empty">加载中…</td></tr>}
            {data?.length === 0 && <tr><td colSpan={4} className="empty">还没有分组</td></tr>}
            {data?.map((g) => (
              <tr key={g.group.id}>
                <td className="first"><b>{g.group.name}</b></td>
                <td data-l="数量" className="tnum muted">{(g.servers || []).length} 台</td>
                <td data-l="服务器">
                  <div className="wrap">
                    {(g.servers || []).length === 0
                      ? <span className="faint">未包含服务器</span>
                      : (g.servers || []).map((id) => <span key={id} className="tag plain">{nameOf(id)}</span>)}
                  </div>
                </td>
                <td><div className="act">
                  <button className="btn sm" onClick={() => setEdit(g)}><IEdit />编辑</button>
                  <button className="btn sm ghost danger" onClick={() => del(g)} aria-label="删除"><ITrash /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <GroupModal g={edit === 'new' ? null : edit} servers={servers || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
    </>
  )
}

function GroupModal({ g, servers, onClose, onSaved }: { g: ServerGroup | null; servers: ServerRow[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(g?.group.name || '')
  const [sel, setSel] = useState<Record<string, boolean>>(Object.fromEntries((g?.servers || []).map((id) => [id, true])))
  const { busy, run } = useAction()
  const save = async () => {
    const body = { name, servers: Object.keys(sel).map(Number) }
    const ok = await run(() => g ? api(`/server-group/${g.group.id}`, { method: 'PATCH', body }) : api('/server-group', { method: 'POST', body }), '已保存')
    if (ok) onSaved()
  }
  return (
    <Modal title={g ? '编辑分组' : '新建分组'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>取消</button>
      <button className="btn primary" disabled={busy || !name.trim()} onClick={save}>保存</button>
    </>}>
      <div className="form">
        <Field label="名称" full><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <div className="fld full"><span>包含的服务器</span><ServerPicker servers={servers} value={sel} onChange={setSel} /></div>
      </div>
    </Modal>
  )
}
