import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import TopologyCanvas, { type TopoSelection } from '../components/TopologyCanvas'
import { EmptyArt } from '../components/art'
import { cssUrl, useFlagUrls } from '../components/brand'
import { IBack, IExternal, IX } from '../components/icons'
import { api } from '../lib/api'
import { clsx, fmtAgo, fmtSpeed } from '../lib/format'
import { useLiveServers, useProbeMeta, useSetting, useTitle, type LiveServer } from '../lib/hooks'
import { KINDS, ROLES, ROLE_ORDER, emptyTopology, enumeratePaths, type TopoKind, type Topology } from '../lib/topology'
import '../components/topology.css'

export function TopoLegend({ topo }: { topo: Topology }) {
  const roles = ROLE_ORDER.filter((r) => topo.nodes.some((n) => n.role === r))
  const kinds = (Object.keys(KINDS) as TopoKind[]).filter((k) => topo.links.some((l) => l.kind === k))
  return (
    <div className="topo-overlay topo-legend">
      {roles.map((r) => (
        <span key={r} className="lg-item" style={{ ['--c' as string]: ROLES[r].color }}><i className="lg-dot" />{ROLES[r].name}</span>
      ))}
      {kinds.length > 0 && <i className="lg-sep" />}
      {kinds.map((k) => (
        <span key={k} className="lg-item" style={{ ['--c' as string]: KINDS[k].color }} title={KINDS[k].desc}><i className={`lg-line k-${k}`} />{KINDS[k].name}</span>
      ))}
    </div>
  )
}

/** 标题里最后两个字用强调色，例如「网络出口<em>拓扑</em>」 */
function Title({ text }: { text: string }) {
  const chars = [...text]
  if (chars.length < 4) return <h1>{text}</h1>
  return <h1>{chars.slice(0, -2).join('')}<em>{chars.slice(-2).join('')}</em></h1>
}

export default function TopologyPage() {
  const setting = useSetting()
  const meta = useProbeMeta()
  const site = setting?.config.site_name || 'VPS 探针'
  const [topo, setTopo] = useState<Topology | null>(null)
  const [sel, setSel] = useState<TopoSelection>({})
  const [routeFocus, setRouteFocus] = useState<number | null>(null)
  const { servers, connected: wsOk } = useLiveServers()
  useTitle(`${topo?.title || '网络拓扑'} · ${site}`)

  useEffect(() => {
    api<Topology>('/probe/topology')
      .then((t) => setTopo({ ...emptyTopology(), ...t, nodes: t?.nodes || [], links: t?.links || [] }))
      .catch(() => setTopo(emptyTopology()))
  }, [])

  const live = useMemo(() => new Map<number, LiveServer>(servers.map((s) => [s.id, s])), [servers])
  const paths = useMemo(() => (topo ? enumeratePaths(topo) : []), [topo])
  const flags = useFlagUrls((topo?.nodes || []).map((n) => n.region || ''))

  if (!topo) return (<><Topbar title={site} /><main className="page"><div className="skel glass" /></main></>)

  const nodeById = new Map(topo.nodes.map((n) => [n.id, n]))
  const linked = topo.nodes.filter((n) => n.server_id && live.has(n.server_id))
  const onlineCount = linked.filter((n) => live.get(n.server_id!)?.online).length
  const count = (r: string) => topo.nodes.filter((n) => n.role === r).length
  const isOff = (id: string) => {
    const n = nodeById.get(id)
    const s = n?.server_id ? live.get(n.server_id) : undefined
    return !!s && !s.online
  }
  // 悬停路径卡片时，在图上只高亮这一条路径
  const routeHl = routeFocus != null && paths[routeFocus] ? { nodes: new Set(paths[routeFocus].nodes), links: new Set(paths[routeFocus].links) } : null
  const selNode = sel.node ? nodeById.get(sel.node) : undefined
  const selLink = sel.link ? topo.links.find((l) => l.id === sel.link) : undefined
  // 详情浮层放在与选中项相对的角落，避免挡住它
  const cardPos = (() => {
    const pts = selNode ? [selNode] : selLink ? [nodeById.get(selLink.from), nodeById.get(selLink.to)].filter((n) => !!n) : []
    if (!pts.length) return undefined
    const xs = topo.nodes.map((n) => n.x)
    const ys = topo.nodes.map((n) => n.y)
    const px = pts.reduce((a, n) => a + n!.x, 0) / pts.length
    const py = pts.reduce((a, n) => a + n!.y, 0) / pts.length
    const left = px > (Math.min(...xs) + Math.max(...xs)) / 2
    const top = py > (Math.min(...ys) + Math.max(...ys)) / 2
    return {
      left: left ? 16 : 'auto', right: left ? 'auto' : 16,
      top: top ? 16 : 'auto', bottom: top ? 'auto' : (left ? 44 : 16),
    }
  })()

  const nums = [
    { k: '入口', v: count('entry'), c: ROLES.entry.color },
    { k: '中转', v: count('relay'), c: ROLES.relay.color },
    { k: '出口', v: count('exit'), c: ROLES.exit.color },
    { k: '线路', v: topo.links.length, c: 'var(--fg-2)' },
  ].filter((x) => x.v > 0 || x.k === '线路')

  return (
    <>
      <Topbar title={site} />
      <main className="page">
        <Link to="/" className="back"><IBack width={15} height={15} />返回总览</Link>
        <section className="topo-hero">
          <div>
            <div className="eyebrow deck-eyebrow"><span className="tick" />Network topology<span className="sep">/</span>网络出口</div>
            <Title text={topo.title || '网络出口拓扑'} />
            <p>{topo.desc || '流量从入口接入，经中转线路，最终从出口节点出网。节点状态与速率实时更新。'}</p>
          </div>
          <dl className="topo-nums">
            {nums.map((x) => (
              <div key={x.k}><dt><i style={{ ['--c' as string]: x.c }} />{x.k}</dt><dd>{x.v}</dd></div>
            ))}
            {linked.length > 0 && (
              <div><dt><i style={{ ['--c' as string]: 'var(--ok)' }} />在线</dt><dd className={onlineCount < linked.length ? 'warn' : undefined}>{onlineCount}<small>/{linked.length}</small></dd></div>
            )}
          </dl>
        </section>

        {topo.nodes.length === 0 ? (
          <div className="glass empty">
            <EmptyArt />
            <h3>还没有配置拓扑图</h3>
            管理员可以在后台「网络 → 拓扑图」中添加节点与线路
          </div>
        ) : (
          <div className="topo-stage">
            <div className="topo-scroll">
              <TopologyCanvas topo={topo} live={live} selected={sel} highlight={routeHl} onSelect={(s) => { setRouteFocus(null); setSel(s) }} fit />
            </div>
            {linked.length > 0 && (
              <div className="topo-overlay topo-live"><span className={clsx('dot', wsOk ? 'on pulse' : 'off')} />{wsOk ? 'Live' : 'Reconnecting'}</div>
            )}
            <TopoLegend topo={topo} />
            {selNode && (() => {
              const s = selNode.server_id ? live.get(selNode.server_id) : undefined
              const role = ROLES[selNode.role]
              return (
                <div className="topo-overlay topo-card" style={{ ['--c' as string]: role.color, ...cardPos }}>
                  <button className="iconbtn tc-x" onClick={() => setSel({})} aria-label="关闭"><IX /></button>
                  <div className="tc-k">{role.en} · {role.name}</div>
                  <div className="tc-title">{selNode.region && flags[selNode.region.toLowerCase()] && <i className="flag" style={{ backgroundImage: cssUrl(flags[selNode.region.toLowerCase()]) }} />}{selNode.label}</div>
                  {selNode.note && <div className="tc-note">{selNode.note}</div>}
                  {s && (
                    <div className="tc-row">
                      <span className={s.online ? 'ok' : 'bad'}>● {s.online ? '在线' : `离线 · ${fmtAgo(s.last_active)}`}</span>
                      {s.online && <span className="mono muted">↑ {fmtSpeed(s.state?.net_out_speed)}  ↓ {fmtSpeed(s.state?.net_in_speed)}</span>}
                      <Link className="btn xs" to={`/server/${s.id}`}>详情<IExternal /></Link>
                    </div>
                  )}
                </div>
              )
            })()}
            {selLink && (
              <div className="topo-overlay topo-card" style={{ ['--c' as string]: KINDS[selLink.kind].color, ...cardPos }}>
                <button className="iconbtn tc-x" onClick={() => setSel({})} aria-label="关闭"><IX /></button>
                <div className="tc-k">{KINDS[selLink.kind].name}{selLink.label && ` · ${selLink.label}`}</div>
                <div className="tc-title">{nodeById.get(selLink.from)?.label} <span className="faint">→</span> {nodeById.get(selLink.to)?.label}</div>
                {selLink.note && <div className="tc-note">{selLink.note}</div>}
              </div>
            )}
          </div>
        )}

        {paths.length > 0 && (
          <section className="topo-routes">
            <div className="topo-routes-h">全部路径 · {paths.length}</div>
            <div className="topo-routes-grid">
              {paths.map((p, i) => {
                const last = nodeById.get(p.nodes[p.nodes.length - 1])!
                const exitNode = [...p.nodes].reverse().map((id) => nodeById.get(id)!).find((n) => n.role === 'exit') || last
                const down = p.nodes.some(isOff)
                const on = routeFocus === i || (!!sel.node && p.nodes.includes(sel.node)) || (!!sel.link && p.links.includes(sel.link))
                return (
                  <div key={i} className={clsx('route-card', on && 'on')} onMouseEnter={() => setRouteFocus(i)} onMouseLeave={() => setRouteFocus(null)}>
                    <div className="route-card-h">
                      <span className="no">{String(i + 1).padStart(2, '0')}</span>
                      <span className="to">经 {exitNode.label} 出网</span>
                      <span className={clsx('st', down ? 'bad' : 'faint')}>{down ? '有节点离线' : `${p.links.length} 跳`}</span>
                    </div>
                    <div className="metro">
                      {p.nodes.map((id, j) => {
                        const n = nodeById.get(id)!
                        const l = j > 0 ? topo.links.find((x) => x.id === p.links[j - 1]) : undefined
                        return (
                          <span key={id} style={{ display: 'contents' }}>
                            {l && (
                              <span className={`metro-seg k-${l.kind}`} style={{ ['--c' as string]: KINDS[l.kind].color }}>
                                {l.label && <em>{l.label}</em>}
                              </span>
                            )}
                            <span className={clsx('metro-stop', isOff(id) && 'off')} style={{ ['--c' as string]: ROLES[n.role].color }}>
                              {n.region && flags[n.region.toLowerCase()]
                                ? <i className="dot flag" style={{ backgroundImage: cssUrl(flags[n.region.toLowerCase()]) }} />
                                : <i className="dot" />}
                              <span title={n.label}>{n.label}</span>
                            </span>
                          </span>
                        )
                      })}
                    </div>
                    {last.note && <div className="faint" style={{ fontSize: 11.5, marginTop: 12 }}>{last.note}</div>}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <footer className="foot">
          <span>{site}</span>
          {topo.updated_at && <><span>·</span><span>拓扑更新于 {fmtAgo(topo.updated_at)}</span></>}
          {meta.footer_text && <><span>·</span><span>{meta.footer_text}</span></>}
        </footer>
      </main>
    </>
  )
}
