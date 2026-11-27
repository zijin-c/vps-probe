import { useCallback, useEffect, useMemo, useState } from 'react'
import TopologyCanvas, { DRAG_SERVER_TYPE, type TopoSelection } from '../components/TopologyCanvas'
import { Flag } from '../components/brand'
import { IExternal, IEyeOff, ILayers, ILink, IPlus, IRefresh, IRestore, ISearch, ITrash } from '../components/icons'
import { Field, useToast } from '../components/ui'
import { api, type QualityBrief, type ServerRow } from '../lib/api'
import { clsx, fmtAgo } from '../lib/format'
import { useLiveServers, useQualitySummary, type LiveServer } from '../lib/hooks'
import {
  CANVAS_H, COL_X, KINDS, ROLES, ROLE_ORDER, autoLayout, clampY, detectRoute, emptyTopology, newId, roleForX,
  type DetectedRoute, type TopoKind, type TopoLink, type TopoNode, type TopoRole, type Topology,
} from '../lib/topology'
import { TopoLegend } from '../pages/Topology'
import { PageHead, useAction, useConfirm, useList } from './common'
import '../components/topology.css'

const DEFAULT_LABEL: Partial<Record<TopoRole, string>> = { client: '我的网络', target: '互联网' }
const LABEL_PRESETS = ['IPLC', 'IEPL', 'CN2 GIA', 'CMIN2', '9929', 'BGP', 'WireGuard', 'Hysteria2']

const normalize = (t?: Partial<Topology> | null): Topology => ({ ...emptyTopology(), ...t, nodes: t?.nodes || [], links: t?.links || [] })
const snapshot = (t: Topology) => JSON.stringify({ title: t.title || '', desc: t.desc || '', nodes: t.nodes, links: t.links })

/** 新节点的默认位置：放在该角色的列上，往下找空位 */
function placeFor(t: Topology, role: TopoRole): { x: number; y: number } {
  const x = COL_X[role]
  for (let y = 140; y < CANVAS_H - 80; y += 140) {
    if (!t.nodes.some((n) => Math.abs(n.x - x) < 120 && Math.abs(n.y - y) < 110)) return { x, y }
  }
  return { x, y: clampY(CANVAS_H / 2) }
}

/** 线路摘要里最能代表这台机器的一个标签（服务器列表里展示用） */
function briefTag(b?: QualityBrief): { label: string; premium: boolean } | null {
  const all = [...Object.values(b?.inbound || {}).filter((x) => !x.guess), ...Object.values(b?.routes || {})].filter((x) => x.label)
  const p = all.find((x) => x.premium)
  if (p) return { label: p.label, premium: true }
  return all[0] ? { label: all[0].label, premium: false } : null
}

export default function TopologyAdmin() {
  const [topo, setTopo] = useState<Topology | null>(null)
  const [saved, setSaved] = useState('')
  const [sel, setSel] = useState<TopoSelection>({})
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const { data: servers } = useList<ServerRow>('/server')
  const { servers: liveList } = useLiveServers()
  const briefs = useQualitySummary()
  const live = useMemo(() => new Map<number, LiveServer>(liveList.map((s) => [s.id, s])), [liveList])
  const { busy, run } = useAction()
  const confirm = useConfirm()
  const toast = useToast()

  const load = useCallback(() => {
    api<Topology>('/probe/topology').then((t) => {
      const n = normalize(t)
      setTopo(n)
      setSaved(snapshot(n))
    }).catch(() => { setTopo(emptyTopology()); setSaved(snapshot(emptyTopology())) })
  }, [])
  useEffect(load, [load])

  const dirty = !!topo && snapshot(topo) !== saved

  // 有未保存的修改时，离开页面前提醒
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const update = (fn: (t: Topology) => Topology) => setTopo((t) => (t ? fn(t) : t))
  const patchNode = (id: string, p: Partial<TopoNode>) => update((t) => ({ ...t, nodes: t.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }))
  const patchLink = (id: string, p: Partial<TopoLink>) => update((t) => ({ ...t, links: t.links.map((l) => (l.id === id ? { ...l, ...p } : l)) }))

  // 线路识别：用探针检测到的去程 / 回程线路，以及服务器备注里手填的线路
  const detect = useCallback((t: Topology, l: Pick<TopoLink, 'from' | 'to'>): DetectedRoute | null => {
    const a = t.nodes.find((n) => n.id === l.from)
    const b = t.nodes.find((n) => n.id === l.to)
    if (!a || !b) return null
    return detectRoute(a, b, briefs, (id) => live.get(id)?.note.planDataMod?.networkRoute, (n) => n.label)
  }, [briefs, live])

  const addNode = (role: TopoRole) => {
    if (!topo) return
    const n: TopoNode = { id: newId('n'), label: DEFAULT_LABEL[role] || ROLES[role].name, role, ...placeFor(topo, role) }
    update((t) => ({ ...t, nodes: [...t.nodes, n] }))
    setSel({ node: n.id })
  }

  /** 把服务器放到画布上：放在哪一列就是什么角色，名称和地区自动带上 */
  const addServer = (serverId: number, at?: { x: number; y: number }) => {
    if (!topo) return
    const exist = topo.nodes.find((n) => n.server_id === serverId)
    if (exist) { setSel({ node: exist.id }); return }
    const s = servers?.find((x) => x.id === serverId)
    if (!s) return
    const role: TopoRole = at ? roleForX(at.x) : 'exit'
    const pos = at || placeFor(topo, role)
    const cc = (s.geoip?.country_code || live.get(serverId)?.country_code || '').toUpperCase().slice(0, 2)
    const n: TopoNode = { id: newId('n'), label: s.name, role, server_id: serverId, region: cc || undefined, ...pos }
    update((t) => ({ ...t, nodes: [...t.nodes, n] }))
    setSel({ node: n.id })
  }

  const connect = (from: string, to: string) => {
    setConnectFrom(null)
    if (!topo) return
    const exist = topo.links.find((l) => l.from === from && l.to === to)
    if (exist) { setSel({ link: exist.id }); return }
    const d = detect(topo, { from, to })
    const l: TopoLink = d ? { id: newId('l'), from, to, kind: d.kind, label: d.label, auto: true } : { id: newId('l'), from, to, kind: 'normal' }
    update((t) => ({ ...t, links: [...t.links, l] }))
    setSel({ link: l.id })
    if (d) toast(`已自动识别：${d.label}（${d.source}）`, 'ok')
  }

  /** 重新识别：只覆盖自动识别过的、或还没填类型和标注的线路，手动改过的不动 */
  const detectAll = () => {
    if (!topo) return
    let n = 0
    const links = topo.links.map((l) => {
      if (l.auto === false || (!l.auto && (l.label || l.kind !== 'normal'))) return l
      const d = detect(topo, l)
      if (!d) return l
      if (d.kind !== l.kind || d.label !== l.label) n++
      return { ...l, kind: d.kind, label: d.label, auto: true }
    })
    update((t) => ({ ...t, links }))
    toast(n ? `已识别 ${n} 条线路` : '没有可以更新的线路（手动设置过的线路不会被覆盖）', n ? 'ok' : 'info')
  }

  const removeSelected = useCallback(() => {
    if (sel.node) {
      const id = sel.node
      update((t) => ({ ...t, nodes: t.nodes.filter((n) => n.id !== id), links: t.links.filter((l) => l.from !== id && l.to !== id) }))
    } else if (sel.link) {
      const id = sel.link
      update((t) => ({ ...t, links: t.links.filter((l) => l.id !== id) }))
    }
    setSel({})
  }, [sel])

  // 键盘：Delete 删除选中项，Esc 取消连线 / 取消选中
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape') { if (connectFrom) setConnectFrom(null); else setSel({}) }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (sel.node || sel.link)) { e.preventDefault(); removeSelected() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [connectFrom, sel, removeSelected])

  const save = async () => {
    if (!topo) return
    let out: Topology | null = null
    const ok = await run(async () => { out = await api<Topology>('/probe/topology', { method: 'PUT', body: topo }) }, '拓扑已保存，前台已更新')
    if (ok && out) {
      const n = normalize(out)
      setTopo(n)
      setSaved(snapshot(n))
    }
  }

  const revert = async () => {
    if (await confirm({ title: '放弃未保存的修改？', message: '画布会恢复到上次保存的状态。', confirmText: '放弃修改', danger: true })) {
      setSel({}); setConnectFrom(null); load()
    }
  }

  if (!topo) return <div className="empty">加载中…</div>

  const selNode = sel.node ? topo.nodes.find((n) => n.id === sel.node) : undefined
  const selLink = sel.link ? topo.links.find((l) => l.id === sel.link) : undefined
  const nodeName = (id: string) => topo.nodes.find((n) => n.id === id)?.label || '?'

  return (
    <>
      <PageHead title="网络拓扑" desc={<>把服务器拖到画布上，连上线，线路类型会按探针检测结果自动识别。所有访客都能在前台 <a href="/topology" target="_blank" rel="noreferrer" className="info">/topology</a> 查看，只有后台可以修改。</>}>
        {dirty && <span className="topo-dirty">未保存</span>}
        {dirty && <button className="btn" onClick={revert}><IRestore />撤销</button>}
        <a className="btn" href="/topology" target="_blank" rel="noreferrer"><IExternal />前台查看</a>
        <button className="btn primary" disabled={busy || !dirty} onClick={save}>保存</button>
      </PageHead>

      <ServerPalette
        servers={servers || []}
        live={live}
        briefs={briefs}
        placed={new Map(topo.nodes.filter((n) => n.server_id).map((n) => [n.server_id!, n.id]))}
        onAdd={(id) => addServer(id)}
        onLocate={(nodeId) => setSel({ node: nodeId })}
      />

      <div className="topo-editor">
        <div className="topo-stage">
          <div className="topo-toolbar">
            <AddNodeMenu onAdd={addNode} />
            {selNode && (
              <button className={clsx('btn sm', connectFrom && 'primary')} onClick={() => setConnectFrom(connectFrom ? null : selNode.id)}>
                <ILink />{connectFrom ? '取消连线' : '从此节点连线'}
              </button>
            )}
            <button className="btn sm" onClick={detectAll} disabled={!topo.links.length} title="按探针检测结果重新识别线路类型与标注（手动改过的线路不受影响）"><IRefresh />识别线路</button>
            <button className="btn sm" onClick={() => update(autoLayout)} disabled={!topo.nodes.length} title="按 用户端 → 入口 → 中转 → 出口 → 目标 分列排布"><ILayers />自动排列</button>
            <span className="spacer" />
            <span className="topo-hint">
              {connectFrom ? `连线中：点击下一跳节点（从「${nodeName(connectFrom)}」出发），Esc 取消` : '拖动调整位置 · Delete 删除'}
            </span>
          </div>
          <div className="topo-scroll">
            <TopologyCanvas
              topo={topo}
              live={live}
              editable
              selected={sel}
              onSelect={(s) => { if (!connectFrom) setSel(s) }}
              onMove={(id, x, y) => patchNode(id, { x, y })}
              connectFrom={connectFrom}
              onConnect={connect}
              onDropServer={(id, x, y) => addServer(id, { x, y })}
            />
          </div>
          {topo.nodes.length === 0 && <div className="topo-empty-cta"><div>把上方的服务器拖到画布上<br /><span className="faint">放在哪一列，就是什么角色</span></div></div>}
          <TopoLegend topo={topo} />
        </div>

        <aside className="glass topo-inspector">
          {selNode ? (
            <NodeInspector
              key={selNode.id}
              node={selNode}
              topo={topo}
              servers={servers || []}
              onChange={(p) => patchNode(selNode.id, p)}
              onSelectLink={(id) => setSel({ link: id })}
              onConnect={() => setConnectFrom(selNode.id)}
              onDelete={removeSelected}
            />
          ) : selLink ? (
            <LinkInspector
              key={selLink.id}
              link={selLink}
              topo={topo}
              detected={detect(topo, selLink)}
              onChange={(p) => patchLink(selLink.id, p)}
              onDelete={removeSelected}
            />
          ) : (
            <>
              <h3>图表信息</h3>
              <Field label="标题"><input className="input" value={topo.title || ''} placeholder="网络出口拓扑" maxLength={60} onChange={(e) => update((t) => ({ ...t, title: e.target.value }))} /></Field>
              <Field label="说明"><textarea className="textarea" style={{ fontFamily: 'var(--sans)', minHeight: 72 }} value={topo.desc || ''} maxLength={300} placeholder="显示在前台标题下方" onChange={(e) => update((t) => ({ ...t, desc: e.target.value }))} /></Field>
              <div className="note">
                <b>怎么画：</b><br />
                1. 从上方把服务器<b>拖进画布</b>，放在哪一列就是什么角色（入口 / 中转 / 出口…），名称和国旗自动带上<br />
                2. 选中节点 →「从此节点连线」→ 点下一跳；线路类型和标注会按探针的去程 / 回程检测<b>自动识别</b><br />
                3. 家里网络、互联网这类不是服务器的点，用「添加节点」<br />
                4. 最后点右上角「保存」
              </div>
              <div className="topo-hint">
                {topo.nodes.length} 个节点 · {topo.links.length} 条线路{topo.updated_at && ` · 上次保存 ${fmtAgo(topo.updated_at)}`}
              </div>
            </>
          )}
        </aside>
      </div>
    </>
  )
}

function AddNodeMenu({ onAdd }: { onAdd: (r: TopoRole) => void }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const h = () => setOpen(false)
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [open])
  return (
    <span className="topo-add">
      <button className="btn sm" onClick={(e) => { e.stopPropagation(); setOpen(!open) }}><IPlus />添加节点</button>
      {open && (
        <div className="topo-add-menu float">
          {ROLE_ORDER.map((r) => (
            <button key={r} style={{ ['--c' as string]: ROLES[r].color }} onClick={() => onAdd(r)}>
              <i />{ROLES[r].name}<small>{r === 'client' ? '家里 / 公司网络' : r === 'target' ? '互联网 / 目标服务' : ROLES[r].desc}</small>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

function ServerPalette({ servers, live, briefs, placed, onAdd, onLocate }: {
  servers: ServerRow[]
  live: Map<number, LiveServer>
  briefs: Record<string, QualityBrief>
  placed: Map<number, string>
  onAdd: (id: number) => void
  onLocate: (nodeId: string) => void
}) {
  const [q, setQ] = useState('')
  const kw = q.trim().toLowerCase()
  const list = servers.filter((s) => !kw || s.name.toLowerCase().includes(kw))
  // 未放入的排在前面
  const sorted = [...list.filter((s) => !placed.has(s.id)), ...list.filter((s) => placed.has(s.id))]
  return (
    <div className="glass topo-palette">
      <div className="tp-head">
        <span className="tp-title">我的服务器</span>
        <span className="tp-hint">拖到画布上 · 点击添加为出口</span>
        <span className="spacer" />
        <label className="tp-search"><ISearch /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索" aria-label="搜索服务器" /></label>
      </div>
      <div className="tp-list">
        {servers.length === 0 && <span className="faint" style={{ fontSize: 12.5 }}>还没有服务器，先到「服务器」里添加</span>}
        {sorted.map((s) => {
          const nodeId = placed.get(s.id)
          const ls = live.get(s.id)
          const tag = briefTag(briefs[String(s.id)])
          const cc = s.geoip?.country_code || ls?.country_code
          return (
            <button
              key={s.id}
              className={clsx('tp-chip', nodeId && 'placed')}
              draggable={!nodeId}
              onDragStart={(e) => { e.dataTransfer.setData(DRAG_SERVER_TYPE, String(s.id)); e.dataTransfer.effectAllowed = 'copy' }}
              onClick={() => (nodeId ? onLocate(nodeId) : onAdd(s.id))}
              title={nodeId ? '已在画布上，点击定位' : '拖到画布上，或点击直接添加'}
            >
              <span className={clsx('dot', ls?.online ? 'on' : 'off')} />
              {cc && <Flag code={cc} />}
              <span className="tp-name">{s.name}</span>
              {tag && <span className={clsx('tp-route', tag.premium && 'premium')}>{tag.label}</span>}
              {s.hide_for_guest && <IEyeOff className="tp-hidden" aria-label="对访客隐藏" />}
              {nodeId && <span className="tp-check">✓</span>}
            </button>
          )
        })}
      </div>
      {servers.some((s) => s.hide_for_guest && placed.has(s.id)) && (
        <div className="tp-warn">带 <IEyeOff width={12} height={12} /> 的服务器设置了「对访客隐藏」：放进拓扑后，它在图上的名称会对访客可见（在线状态与速率不会公开）。</div>
      )}
    </div>
  )
}

function RolePicker({ value, onChange }: { value: TopoRole; onChange: (r: TopoRole) => void }) {
  return (
    <div className="role-pick">
      {ROLE_ORDER.map((r) => (
        <button key={r} type="button" className={clsx(value === r && 'on')} style={{ ['--c' as string]: ROLES[r].color }} onClick={() => onChange(r)} title={ROLES[r].desc}>{ROLES[r].name}</button>
      ))}
    </div>
  )
}

function NodeInspector({ node, topo, servers, onChange, onSelectLink, onConnect, onDelete }: {
  node: TopoNode
  topo: Topology
  servers: ServerRow[]
  onChange: (p: Partial<TopoNode>) => void
  onSelectLink: (id: string) => void
  onConnect: () => void
  onDelete: () => void
}) {
  const links = topo.links.filter((l) => l.from === node.id || l.to === node.id)
  const nameOf = (id: string) => topo.nodes.find((n) => n.id === id)?.label || '?'
  const pickServer = (v: string) => {
    const id = Number(v) || undefined
    const s = servers.find((x) => x.id === id)
    const p: Partial<TopoNode> = { server_id: id }
    // 名称还是默认值时，顺手带上服务器名称和地区
    if (s && (!node.label || node.label === ROLES[node.role].name)) p.label = s.name
    if (s && !node.region && s.geoip?.country_code) p.region = s.geoip.country_code.toUpperCase().slice(0, 2)
    onChange(p)
  }
  return (
    <>
      <h3><span className="lg-sw" style={{ width: 9, height: 9, borderRadius: 3, background: ROLES[node.role].color }} />节点</h3>
      <Field label="名称"><input className="input" value={node.label} maxLength={40} onChange={(e) => onChange({ label: e.target.value })} /></Field>
      <div className="fld"><span>角色</span><RolePicker value={node.role} onChange={(role) => onChange({ role, x: COL_X[role] })} /></div>
      <Field label="关联服务器" hint="关联后前台会显示该节点的在线状态与实时速率">
        <select className="select" value={node.server_id || ''} onChange={(e) => pickServer(e.target.value)}>
          <option value="">不关联</option>
          {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="地区代码" hint="两位国家/地区代码，如 HK、JP、US">
        <input className="input mono" value={node.region || ''} maxLength={2} placeholder="HK" onChange={(e) => onChange({ region: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
      </Field>
      <Field label="备注" hint="前台点击节点时显示"><textarea className="textarea" style={{ fontFamily: 'var(--sans)', minHeight: 64 }} value={node.note || ''} maxLength={200} onChange={(e) => onChange({ note: e.target.value })} /></Field>
      <button className="btn sm" onClick={onConnect}><ILink />从此节点连线</button>
      {links.length > 0 && (
        <div className="fld">
          <span>相连线路</span>
          <div className="wrap">
            {links.map((l) => (
              <button key={l.id} className="tag" style={{ cursor: 'pointer', color: KINDS[l.kind].color }} onClick={() => onSelectLink(l.id)}>
                {l.from === node.id ? `→ ${nameOf(l.to)}` : `← ${nameOf(l.from)}`}{l.label ? ` · ${l.label}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      <button className="btn sm ghost danger" onClick={onDelete}><ITrash />删除节点{links.length ? `（及 ${links.length} 条线路）` : ''}</button>
    </>
  )
}

function LinkInspector({ link, topo, detected, onChange, onDelete }: {
  link: TopoLink
  topo: Topology
  detected: DetectedRoute | null
  onChange: (p: Partial<TopoLink>) => void
  onDelete: () => void
}) {
  // 手动改类型 / 标注后，这条线路就不再被「识别线路」覆盖
  const manual = (p: Partial<TopoLink>) => onChange({ ...p, auto: false })
  const same = detected && detected.kind === link.kind && (detected.label || '') === (link.label || '')
  return (
    <>
      <h3><span className="lg-sw" style={{ width: 9, height: 9, borderRadius: 3, background: KINDS[link.kind].color }} />线路{link.auto && <span className="tag info" style={{ height: 18, fontSize: 10.5 }}>自动识别</span>}</h3>
      <div className={clsx('topo-detect', detected && 'has')}>
        {detected ? (
          <>
            <div><span className="faint">探针识别：</span><b style={{ color: KINDS[detected.kind].color }}>{detected.label || KINDS[detected.kind].name}</b> · {KINDS[detected.kind].name}</div>
            <div className="faint">来自 {detected.source}</div>
            {!same && <button className="btn xs" onClick={() => onChange({ kind: detected.kind, label: detected.label, auto: true })}><IRefresh />使用识别结果</button>}
          </>
        ) : (
          <span className="faint">两端都没有关联服务器，或探针还没有线路检测结果，请手动设置。</span>
        )}
      </div>
      <div className="form" style={{ gridTemplateColumns: '1fr', gap: 12 }}>
        <Field label="起点">
          <select className="select" value={link.from} onChange={(e) => e.target.value !== link.to && onChange({ from: e.target.value })}>
            {topo.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}（{ROLES[n.role].name}）</option>)}
          </select>
        </Field>
        <Field label="终点">
          <select className="select" value={link.to} onChange={(e) => e.target.value !== link.from && onChange({ to: e.target.value })}>
            {topo.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}（{ROLES[n.role].name}）</option>)}
          </select>
        </Field>
      </div>
      <button className="btn sm" onClick={() => onChange({ from: link.to, to: link.from })}>⇄ 反转方向</button>
      <div className="fld">
        <span>类型</span>
        <div className="role-pick" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {(Object.keys(KINDS) as TopoKind[]).map((k) => (
            <button key={k} type="button" className={clsx(link.kind === k && 'on')} style={{ ['--c' as string]: KINDS[k].color }} title={KINDS[k].desc} onClick={() => manual({ kind: k })}>{KINDS[k].name.slice(0, 2)}</button>
          ))}
        </div>
        <span className="hint">{KINDS[link.kind].name}：{KINDS[link.kind].desc}</span>
      </div>
      <Field label="线路标注" hint="显示在连线中间">
        <input className="input" value={link.label || ''} maxLength={30} placeholder="如 IPLC / CN2 GIA" onChange={(e) => manual({ label: e.target.value })} />
      </Field>
      <div className="wrap">
        {LABEL_PRESETS.map((p) => <button key={p} className="tag plain" style={{ cursor: 'pointer' }} onClick={() => manual({ label: p })}>{p}</button>)}
      </div>
      <Field label="备注"><textarea className="textarea" style={{ fontFamily: 'var(--sans)', minHeight: 64 }} value={link.note || ''} maxLength={200} onChange={(e) => onChange({ note: e.target.value })} /></Field>
      <button className="btn sm ghost danger" onClick={onDelete}><ITrash />删除线路</button>
    </>
  )
}

