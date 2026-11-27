import { useCallback, useEffect, useMemo, useState } from 'react'
import TopologyCanvas, { type TopoSelection } from '../components/TopologyCanvas'
import { IExternal, ILayers, ILink, IPlus, IRestore, ITrash } from '../components/icons'
import { Field } from '../components/ui'
import { api, type ServerRow } from '../lib/api'
import { clsx, fmtAgo } from '../lib/format'
import { useLiveServers, type LiveServer } from '../lib/hooks'
import {
  CANVAS_H, CANVAS_W, KINDS, ROLES, ROLE_ORDER, autoLayout, clampX, emptyTopology, newId,
  type TopoKind, type TopoLink, type TopoNode, type TopoRole, type Topology,
} from '../lib/topology'
import { TopoLegend } from '../pages/Topology'
import { PageHead, useAction, useConfirm, useList } from './common'
import '../components/topology.css'

const LABEL_PRESETS = ['IPLC', 'IEPL', 'CN2 GIA', 'CMIN2', '9929', 'BGP', 'WireGuard', 'Hysteria2']

const normalize = (t?: Partial<Topology> | null): Topology => ({ ...emptyTopology(), ...t, nodes: t?.nodes || [], links: t?.links || [] })
const snapshot = (t: Topology) => JSON.stringify({ title: t.title || '', desc: t.desc || '', nodes: t.nodes, links: t.links })

/** 新节点的默认位置：按角色列放，往下找空位 */
function placeFor(t: Topology, role: TopoRole): { x: number; y: number } {
  const col = ROLE_ORDER.indexOf(role)
  const x = clampX(130 + (col * (CANVAS_W - 260)) / (ROLE_ORDER.length - 1))
  for (let y = 140; y < CANVAS_H - 80; y += 140) {
    if (!t.nodes.some((n) => Math.abs(n.x - x) < 120 && Math.abs(n.y - y) < 110)) return { x: Math.round(x), y }
  }
  return { x: CANVAS_W / 2, y: CANVAS_H / 2 }
}

export default function TopologyAdmin() {
  const [topo, setTopo] = useState<Topology | null>(null)
  const [saved, setSaved] = useState('')
  const [sel, setSel] = useState<TopoSelection>({})
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const { data: servers } = useList<ServerRow>('/server')
  const { servers: liveList } = useLiveServers()
  const live = useMemo(() => new Map<number, LiveServer>(liveList.map((s) => [s.id, s])), [liveList])
  const { busy, run } = useAction()
  const confirm = useConfirm()

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

  const addNode = (role: TopoRole = 'entry', extra: Partial<TopoNode> = {}) => {
    if (!topo) return
    const n: TopoNode = { id: newId('n'), label: ROLES[role].name, role, ...placeFor(topo, role), ...extra }
    update((t) => ({ ...t, nodes: [...t.nodes, n] }))
    setSel({ node: n.id })
  }

  const connect = (from: string, to: string) => {
    setConnectFrom(null)
    if (!topo) return
    const exist = topo.links.find((l) => l.from === from && l.to === to)
    if (exist) { setSel({ link: exist.id }); return }
    const l: TopoLink = { id: newId('l'), from, to, kind: 'normal' }
    update((t) => ({ ...t, links: [...t.links, l] }))
    setSel({ link: l.id })
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
      <PageHead title="网络拓扑" desc={<>手动绘制流量的入口、中转与出口，所有访客都能在前台 <a href="/topology" target="_blank" rel="noreferrer" className="info">/topology</a> 查看，只有后台可以修改。</>}>
        {dirty && <span className="topo-dirty">未保存</span>}
        {dirty && <button className="btn" onClick={revert}><IRestore />撤销</button>}
        <a className="btn" href="/topology" target="_blank" rel="noreferrer"><IExternal />前台查看</a>
        <button className="btn primary" disabled={busy || !dirty} onClick={save}>保存</button>
      </PageHead>

      <div className="topo-editor">
        <div className="topo-stage">
          <div className="topo-toolbar">
            <button className="btn sm" onClick={() => addNode('entry')}><IPlus />添加节点</button>
            <button className="btn sm" onClick={() => update(autoLayout)} disabled={!topo.nodes.length} title="按 用户端 → 入口 → 中转 → 出口 → 目标 分列排布"><ILayers />自动排列</button>
            {selNode && (
              <button className={clsx('btn sm', connectFrom && 'primary')} onClick={() => setConnectFrom(connectFrom ? null : selNode.id)}>
                <ILink />{connectFrom ? '取消连线' : '从此节点连线'}
              </button>
            )}
            <span className="spacer" />
            <span className="topo-hint">
              {connectFrom ? `连线中：点击目标节点（从「${nodeName(connectFrom)}」出发），Esc 取消` : '拖动节点调整位置 · 选中后按 Delete 删除'}
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
            />
          </div>
          {topo.nodes.length === 0 && <div className="topo-empty-cta">点左上角「添加节点」开始绘制</div>}
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
              onDelete={removeSelected}
            />
          ) : selLink ? (
            <LinkInspector
              key={selLink.id}
              link={selLink}
              topo={topo}
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
                1. 「添加节点」，在右侧填名称、角色（入口 / 中转 / 出口…）和地区代码（显示国旗）<br />
                2. 选中节点 →「从此节点连线」→ 点击下一跳节点<br />
                3. 选中线路设置类型（专线 / 隧道 / 备用）与标注<br />
                4. 「自动排列」可一键按角色分列，最后点「保存」
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

function RolePicker({ value, onChange }: { value: TopoRole; onChange: (r: TopoRole) => void }) {
  return (
    <div className="role-pick">
      {ROLE_ORDER.map((r) => (
        <button key={r} type="button" className={clsx(value === r && 'on')} style={{ ['--c' as string]: ROLES[r].color }} onClick={() => onChange(r)} title={ROLES[r].desc}>{ROLES[r].name}</button>
      ))}
    </div>
  )
}

function NodeInspector({ node, topo, servers, onChange, onSelectLink, onDelete }: {
  node: TopoNode
  topo: Topology
  servers: ServerRow[]
  onChange: (p: Partial<TopoNode>) => void
  onSelectLink: (id: string) => void
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
      <Field label="名称"><input className="input" value={node.label} maxLength={40} onChange={(e) => onChange({ label: e.target.value })} autoFocus /></Field>
      <div className="fld"><span>角色</span><RolePicker value={node.role} onChange={(role) => onChange({ role })} /></div>
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

function LinkInspector({ link, topo, onChange, onDelete }: {
  link: TopoLink
  topo: Topology
  onChange: (p: Partial<TopoLink>) => void
  onDelete: () => void
}) {
  return (
    <>
      <h3><span className="lg-sw" style={{ width: 9, height: 9, borderRadius: 3, background: KINDS[link.kind].color }} />线路</h3>
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
            <button key={k} type="button" className={clsx(link.kind === k && 'on')} style={{ ['--c' as string]: KINDS[k].color }} title={KINDS[k].desc} onClick={() => onChange({ kind: k })}>{KINDS[k].name.slice(0, 2)}</button>
          ))}
        </div>
        <span className="hint">{KINDS[link.kind].name}：{KINDS[link.kind].desc}</span>
      </div>
      <Field label="线路标注" hint="显示在连线中间">
        <input className="input" value={link.label || ''} maxLength={30} placeholder="如 IPLC / CN2 GIA" onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      <div className="wrap">
        {LABEL_PRESETS.map((p) => <button key={p} className="tag plain" style={{ cursor: 'pointer' }} onClick={() => onChange({ label: p })}>{p}</button>)}
      </div>
      <Field label="备注"><textarea className="textarea" style={{ fontFamily: 'var(--sans)', minHeight: 64 }} value={link.note || ''} maxLength={200} onChange={(e) => onChange({ note: e.target.value })} /></Field>
      <button className="btn sm ghost danger" onClick={onDelete}><ITrash />删除线路</button>
    </>
  )
}
