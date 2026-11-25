import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ServerCard, { RouteTags, expiryText } from '../components/ServerCard'
import Topbar from '../components/Topbar'
import { EmptyArt, Radar } from '../components/art'
import { ICalendar, IDown, IGrid, IList, ISearch, ITraffic, IUp } from '../components/icons'
import { Meter, Seg, Dropdown } from '../components/ui'
import { api, type QualityBrief, type ServerGroup } from '../lib/api'
import { priceText } from '../lib/billing'
import { bytesParts, clsx, fmtBytes, fmtSpeed, pct, toneVar } from '../lib/format'
import { cycleTrafficMap, useLiveServers, useProbeMeta, useQualitySummary, useServiceData, useSetting, useTitle, type LiveServer } from '../lib/hooks'

type SortKey = 'default' | 'name' | 'cpu' | 'expire' | 'traffic'
type Filter = 'all' | 'online' | 'offline' | `g${number}`

const SORT_KEYS: SortKey[] = ['default', 'name', 'cpu', 'expire', 'traffic']
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'default', label: '默认排序' },
  { value: 'name', label: '按名称' },
  { value: 'cpu', label: '按 CPU 占用' },
  { value: 'expire', label: '按到期时间' },
  { value: 'traffic', label: '按流量用量' },
]

function pref<T extends string>(k: string, d: T, allowed?: readonly T[]): T {
  try {
    const v = localStorage.getItem(k) as T | null
    if (!v) return d
    if (allowed && !allowed.includes(v)) return d
    return v
  } catch { return d }
}
function savePref(k: string, v: string) {
  try { localStorage.setItem(k, v) } catch { /* 隐私模式忽略 */ }
}

export default function Home() {
  const setting = useSetting()
  const probeMeta = useProbeMeta()
  const site = setting?.config.site_name || 'VPS 探针'
  useTitle(site)
  const { servers, viewers, connected, loaded } = useLiveServers()
  const { summary, byServer } = useServiceData()
  const briefs = useQualitySummary()
  const traffic = useMemo(() => cycleTrafficMap(summary.cycle_transfer_stats), [summary])
  const [groups, setGroups] = useState<ServerGroup[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>(() => pref('probe-sort', 'default', SORT_KEYS))
  const [view, setView] = useState<'grid' | 'list'>(() => pref('probe-view', 'grid', ['grid', 'list'] as const))

  useEffect(() => { api<ServerGroup[]>('/server-group').then((g) => setGroups(g || [])).catch(() => {}) }, [])

  // 从详情页返回时恢复滚动位置
  useEffect(() => {
    if (!loaded) return
    try {
      const y = Number(sessionStorage.getItem('probe-scroll') || 0)
      if (y) requestAnimationFrame(() => window.scrollTo(0, y))
    } catch { /* ignore */ }
    const save = () => { try { sessionStorage.setItem('probe-scroll', String(window.scrollY)) } catch { /* ignore */ } }
    return save
  }, [loaded])

  // 按 / 聚焦搜索框
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) { setQ(''); searchRef.current?.blur() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const online = servers.filter((s) => s.online)
  const up = online.reduce((a, s) => a + (s.state?.net_out_speed || 0), 0)
  const down = online.reduce((a, s) => a + (s.state?.net_in_speed || 0), 0)
  const totalOut = servers.reduce((a, s) => a + (s.state?.net_out_transfer || 0), 0)
  const totalIn = servers.reduce((a, s) => a + (s.state?.net_in_transfer || 0), 0)
  const expiring = servers.filter((s) => s.billing.daysLeft != null && s.billing.daysLeft <= 7)
  const offline = servers.length - online.length

  const shown = useMemo(() => {
    const gid = filter.startsWith('g') ? Number(filter.slice(1)) : 0
    const members = gid ? new Set(groups.find((g) => g.group.id === gid)?.servers || []) : null
    const kw = q.trim().toLowerCase()
    let list = servers.filter((s) => {
      if (members && !members.has(s.id)) return false
      if (filter === 'online' && !s.online) return false
      if (filter === 'offline' && s.online) return false
      if (!kw) return true
      const routes = Object.values(briefs[s.id]?.routes || {}).map((r) => r.label).join(' ')
      return `${s.name} ${s.note.planDataMod?.networkRoute || ''} ${routes}`.toLowerCase().includes(kw)
    })
    const ratio = (s: LiveServer) => { const t = traffic.get(s.id); return t && t.limit ? t.used / t.limit : 0 }
    const by: Record<SortKey, (a: LiveServer, b: LiveServer) => number> = {
      default: (a, b) => ((b.display_index || 0) - (a.display_index || 0)) || (a.id - b.id),
      name: (a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'),
      cpu: (a, b) => (b.state?.cpu || 0) - (a.state?.cpu || 0),
      expire: (a, b) => (a.billing.daysLeft ?? 1e9) - (b.billing.daysLeft ?? 1e9),
      traffic: (a, b) => ratio(b) - ratio(a),
    }
    list = [...list].sort(by[sort] || by.default)
    // 离线的始终沉底
    return [...list.filter((s) => s.online), ...list.filter((s) => !s.online)]
  }, [servers, groups, filter, q, sort, traffic, briefs])

  const filters: { value: Filter; label: React.ReactNode }[] = [
    { value: 'all', label: <>全部<span className="n">{servers.length}</span></> },
    { value: 'online', label: <>在线<span className="n">{online.length}</span></> },
    ...(offline ? [{ value: 'offline' as Filter, label: <>离线<span className="n">{offline}</span></> }] : []),
    ...groups.map((g) => ({ value: `g${g.group.id}` as Filter, label: <>{g.group.name}<span className="n">{g.servers?.length || 0}</span></> })),
  ]

  return (
    <>
      <Topbar title={site} right={
        <span className="live" title={connected ? '实时数据已连接' : '连接中断，正在重连'}>
          <span className={clsx('dot', connected ? 'on pulse' : 'off')} />
          {connected ? `${viewers} 人在看` : '重连中…'}
        </span>
      } />
      <main className="page">
        <section className="deck">
          <div className="deck-l">
            <div className="eyebrow deck-eyebrow"><span className="tick" />Fleet status<span className="sep">/</span>节点总览</div>
            <button type="button" className={clsx('deck-count', filter === 'online' && 'on', filter === 'offline' && 'on bad-on')}
              title={offline ? '点击切换：在线 / 离线 / 全部' : '点击只看在线'}
              onClick={() => setFilter(filter === 'all' ? (offline ? 'offline' : 'online') : filter === 'offline' ? 'online' : 'all')}>
              <span className="n">{online.length}</span>
              <span className="of">/{servers.length}</span>
            </button>
            <div className="deck-caption">
              {!loaded ? '正在建立连接…' : offline ? <><span className="bad">{offline} 台离线</span>，其余节点在线运行</> : servers.length ? '所有节点在线，运行平稳' : '暂无服务器'}
            </div>

            <dl className="readouts">
              <div>
                <dt><IUp />上行</dt>
                <dd>{bytesParts(up)[0]}<small>{bytesParts(up)[1]}/s</small></dd>
              </div>
              <div>
                <dt><IDown />下行</dt>
                <dd>{bytesParts(down)[0]}<small>{bytesParts(down)[1]}/s</small></dd>
              </div>
              <div>
                <dt><ITraffic />累计流量</dt>
                <dd>{bytesParts(totalIn + totalOut)[0]}<small>{bytesParts(totalIn + totalOut)[1]}</small></dd>
                <span className="rd-sub">出 {fmtBytes(totalOut)} · 入 {fmtBytes(totalIn)}</span>
              </div>
              <div>
                <dt><ICalendar />7 天内到期</dt>
                <dd className={clsx(expiring.length > 0 && 'warn')}>{expiring.length}<small>台</small></dd>
                <span className="rd-sub" title={expiring.map((s) => s.name).join('、')}>{expiring.length ? expiring.map((s) => s.name).join('、') : '近期无需续费'}</span>
              </div>
            </dl>
          </div>
          <div className="deck-r">
            <Radar servers={servers} />
            <div className="radar-legend">
              <span><i className="lg-dot" />在线 · 越外圈 CPU 越忙</span>
              <span><i className="lg-dot off" />离线</span>
            </div>
          </div>
        </section>

        <div className="toolbar">
          <Seg<Filter> className="scroll" label="筛选" value={filter} onChange={setFilter} options={filters} />
          <span className="spacer" />
          <label className="pill-input">
            <ISearch />
            <input ref={searchRef} className="input" placeholder="搜索名称或线路" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索" />
            <span className="kbd">/</span>
          </label>
          <Dropdown<SortKey>
            value={sort}
            label="排序"
            options={SORT_OPTIONS}
            onChange={(v) => { setSort(v); savePref('probe-sort', v) }}
          />
          <Seg<'grid' | 'list'> className="views" label="视图" value={view} onChange={(v) => { setView(v); savePref('probe-view', v) }} options={[
            { value: 'grid', label: <IGrid />, title: '卡片' },
            { value: 'list', label: <IList />, title: '列表' },
          ]} />
        </div>

        {!loaded ? (
          <div className="grid">{[0, 1, 2].map((i) => <div key={i} className="skel glass" />)}</div>
        ) : shown.length === 0 ? (
          <div className="glass empty">
            <EmptyArt />
            <h3>{servers.length ? '没有匹配的服务器' : '还没有服务器'}</h3>
            {servers.length ? '换个关键词或筛选条件试试' : '在后台「服务器 → 添加服务器」获取 Agent 安装命令'}
          </div>
        ) : view === 'grid' ? (
          <div className="grid">
            {shown.map((s) => <ServerCard key={s.id} s={s} traffic={traffic.get(s.id)} latency={byServer.get(s.id)} brief={briefs[s.id]} />)}
          </div>
        ) : <ListView servers={shown} traffic={traffic} briefs={briefs} />}

        <footer className="foot"><span>{site}</span>{probeMeta.footer_text && <><span>·</span><span>{probeMeta.footer_text}</span></>}</footer>
      </main>
    </>
  )
}

function ListView({ servers, traffic, briefs }: { servers: LiveServer[]; traffic: ReturnType<typeof cycleTrafficMap>; briefs: Record<string, QualityBrief> }) {
  const nav = useNavigate()
  return (
    <div className="glass table-wrap">
      <table className="t">
        <thead>
          <tr><th>服务器</th><th>CPU</th><th>内存</th><th>硬盘</th><th>上行 / 下行</th><th>流量</th><th>线路</th><th>价格</th><th>到期</th></tr>
        </thead>
        <tbody>
          {servers.map((s) => {
            const t = traffic.get(s.id)
            const st = s.state || {}
            const h = s.host || {}
            const exp = expiryText(s.billing)
            const mem = pct(st.mem_used, h.mem_total)
            const disk = pct(st.disk_used, h.disk_total)
            return (
              <tr key={s.id} onClick={() => nav(`/server/${s.id}`)} style={{ cursor: 'pointer', opacity: s.online ? 1 : 0.55 }}>
                <td><span className="row"><span className={clsx('dot', s.online ? 'on' : 'off')} />{s.country_code && <span className="cc">{s.country_code.toUpperCase()}</span>}<b style={{ fontWeight: 600 }}>{s.name}</b></span></td>
                <td>{(st.cpu || 0).toFixed(1)}%<span className="cellmeter"><Meter value={st.cpu || 0} /></span></td>
                <td>{mem.toFixed(1)}%<span className="cellmeter"><Meter value={mem} /></span></td>
                <td>{disk.toFixed(1)}%<span className="cellmeter"><Meter value={disk} /></span></td>
                <td className="muted">{fmtSpeed(st.net_out_speed)} / {fmtSpeed(st.net_in_speed)}</td>
                <td>{t && t.limit ? `${fmtBytes(t.used)} / ${fmtBytes(t.limit, 0)}` : <span className="muted">{fmtBytes((st.net_in_transfer || 0) + (st.net_out_transfer || 0))}</span>}</td>
                <td><span className="wrap" style={{ flexWrap: 'nowrap' }}><RouteTags brief={briefs[s.id]} manual={s.note.planDataMod?.networkRoute} /></span></td>
                <td>{priceText(s.billing) || <span className="faint">—</span>}</td>
                <td style={{ color: exp ? (exp.tone === 'neutral' ? 'var(--muted)' : toneVar(exp.tone)) : undefined }}>{exp?.text || <span className="faint">—</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
