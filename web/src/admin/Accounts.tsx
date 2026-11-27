import { useMemo, useState } from 'react'
import { ICopy, IEdit, IExternal, IPlus, ISearch, ITrash } from '../components/icons'
import { Field, Modal, copyText, useToast } from '../components/ui'
import { api, type ServerRow } from '../lib/api'
import { clsx, fmtAgo } from '../lib/format'
import { newId } from '../lib/topology'
import { PageHead, useAction, useConfirmDelete, useList } from './common'

interface AccountRecord {
  id: string
  server_id?: number
  name?: string
  provider?: string
  account?: string
  email?: string
  panel_url?: string
  payment?: string
  order_id?: string
  note?: string
  updated_at?: string
}

const PAYMENTS = ['PayPal', '支付宝', '信用卡', 'USDT', '余额']

function CopyCell({ text }: { text?: string }) {
  const toast = useToast()
  if (!text) return <span className="faint">—</span>
  return (
    <span className="row" style={{ gap: 4 }}>
      <span className="mono" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={text}>{text}</span>
      <button className="btn xs ghost" aria-label="复制" title="复制" onClick={() => copyText(text).then(() => toast('已复制', 'ok'))}><ICopy /></button>
    </span>
  )
}

const safeUrl = (u?: string) => {
  if (!u) return ''
  const v = /^https?:\/\//i.test(u) ? u : `https://${u}`
  try { return new URL(v).protocol.startsWith('http') ? v : '' } catch { return '' }
}

export default function Accounts() {
  const { data, reload } = useList<AccountRecord>('/probe/accounts')
  const { data: servers } = useList<ServerRow>('/server')
  const [edit, setEdit] = useState<AccountRecord | null>(null)
  const [q, setQ] = useState('')
  const [provider, setProvider] = useState('')
  const { run } = useAction()
  const confirmDelete = useConfirmDelete()

  const serverName = (r: AccountRecord) => (r.server_id ? servers?.find((s) => s.id === r.server_id)?.name || `#${r.server_id}（已删除）` : r.name || '—')
  const providers = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of data || []) if (r.provider) m.set(r.provider, (m.get(r.provider) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [data])
  const missing = useMemo(() => (servers || []).filter((s) => !(data || []).some((r) => r.server_id === s.id)), [servers, data])

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return (data || []).filter((r) => {
      if (provider && r.provider !== provider) return false
      if (!kw) return true
      return [serverName(r), r.provider, r.account, r.email, r.order_id, r.payment, r.note].join(' ').toLowerCase().includes(kw)
    })
  }, [data, q, provider, servers])

  const saveAll = (list: AccountRecord[], msg: string) => run(() => api('/probe/accounts', { method: 'PUT', body: list }), msg)

  const onSave = async (r: AccountRecord) => {
    const list = data || []
    const next = list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r]
    if (await saveAll(next, '已保存')) { setEdit(null); reload() }
  }
  const del = async (r: AccountRecord) => {
    if (!(await confirmDelete(serverName(r)))) return
    if (await saveAll((data || []).filter((x) => x.id !== r.id), '已删除')) reload()
  }

  return (
    <>
      <PageHead title="账号记录" desc="记录每台 VPS 属于哪个商家、哪个账号。仅管理员可见，不会出现在前台或公开接口中。">
        <button className="btn primary" onClick={() => setEdit({ id: newId('a') })}><IPlus />添加记录</button>
      </PageHead>

      <div className="note" style={{ marginBottom: 14 }}>
        数据保存在面板 <span className="mono">data/probe-accounts.json</span>，并会包含在备份文件里。建议只记录账号 / 邮箱等索引信息，<b>不要在这里保存密码</b>，密码请交给密码管理器。
      </div>

      <div className="toolbar" style={{ marginTop: 0 }}>
        <div className="wrap">
          <button className={clsx('tag', !provider ? 'info' : 'plain')} style={{ cursor: 'pointer' }} onClick={() => setProvider('')}>全部 {data?.length ?? 0}</button>
          {providers.map(([p, n]) => (
            <button key={p} className={clsx('tag', provider === p ? 'info' : 'plain')} style={{ cursor: 'pointer' }} onClick={() => setProvider(provider === p ? '' : p)}>{p} {n}</button>
          ))}
        </div>
        <span className="spacer" />
        <label className="pill-input">
          <ISearch />
          <input className="input" placeholder="搜索服务器、账号、邮箱、订单号" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索" />
        </label>
      </div>

      <div className="glass table-wrap">
        <table className="t stack">
          <thead><tr><th>服务器</th><th>商家</th><th>账号</th><th>邮箱</th><th>付款</th><th>订单号</th><th>备注</th><th>更新</th><th /></tr></thead>
          <tbody>
            {data === null && <tr><td colSpan={9} className="empty">加载中…</td></tr>}
            {data?.length === 0 && <tr><td colSpan={9} className="empty">还没有记录，点击右上角「添加记录」</td></tr>}
            {data && data.length > 0 && shown.length === 0 && <tr><td colSpan={9} className="empty">没有匹配的记录</td></tr>}
            {shown.map((r) => {
              const url = safeUrl(r.panel_url)
              return (
                <tr key={r.id}>
                  <td className="first"><b>{serverName(r)}</b></td>
                  <td data-l="商家">
                    {r.provider ? (url
                      ? <a className="row info" style={{ gap: 4 }} href={url} target="_blank" rel="noreferrer noopener">{r.provider}<IExternal width={12} height={12} /></a>
                      : r.provider) : <span className="faint">—</span>}
                  </td>
                  <td data-l="账号"><CopyCell text={r.account} /></td>
                  <td data-l="邮箱"><CopyCell text={r.email} /></td>
                  <td data-l="付款">{r.payment || <span className="faint">—</span>}</td>
                  <td data-l="订单号"><CopyCell text={r.order_id} /></td>
                  <td data-l="备注"><span className="muted" style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }} title={r.note}>{r.note || <span className="faint">—</span>}</span></td>
                  <td data-l="更新" className="muted">{r.updated_at ? fmtAgo(r.updated_at) : '—'}</td>
                  <td><div className="act">
                    <button className="btn sm" onClick={() => setEdit(r)}><IEdit />编辑</button>
                    <button className="btn sm ghost danger" onClick={() => del(r)} aria-label="删除"><ITrash /></button>
                  </div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {missing.length > 0 && data && (
        <div className="note info" style={{ marginTop: 14 }}>
          还有 {missing.length} 台服务器没有记录：
          <span className="wrap" style={{ display: 'inline-flex', marginLeft: 6, verticalAlign: 'middle' }}>
            {missing.slice(0, 12).map((s) => (
              <button key={s.id} className="tag plain" style={{ cursor: 'pointer' }} onClick={() => setEdit({ id: newId('a'), server_id: s.id })}><IPlus width={11} height={11} />{s.name}</button>
            ))}
            {missing.length > 12 && <span className="faint">…</span>}
          </span>
        </div>
      )}

      {edit && <RecordModal r={edit} servers={servers || []} providers={providers.map(([p]) => p)} onClose={() => setEdit(null)} onSave={onSave} />}
    </>
  )
}

function RecordModal({ r, servers, providers, onClose, onSave }: {
  r: AccountRecord
  servers: ServerRow[]
  providers: string[]
  onClose: () => void
  onSave: (r: AccountRecord) => void
}) {
  const [f, setF] = useState<AccountRecord>(r)
  const set = (p: Partial<AccountRecord>) => setF((x) => ({ ...x, ...p }))
  const isNew = !r.provider && !r.account && !r.email && !r.name && !r.note
  const ok = !!f.server_id || !!f.name?.trim()
  return (
    <Modal title={isNew ? '添加账号记录' : '编辑账号记录'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>取消</button>
      <button className="btn primary" disabled={!ok} onClick={() => onSave(f)}>保存</button>
    </>}>
      <div className="form">
        <Field label="服务器">
          <select className="select" value={f.server_id || ''} onChange={(e) => set({ server_id: Number(e.target.value) || undefined })}>
            <option value="">不关联（自定义名称）</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="名称" hint={f.server_id ? '已关联服务器，可留空' : '未关联服务器时必填'}>
          <input className="input" value={f.name || ''} maxLength={60} placeholder="如 备用机 / 未装探针的机器" onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <div className="form-sec full">商家账号</div>
        <Field label="商家">
          <input className="input" list="acct-providers" value={f.provider || ''} maxLength={60} placeholder="如 RackNerd / 搬瓦工" onChange={(e) => set({ provider: e.target.value })} />
          <datalist id="acct-providers">{providers.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="商家后台地址">
          <input className="input" value={f.panel_url || ''} maxLength={300} placeholder="https://" onChange={(e) => set({ panel_url: e.target.value })} />
        </Field>
        <Field label="登录账号"><input className="input" value={f.account || ''} maxLength={120} autoComplete="off" onChange={(e) => set({ account: e.target.value })} /></Field>
        <Field label="注册邮箱"><input className="input" type="email" value={f.email || ''} maxLength={120} autoComplete="off" onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="付款方式">
          <input className="input" list="acct-payments" value={f.payment || ''} maxLength={60} onChange={(e) => set({ payment: e.target.value })} />
          <datalist id="acct-payments">{PAYMENTS.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="订单 / 服务编号"><input className="input" value={f.order_id || ''} maxLength={80} onChange={(e) => set({ order_id: e.target.value })} /></Field>
        <Field label="备注" full hint="不要填写密码">
          <textarea className="textarea" style={{ fontFamily: 'var(--sans)' }} value={f.note || ''} maxLength={1000} onChange={(e) => set({ note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}
