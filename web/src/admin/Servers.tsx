import { useEffect, useMemo, useState } from 'react'
import { ICopy, IEdit, IExternal, IEye, IEyeOff, IPlus, IRefresh, ISearch, ITrash } from '../components/icons'
import { Dropdown, Field, Modal, Seg, copyText, useToast } from '../components/ui'
import { expiryText } from '../components/ServerCard'
import { api, isOnline, subscribeServers, type AlertRule, type ServerGroup, type ServerRow } from '../lib/api'
import { parseBilling, parseNote, priceText, type BillingData, type PlanData } from '../lib/billing'
import { clsx, fmtAgo, toneVar } from '../lib/format'
import { PageHead, fromDateInput, toDateInput, useAction, useAdmin, useConfirm, useConfirmDelete, useList } from './common'

type StatusFilter = 'all' | 'online' | 'offline' | 'expiring'
type SortKey = 'default' | 'name' | 'status' | 'expiry'

export default function Servers() {
  const { data, loading, reload } = useList<ServerRow>('/server')
  const { data: groups, reload: reloadGroups } = useList<ServerGroup>('/server-group')
  const [liveActive, setLiveActive] = useState<Record<number, string>>({})
  const [now, setNow] = useState(() => Date.now())
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [groupFilter, setGroupFilter] = useState<number>(0)
  const [sortBy, setSortBy] = useState<SortKey>('default')
  const [sortAsc, setSortAsc] = useState(false)
  const [selected, setSelected] = useState<Record<number, boolean>>({})
  const [edit, setEdit] = useState<ServerRow | null>(null)
  const [install, setInstall] = useState(false)
  const [batchGroupOpen, setBatchGroupOpen] = useState(false)
  const { busy, run } = useAction()
  const confirm = useConfirm()
  const confirmDelete = useConfirmDelete()
  const toast = useToast()

  // 订阅实时状态，保持后台在线圆点同步更新
  useEffect(() => {
    const off = subscribeServers((frame) => {
      if (frame.now) setNow(frame.now)
      if (frame.servers?.length) {
        setLiveActive((prev) => {
          const next = { ...prev }
          let changed = false
          for (const s of frame.servers!) {
            if (s.last_active && next[s.id] !== s.last_active) {
              next[s.id] = s.last_active
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
    })
    const t = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => { off(); clearInterval(t) }
  }, [])

  // 列表刷新后清理已不存在的选中项
  useEffect(() => {
    if (!data) return
    const valid = new Set(data.map((s) => s.id))
    setSelected((prev) => {
      const next: Record<number, boolean> = {}
      let diff = false
      for (const k of Object.keys(prev)) {
        const id = Number(k)
        if (prev[id] && valid.has(id)) next[id] = true
        else if (prev[id]) diff = true
      }
      return diff ? next : prev
    })
  }, [data])

  const lastActiveOf = (s: ServerRow) => liveActive[s.id] || s.last_active

  const serverGroupMap = useMemo(() => {
    const m = new Map<number, string[]>()
    for (const g of groups || []) {
      for (const sid of g.servers || []) {
        const arr = m.get(sid) || []
        arr.push(g.group.name)
        m.set(sid, arr)
      }
    }
    return m
  }, [groups])

  const rows = useMemo(() => {
    const list = (data || []).map((s) => {
      const b = parseBilling(parseNote(s.public_note))
      const la = lastActiveOf(s)
      const online = isOnline(la, now)
      const expiring = !b.permanent && b.daysLeft != null && b.daysLeft <= 30
      return { s, b, la, online, expiring }
    })

    const keyword = q.trim().toLowerCase()
    const groupServerSet = groupFilter
      ? new Set(groups?.find((g) => g.group.id === groupFilter)?.servers || [])
      : null

    const filtered = list.filter(({ s, online, expiring }) => {
      if (statusFilter === 'online' && !online) return false
      if (statusFilter === 'offline' && online) return false
      if (statusFilter === 'expiring' && !expiring) return false
      if (groupServerSet && !groupServerSet.has(s.id)) return false
      if (!keyword) return true
      return (
        s.name.toLowerCase().includes(keyword) ||
        String(s.id).includes(keyword) ||
        (s.note || '').toLowerCase().includes(keyword) ||
        (s.geoip?.ip?.ipv4_addr || '').toLowerCase().includes(keyword) ||
        (s.geoip?.ip?.ipv6_addr || '').toLowerCase().includes(keyword) ||
        (s.geoip?.country_code || '').toLowerCase().includes(keyword)
      )
    })

    const dir = sortAsc ? 1 : -1
    filtered.sort((a, b) => {
      if (sortBy === 'name') return a.s.name.localeCompare(b.s.name) * dir
      if (sortBy === 'status') return (Number(a.online) - Number(b.online)) * dir || a.s.id - b.s.id
      if (sortBy === 'expiry') {
        const da = a.b.permanent ? 1e9 : (a.b.daysLeft ?? 1e8)
        const db = b.b.permanent ? 1e9 : (b.b.daysLeft ?? 1e8)
        return (da - db) * dir
      }
      // 默认排序：display_index 降序，同序按 ID 升序
      return (b.s.display_index - a.s.display_index) || (a.s.id - b.s.id)
    })

    return filtered
  }, [data, groups, liveActive, now, q, statusFilter, groupFilter, sortBy, sortAsc])

  const counts = useMemo(() => {
    const all = data || []
    let on = 0, off = 0, exp = 0
    for (const s of all) {
      if (isOnline(lastActiveOf(s), now)) on++
      else off++
      const b = parseBilling(parseNote(s.public_note))
      if (!b.permanent && b.daysLeft != null && b.daysLeft <= 30) exp++
    }
    return { all: all.length, on, off, exp }
  }, [data, liveActive, now])

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[Number(k)]).map(Number), [selected])
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected[r.s.id])

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const next = { ...selected }
      rows.forEach((r) => { delete next[r.s.id] })
      setSelected(next)
    } else {
      const next = { ...selected }
      rows.forEach((r) => { next[r.s.id] = true })
      setSelected(next)
    }
  }

  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortAsc(!sortAsc)
    else { setSortBy(k); setSortAsc(k === 'name' || k === 'expiry') }
  }

  const patchServer = (s: ServerRow, override: Partial<{ hide_for_guest: boolean }>) =>
    api(`/server/${s.id}`, {
      method: 'PATCH',
      body: {
        name: s.name,
        note: s.note || '',
        public_note: s.public_note || '',
        display_index: s.display_index || 0,
        hide_for_guest: override.hide_for_guest ?? !!s.hide_for_guest,
        enable_ddns: !!s.enable_ddns,
        ddns_profiles: s.ddns_profiles || [],
        override_ddns_domains: s.override_ddns_domains || {},
      },
    })

  const toggleHide = async (s: ServerRow) => {
    const nextHide = !s.hide_for_guest
    if (await run(() => patchServer(s, { hide_for_guest: nextHide }), nextHide ? `已对访客隐藏 ${s.name}` : `已对访客显示 ${s.name}`)) {
      reload()
    }
  }

  const del = async (s: ServerRow) => {
    if (!(await confirmDelete(s.name))) return
    if (await run(() => api('/batch-delete/server', { method: 'POST', body: [s.id] }), '已删除')) reload()
  }

  const recheck = (s: ServerRow) =>
    run(() => api(`/probe/quality/${s.id}/refresh`, { method: 'POST' }), `已通知 ${s.name} 重新检测，几分钟内更新`)

  const batchRecheck = async () => {
    if (!selectedIds.length) return
    const ok = await run(async () => {
      await Promise.all(selectedIds.map((id) => api(`/probe/quality/${id}/refresh`, { method: 'POST' })))
    }, `已通知 ${selectedIds.length} 台服务器重新检测质量`)
    if (ok) setSelected({})
  }

  const batchSetHide = async (hide: boolean) => {
    if (!selectedIds.length || !data) return
    const targets = data.filter((s) => selectedIds.includes(s.id))
    const ok = await run(async () => {
      await Promise.all(targets.map((s) => patchServer(s, { hide_for_guest: hide })))
    }, hide ? `已隐藏 ${targets.length} 台服务器` : `已显示 ${targets.length} 台服务器`)
    if (ok) { setSelected({}); reload() }
  }

  const batchDelete = async () => {
    if (!selectedIds.length) return
    const ok = await confirm({
      title: '批量删除服务器',
      message: <>确定删除已选中的 <b>{selectedIds.length}</b> 台服务器吗？此操作不可撤销。</>,
      confirmText: `删除 ${selectedIds.length} 台`,
      danger: true,
    })
    if (!ok) return
    if (await run(() => api('/batch-delete/server', { method: 'POST', body: selectedIds }), `已删除 ${selectedIds.length} 台服务器`)) {
      setSelected({})
      reload()
    }
  }

  return (
    <>
      <PageHead title="服务器" desc="Agent 连接面板后自动出现在这里。支持搜索筛选、批量管理与账单套餐编辑。">
        <button className="btn" onClick={() => { reload(); toast('已刷新列表', 'info') }} disabled={loading}><IRefresh />刷新</button>
        <button className="btn primary" onClick={() => setInstall(true)}><IPlus />添加服务器</button>
      </PageHead>

      <div className="admin-bar">
        <div className="pill-input" style={{ width: 240 }}>
          <ISearch />
          <input className="input" placeholder="搜索名称 / IP / 备注…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Seg<StatusFilter>
          value={statusFilter}
          onChange={setStatusFilter}
          label="状态筛选"
          options={[
            { value: 'all', label: <>全部 <span className="n">{counts.all}</span></> },
            { value: 'online', label: <>在线 <span className="n">{counts.on}</span></> },
            { value: 'offline', label: <>离线 <span className="n">{counts.off}</span></> },
            { value: 'expiring', label: <>临期 <span className="n">{counts.exp}</span></> },
          ]}
        />
        {groups && groups.length > 0 && (
          <Dropdown<number>
            value={groupFilter}
            label="分组筛选"
            align="left"
            onChange={setGroupFilter}
            options={[
              { value: 0, label: '全部分组' },
              ...groups.map((g) => ({ value: g.group.id, label: g.group.name })),
            ]}
          />
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="batch-bar">
          <span style={{ fontSize: 13, fontWeight: 600 }}>已选 {selectedIds.length} 台</span>
          <span className="spacer" />
          <button className="btn sm" onClick={batchRecheck} disabled={busy}><IRefresh />批量重测</button>
          {groups && groups.length > 0 && (
            <button className="btn sm" onClick={() => setBatchGroupOpen(true)} disabled={busy}>加入分组</button>
          )}
          <button className="btn sm" onClick={() => batchSetHide(true)} disabled={busy}><IEyeOff />设为隐藏</button>
          <button className="btn sm" onClick={() => batchSetHide(false)} disabled={busy}><IEye />设为显示</button>
          <button className="btn sm danger" onClick={batchDelete} disabled={busy}><ITrash />批量删除</button>
          <button className="btn sm ghost" onClick={() => setSelected({})}>取消选择</button>
        </div>
      )}

      <div className="glass table-wrap">
        <table className="t stack">
          <thead>
            <tr>
              <th style={{ width: 38 }}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="全选" style={{ width: 15, height: 15, accentColor: 'var(--ok)', cursor: 'pointer' }} />
              </th>
              <th>
                <button type="button" className={clsx('th-sort', sortBy === 'name' && 'on')} onClick={() => toggleSort('name')}>
                  名称 {sortBy === 'name' ? (sortAsc ? '↑' : '↓') : ''}
                </button>
              </th>
              <th>
                <button type="button" className={clsx('th-sort', sortBy === 'status' && 'on')} onClick={() => toggleSort('status')}>
                  状态 {sortBy === 'status' ? (sortAsc ? '↑' : '↓') : ''}
                </button>
              </th>
              <th>IP</th>
              <th>价格</th>
              <th>
                <button type="button" className={clsx('th-sort', sortBy === 'expiry' && 'on')} onClick={() => toggleSort('expiry')}>
                  到期 {sortBy === 'expiry' ? (sortAsc ? '↑' : '↓') : ''}
                </button>
              </th>
              <th>Agent</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data === null && <tr><td colSpan={8} className="empty">加载中…</td></tr>}
            {data?.length === 0 && <tr><td colSpan={8} className="empty">还没有服务器，点右上角「添加服务器」获取安装命令</td></tr>}
            {data && data.length > 0 && rows.length === 0 && <tr><td colSpan={8} className="empty">没有符合筛选条件的服务器</td></tr>}
            {rows.map(({ s, b, la, online }) => {
              const exp = expiryText(b)
              const gnames = serverGroupMap.get(s.id) || []
              return (
                <tr key={s.id}>
                  <td style={{ width: 38 }}>
                    <input
                      type="checkbox"
                      checked={!!selected[s.id]}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [s.id]: e.target.checked }))}
                      aria-label={`选择 ${s.name}`}
                      style={{ width: 15, height: 15, accentColor: 'var(--ok)', cursor: 'pointer' }}
                    />
                  </td>
                  <td className="first" style={{ display: 'block' }}>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <a href={`/server/${s.id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }} title="在新标签页查看前台详情">
                        {s.name}
                      </a>
                      {s.geoip?.country_code && <span className="cc">{s.geoip.country_code.toUpperCase()}</span>}
                      {s.hide_for_guest && <span className="tag plain">隐藏</span>}
                      {gnames.map((gn) => <span key={gn} className="tag info">{gn}</span>)}
                    </div>
                    <div className="faint" style={{ fontSize: 12 }}>
                      #{s.id}{s.display_index ? ` · 排序 ${s.display_index}` : ''}{s.note ? ` · ${s.note}` : ''}
                    </div>
                  </td>
                  <td data-l="状态">
                    <span className="row" style={{ gap: 6 }}>
                      <span className={clsx('dot', online ? 'on' : 'off')} />
                      {online ? '在线' : <span className="muted">{fmtAgo(la)}</span>}
                    </span>
                  </td>
                  <td data-l="IP" className="mono muted" style={{ fontSize: 12 }}>
                    <span>
                      {s.geoip?.ip?.ipv4_addr || '—'}
                      {s.geoip?.ip?.ipv6_addr && <div>{s.geoip.ip.ipv6_addr}</div>}
                    </span>
                  </td>
                  <td data-l="价格">{priceText(b) || <span className="faint">未设置</span>}</td>
                  <td data-l="到期" style={{ color: exp && exp.tone !== 'neutral' ? toneVar(exp.tone) : 'var(--muted)' }}>
                    {exp?.text || <span className="faint">—</span>}
                  </td>
                  <td data-l="Agent" className="mono faint" style={{ fontSize: 12 }}>{s.host?.version || '—'}</td>
                  <td>
                    <div className="act">
                      <a className="btn sm ghost" href={`/server/${s.id}`} target="_blank" rel="noreferrer" title="查看前台详情" aria-label="查看前台详情">
                        <IExternal />
                      </a>
                      <button
                        className="btn sm ghost"
                        onClick={() => toggleHide(s)}
                        title={s.hide_for_guest ? '点击对访客显示' : '点击对访客隐藏'}
                        aria-label={s.hide_for_guest ? '设为显示' : '设为隐藏'}
                      >
                        {s.hide_for_guest ? <IEyeOff /> : <IEye />}
                      </button>
                      <button className="btn sm ghost" onClick={() => recheck(s)} title="重新检测 IP 与线路质量">重测</button>
                      <button className="btn sm" onClick={() => setEdit(s)}><IEdit />编辑</button>
                      <button className="btn sm ghost danger" onClick={() => del(s)} aria-label="删除"><ITrash /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {edit && <EditServer s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
      {install && <InstallModal onClose={() => setInstall(false)} />}
      {batchGroupOpen && groups && (
        <BatchGroupModal
          groups={groups}
          serverIds={selectedIds}
          onClose={() => setBatchGroupOpen(false)}
          onSaved={() => { setBatchGroupOpen(false); setSelected({}); reloadGroups() }}
        />
      )}
    </>
  )
}

function BatchGroupModal({ groups, serverIds, onClose, onSaved }: {
  groups: ServerGroup[]; serverIds: number[]; onClose: () => void; onSaved: () => void
}) {
  const [groupId, setGroupId] = useState(groups[0]?.group.id || 0)
  const { busy, run } = useAction()
  const save = async () => {
    const g = groups.find((x) => x.group.id === groupId)
    if (!g) return
    const merged = Array.from(new Set([...(g.servers || []), ...serverIds]))
    const ok = await run(() => api(`/server-group/${g.group.id}`, {
      method: 'PATCH',
      body: { name: g.group.name, servers: merged },
    }), `已将 ${serverIds.length} 台服务器加入「${g.group.name}」`)
    if (ok) onSaved()
  }
  return (
    <Modal title="批量加入分组" onClose={onClose} width={440} footer={<>
      <button className="btn" onClick={onClose}>取消</button>
      <button className="btn primary" disabled={busy || !groupId} onClick={save}>确定加入</button>
    </>}>
      <div className="form">
        <Field label={`将已选的 ${serverIds.length} 台服务器加入分组`} full>
          <select className="select" value={groupId} onChange={(e) => setGroupId(Number(e.target.value))}>
            {groups.map((g) => <option key={g.group.id} value={g.group.id}>{g.group.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  )
}

const CYCLES = [
  { v: '月', l: '月付' }, { v: '季', l: '季付' }, { v: '半年', l: '半年付' }, { v: '年', l: '年付' },
  { v: '2年', l: '两年付' }, { v: '3年', l: '三年付' }, { v: '一次性', l: '一次性' },
]

const CURRENCIES = ['$', '¥', '€', '£', 'CA$', 'HK$', 'NT$']
const BW_UNITS = ['Mbps', 'Gbps']
const BW_PRESETS = ['500Mbps', '1Gbps', '2.5Gbps', '10Gbps']
const TR_UNITS = ['GB', 'TB', '不限']
const TR_PRESETS = ['500GB', '1TB', '2TB', '4TB', '不限']

function splitCurrency(raw?: string): { cur: string; num: string } {
  const s = (raw || '').trim()
  if (!s) return { cur: '$', num: '' }
  for (const c of [...CURRENCIES].sort((a, b) => b.length - a.length)) {
    if (s.startsWith(c)) return { cur: c, num: s.slice(c.length).trim() }
  }
  const m = s.match(/^([^\d.-]*)(.*)$/)
  return { cur: m?.[1]?.trim() || '$', num: (m?.[2] || s).trim() }
}

function splitUnit(raw: string | undefined, units: string[], fallbackUnit: string): { num: string; unit: string } {
  const s = (raw || '').trim()
  if (!s) return { num: '', unit: fallbackUnit }
  if (s === '不限' || /unlimited/i.test(s)) return { num: '', unit: '不限' }
  const m = s.match(/^([\d.]+)\s*(.*)$/)
  if (!m) return { num: s, unit: fallbackUnit }
  const uRaw = m[2].trim().toLowerCase()
  const matched = units.find((u) => u.toLowerCase() === uRaw || (u === 'TB' && uRaw === 't') || (u === 'GB' && uRaw === 'g') || (u === 'Gbps' && uRaw === 'g') || (u === 'Mbps' && uRaw === 'm'))
  return { num: m[1], unit: matched || fallbackUnit }
}

function addMonthsToDate(baseDate: string, months: number): string {
  const d = baseDate ? new Date(`${baseDate}T00:00:00`) : new Date()
  if (isNaN(d.getTime())) return ''
  d.setMonth(d.getMonth() + months)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 根据「每月几号重置」计算最近一个已开始周期的起始日期（本地 00:00 RFC3339） */
function cycleStartFromResetDay(day: number): string {
  const now = new Date()
  let y = now.getFullYear()
  let m = now.getMonth()
  const maxDayInCur = new Date(y, m + 1, 0).getDate()
  if (now.getDate() < Math.min(day, maxDayInCur)) {
    m -= 1
    if (m < 0) { m = 11; y -= 1 }
  }
  const clamped = Math.min(day, new Date(y, m + 1, 0).getDate())
  const p = (n: number) => String(n).padStart(2, '0')
  return fromDateInput(`${y}-${p(m + 1)}-${p(clamped)}`)
}

function trafficBytes(numStr: string, unit: string): number {
  const n = Number(numStr)
  if (!Number.isFinite(n) || n <= 0) return 0
  if (unit === 'TB') return Math.round(n * 1024 ** 4)
  if (unit === 'GB') return Math.round(n * 1024 ** 3)
  return 0
}

function findServerCycleRule(rules: AlertRule[], serverId: number): AlertRule | undefined {
  return rules.find((a) => {
    const r = a.rules?.[0]
    if (!r || !r.type?.endsWith('_cycle') || r.cover !== 1) return false
    const keys = Object.keys(r.ignore || {}).filter((k) => r.ignore?.[k])
    return keys.length === 1 && Number(keys[0]) === serverId
  })
}

function EditServer({ s, onClose, onSaved }: { s: ServerRow; onClose: () => void; onSaved: () => void }) {
  const note = useMemo(() => parseNote(s.public_note), [s.public_note])
  const rawIsJson = !s.public_note || s.public_note.trim().startsWith('{')
  const [name, setName] = useState(s.name)
  const [displayIndex, setDisplayIndex] = useState(s.display_index || 0)
  const [hide, setHide] = useState(!!s.hide_for_guest)
  const [privNote, setPrivNote] = useState(s.note || '')
  const [bill, setBill] = useState<BillingData>({ autoRenewal: '0', cycle: '月', ...note.billingDataMod })
  const [plan, setPlan] = useState<PlanData>({ trafficType: '2', ...note.planDataMod })
  const [permanent, setPermanent] = useState(!!note.billingDataMod?.endDate?.startsWith('0000'))
  const [advanced, setAdvanced] = useState(!rawIsJson)
  const [raw, setRaw] = useState(s.public_note || '')
  const [jsonErr, setJsonErr] = useState('')
  const { busy, run } = useAction()

  const initPrice = splitCurrency(bill.amount)
  const [priceCur, setPriceCur] = useState(initPrice.cur)
  const [priceNum, setPriceNum] = useState(initPrice.num)

  const initBw = splitUnit(plan.bandwidth, BW_UNITS, 'Gbps')
  const [bwNum, setBwNum] = useState(initBw.num)
  const [bwUnit, setBwUnit] = useState(initBw.unit)

  const initTr = splitUnit(plan.trafficVol, TR_UNITS, 'TB')
  const [trNum, setTrNum] = useState(initTr.num)
  const [trUnit, setTrUnit] = useState(initTr.unit)

  // 流量重置日（0 表示不启用周期统计，1~31 表示每月几号重置），与该服务器的周期流量告警规则自动同步
  const [resetDay, setResetDay] = useState<number>(0)
  const [cycleRule, setCycleRule] = useState<AlertRule | null>(null)

  useEffect(() => {
    api<AlertRule[]>('/alert-rule')
      .then((list) => {
        const hit = findServerCycleRule(list || [], s.id)
        if (hit) {
          setCycleRule(hit)
          const cs = hit.rules[0]?.cycle_start
          if (cs && hit.enable) {
            const d = new Date(cs)
            if (!isNaN(d.getTime())) setResetDay(d.getDate())
          }
        }
      })
      .catch(() => {})
  }, [s.id])

  const syncPrice = (cur: string, num: string) => {
    setPriceCur(cur)
    setPriceNum(num)
    setBill((prev) => ({ ...prev, amount: num.trim() ? `${cur}${num.trim()}` : '' }))
  }

  const syncBw = (num: string, unit: string) => {
    setBwNum(num)
    setBwUnit(unit)
    setPlan((prev) => ({ ...prev, bandwidth: num.trim() ? `${num.trim()}${unit}` : '' }))
  }

  const syncTr = (num: string, unit: string) => {
    setTrNum(num)
    setTrUnit(unit)
    setPlan((prev) => ({ ...prev, trafficVol: unit === '不限' ? '不限' : num.trim() ? `${num.trim()}${unit}` : '' }))
  }

  const composeNote = () => {
    if (advanced) return raw
    const b: BillingData = { ...bill }
    if (permanent) b.endDate = '0000-00-00T23:59:59+08:00'
    const hasBill = !!(b.amount || b.endDate)
    const hasPlan = Object.values(plan).some((v) => v && v !== '0' && v !== '2')
    const out: Record<string, unknown> = { ...note }
    if (hasBill) out.billingDataMod = b; else delete out.billingDataMod
    if (hasPlan || hasBill) out.planDataMod = plan; else delete out.planDataMod
    return Object.keys(out).length ? JSON.stringify(out) : ''
  }

  const save = async () => {
    const public_note = composeNote()
    if (advanced && public_note.trim().startsWith('{')) {
      try { JSON.parse(public_note); setJsonErr('') } catch {
        setJsonErr('公开备注不是合法的 JSON 格式，请检查括号与引号')
        return
      }
    }
    const ok = await run(async () => {
      await api(`/server/${s.id}`, {
        method: 'PATCH',
        body: {
          name, note: privNote, public_note, display_index: Number(displayIndex) || 0, hide_for_guest: hide,
          enable_ddns: !!s.enable_ddns, ddns_profiles: s.ddns_profiles || [], override_ddns_domains: s.override_ddns_domains || {},
        },
      })
      // 自动同步该服务器的周期流量规则
      if (!advanced) {
        const maxBytes = trafficBytes(trNum, trUnit)
        if (resetDay > 0 && maxBytes > 0 && trUnit !== '不限') {
          const ruleType = plan.trafficType === '1' ? 'transfer_out_cycle' : 'transfer_all_cycle'
          const ruleBody = {
            name: `周期流量 · ${name}`,
            enable: true,
            trigger_mode: cycleRule?.trigger_mode || 1,
            notification_group_id: cycleRule?.notification_group_id || 0,
            fail_trigger_tasks: cycleRule?.fail_trigger_tasks || [],
            recover_trigger_tasks: cycleRule?.recover_trigger_tasks || [],
            rules: [{
              type: ruleType,
              max: maxBytes,
              cycle_start: cycleStartFromResetDay(resetDay),
              cycle_interval: 1,
              cycle_unit: 'month',
              cover: 1,
              ignore: { [s.id]: true },
            }],
          }
          if (cycleRule) await api(`/alert-rule/${cycleRule.id}`, { method: 'PATCH', body: ruleBody })
          else await api('/alert-rule', { method: 'POST', body: ruleBody })
        } else if (cycleRule && resetDay === 0) {
          await api('/batch-delete/alert-rule', { method: 'POST', body: [cycleRule.id] })
        }
      }
    }, '已保存')
    if (ok) onSaved()
  }

  const preview = parseBilling(parseNote(advanced ? raw : composeNote()))

  return (
    <Modal title={`编辑 · ${s.name}`} onClose={onClose} width={720} footer={<>
      <button className="btn" onClick={onClose}>取消</button>
      <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>保存</button>
    </>}>
      <div className="form">
        <Field label="名称"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="排序" hint="数字越大越靠前"><input className="input" type="number" value={displayIndex} onChange={(e) => setDisplayIndex(Number(e.target.value))} /></Field>
        <Field label="私有备注" hint="只有后台可见" full><input className="input" value={privNote} onChange={(e) => setPrivNote(e.target.value)} /></Field>
        <label className="check full"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />对访客隐藏（前台不显示）</label>

        <div className="form-sec" style={{ display: 'flex', alignItems: 'center' }}>
          账单与套餐（前台卡片与 TG 机器人读取）
          <span className="spacer" />
          <label className="check" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
            <input type="checkbox" checked={advanced} onChange={(e) => { if (e.target.checked) setRaw(composeNote()); setJsonErr(''); setAdvanced(e.target.checked) }} />直接编辑 JSON
          </label>
        </div>

        {advanced ? (
          <Field label="公开备注（原始 JSON）" full hint="与官方前端格式兼容：billingDataMod / planDataMod">
            <textarea className="textarea" rows={8} value={raw} onChange={(e) => { setRaw(e.target.value); setJsonErr('') }} />
            {jsonErr && <div className="note bad" style={{ marginTop: 8 }}>{jsonErr}</div>}
          </Field>
        ) : (
          <>
            <div className="fld">
              <span>价格</span>
              <div className="input-group">
                <select className="select unit-sel" value={priceCur} onChange={(e) => syncPrice(e.target.value, priceNum)} aria-label="币种">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input className="input" type="number" step="any" min={0} placeholder="10" value={priceNum} onChange={(e) => syncPrice(priceCur, e.target.value)} />
              </div>
            </div>
            <Field label="付款周期">
              <select className="select" value={bill.cycle} onChange={(e) => setBill({ ...bill, cycle: e.target.value })}>
                {CYCLES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </Field>
            <Field label="开始日期"><input className="input" type="date" value={toDateInput(bill.startDate)} onChange={(e) => setBill({ ...bill, startDate: fromDateInput(e.target.value) })} /></Field>
            <div className="fld">
              <span>到期日期</span>
              <input className="input" type="date" disabled={permanent} value={permanent ? '' : toDateInput(bill.endDate)} onChange={(e) => setBill({ ...bill, endDate: fromDateInput(e.target.value) })} />
              {!permanent && (
                <div className="preset-row">
                  {[{ l: '+1月', m: 1 }, { l: '+1季', m: 3 }, { l: '+半年', m: 6 }, { l: '+1年', m: 12 }].map((x) => (
                    <button key={x.l} type="button" className="preset-chip" onClick={() => setBill({ ...bill, endDate: fromDateInput(addMonthsToDate(toDateInput(bill.startDate), x.m)) })}>{x.l}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="full" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <label className="check"><input type="checkbox" checked={bill.autoRenewal === '1'} onChange={(e) => setBill({ ...bill, autoRenewal: e.target.checked ? '1' : '0' })} />自动续费（过期后按周期顺延）</label>
              <label className="check"><input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />永久（不到期）</label>
            </div>
            <div className="fld">
              <span>带宽</span>
              <div className="input-group">
                <input className="input" type="number" step="any" min={0} placeholder="1" value={bwNum} onChange={(e) => syncBw(e.target.value, bwUnit)} />
                <select className="select unit-sel" value={bwUnit} onChange={(e) => syncBw(bwNum, e.target.value)} aria-label="带宽单位">
                  {BW_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="preset-row">
                {BW_PRESETS.map((p) => {
                  const sp = splitUnit(p, BW_UNITS, 'Gbps')
                  return <button key={p} type="button" className={clsx('preset-chip', plan.bandwidth === p && 'on')} onClick={() => syncBw(sp.num, sp.unit)}>{p}</button>
                })}
              </div>
            </div>
            <div className="fld">
              <span>月流量</span>
              <div className="input-group">
                <input className="input" type="number" step="any" min={0} disabled={trUnit === '不限'} placeholder={trUnit === '不限' ? '不限流量' : '1'} value={trUnit === '不限' ? '' : trNum} onChange={(e) => syncTr(e.target.value, trUnit)} />
                <select className="select unit-sel" value={trUnit} onChange={(e) => syncTr(trNum, e.target.value)} aria-label="流量单位">
                  {TR_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="preset-row">
                {TR_PRESETS.map((p) => {
                  const sp = splitUnit(p, TR_UNITS, 'TB')
                  return <button key={p} type="button" className={clsx('preset-chip', plan.trafficVol === p && 'on')} onClick={() => syncTr(sp.num, sp.unit)}>{p}</button>
                })}
              </div>
            </div>
            <Field label="流量计费">
              <select className="select" value={plan.trafficType || '2'} onChange={(e) => setPlan({ ...plan, trafficType: e.target.value })}>
                <option value="2">双向计费</option>
                <option value="1">单向计费（出站）</option>
              </select>
            </Field>
            <Field label="流量重置日" hint="设置后前台按该重置日统计当月周期流量，不再统计开机累计">
              <select className="select" value={resetDay} onChange={(e) => setResetDay(Number(e.target.value))} disabled={trUnit === '不限'}>
                <option value={0}>不启用（显示开机累计）</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>每月 {d} 日重置</option>
                ))}
              </select>
            </Field>
            <div className="fld full">
              <span>IP</span>
              <div style={{ display: 'flex', gap: 16, height: 36, alignItems: 'center' }}>
                <label className="check"><input type="checkbox" checked={plan.IPv4 === '1'} onChange={(e) => setPlan({ ...plan, IPv4: e.target.checked ? '1' : '0' })} />IPv4</label>
                <label className="check"><input type="checkbox" checked={plan.IPv6 === '1'} onChange={(e) => setPlan({ ...plan, IPv6: e.target.checked ? '1' : '0' })} />IPv6</label>
              </div>
            </div>
          </>
        )}
        <div className="full muted" style={{ fontSize: 12.5 }}>
          预览：{priceText(preview) || '未设置价格'} · {preview.permanent ? '永久' : preview.daysLeft != null ? `剩余 ${preview.daysLeft} 天` : '未设置到期'}{preview.remainingValue ? ` · 剩余价值 ${preview.remainingValue}` : ''}
        </div>
      </div>
    </Modal>
  )
}

function InstallModal({ onClose }: { onClose: () => void }) {
  const { profile, setting } = useAdmin()
  const toast = useToast()
  const host = (setting?.config.install_host as string) || ''
  const [server, setServer] = useState(host || `${location.hostname}:${location.port || (location.protocol === 'https:' ? '443' : '80')}`)
  // 注意：Go 后端对 false 字段会 omitempty 省略，所以已配置 install_host 时应以 !!setting.config.tls 为准，不能回退到 location.protocol
  const [tls, setTls] = useState(host ? !!setting?.config.tls : location.protocol === 'https:')
  const [uuid, setUuid] = useState('')
  const [mode, setMode] = useState<'root' | 'sudo'>('root')
  const panel = location.origin
  const secret = profile.agent_secret || ''
  const sh = mode === 'sudo' ? 'sudo sh' : 'sh'
  const cmd = `curl -fsSL ${panel}/probe/agent/install.sh | ${sh} -s -- --panel ${panel} --server ${server}${tls ? ' --tls' : ''}${uuid.trim() ? ` --uuid ${uuid.trim()}` : ''} --secret ${secret}`
  const uninstall = `curl -fsSL ${panel}/probe/agent/install.sh | ${sh} -s -- --uninstall`
  const logCmd = `journalctl -u nezha-ro-agent -n 50 --no-pager`

  return (
    <Modal title="添加服务器" onClose={onClose} width={720}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="muted" style={{ margin: 0 }}>在要监控的 VPS 上执行下面的命令。Agent 从本面板下载（只读版本，不含远程执行），装好后几秒内就会出现在列表里。</p>
        <div className="form">
          <Field label="Agent 连接地址" hint="域名或 IP:端口。走 HTTPS 反代时填 域名:443 并勾选 TLS">
            <input className="input" value={server} onChange={(e) => setServer(e.target.value)} />
          </Field>
          <div className="fld">
            <span>传输加密</span>
            <label className="check" style={{ height: 36 }}><input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />使用 TLS</label>
          </div>
          <Field label="自定义 UUID（可选）" hint="留空自动生成；重装系统想复用旧服务器记录时可填原 UUID" full>
            <input className="input mono" placeholder="留空自动生成" value={uuid} onChange={(e) => setUuid(e.target.value)} />
          </Field>
        </div>
        {!host && <div className="note warn">还没有在「系统设置」里填写 Agent 连接地址，当前用的是浏览器地址，部署到服务器后建议去设置一下。</div>}
        {!secret && <div className="note bad">没取到 Agent 密钥，请重新登录后再试。</div>}
        <div className="row">
          <Seg<'root' | 'sudo'>
            value={mode}
            onChange={setMode}
            label="运行方式"
            options={[
              { value: 'root', label: 'root 直接运行（无 sudo）' },
              { value: 'sudo', label: '普通用户（带 sudo）' },
            ]}
          />
        </div>
        <div className="code">{cmd}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => copyText(cmd).then(() => toast('已复制安装命令', 'ok'))}><ICopy />复制安装命令</button>
          <button className="btn" onClick={() => copyText(uninstall).then(() => toast('已复制卸载命令', 'ok'))}>复制卸载命令</button>
          <button className="btn ghost" onClick={() => copyText(logCmd).then(() => toast('已复制日志查看命令', 'ok'))}>查看日志命令</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>命令里包含 Agent 密钥，请勿公开分享。不要使用官方哪吒的安装脚本——那个会装上带远程执行能力的官方 Agent。</p>
      </div>
    </Modal>
  )
}
