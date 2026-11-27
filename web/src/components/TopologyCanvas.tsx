import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { clsx, fmtSpeed } from '../lib/format'
import type { LiveServer } from '../lib/hooks'
import {
  CANVAS_H, CANVAS_W, COL_X, KINDS, LABEL_H, NODE_R, ROLES, ROLE_ORDER, clampX, clampY, roleForX, connected, fitText, linkBends, linkPath,
  type TopoNode, type TopoRole, type Topology,
} from '../lib/topology'
import { useFlagUrls } from './brand'

export interface TopoSelection { node?: string; link?: string }

interface Props {
  topo: Topology
  live?: Map<number, LiveServer>
  editable?: boolean
  selected?: TopoSelection
  onSelect?: (s: TopoSelection) => void
  onMove?: (id: string, x: number, y: number) => void
  onMoveEnd?: () => void
  /** 连线模式：已选的起点节点，下一次点击节点即连线 */
  connectFrom?: string | null
  onConnect?: (from: string, to: string) => void
  /** 把视野裁剪到节点所在区域（前台展示用；编辑器需要完整画布） */
  fit?: boolean
  /** 外部指定要高亮的节点与线路（优先于悬停 / 选中） */
  highlight?: { nodes: Set<string>; links: Set<string> } | null
  /** 从外部（服务器列表）拖入服务器：返回服务器 ID 与画布坐标 */
  onDropServer?: (serverId: number, x: number, y: number) => void
}

/** 拖拽服务器时 dataTransfer 使用的类型 */
export const DRAG_SERVER_TYPE = 'application/x-probe-server'

/** 角色图标（24 网格线性图标） */
const GLYPH: Record<TopoRole, string> = {
  client: 'M4 6h16v10H4zM2 19h20M9 16v3M15 16v3',
  entry: 'M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M4 12h11M11 8l4 4-4 4',
  relay: 'M4 7h11l-3-3M15 7l-3 3M20 17H9l3 3M9 17l3-3',
  exit: 'M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4M9 12h11M17 8l4 4-4 4',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
}

function useReducedMotion(): boolean {
  const [v, setV] = useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const h = () => setV(mq.matches)
    mq.addEventListener?.('change', h)
    return () => mq.removeEventListener?.('change', h)
  }, [])
  return v
}

/** 由 id 得到稳定的 0~1 伪随机数，让各条线路的光点错开出发 */
function seed(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (h % 1000) / 1000
}

type NodeState = 'online' | 'offline' | 'none'

export default function TopologyCanvas({
  topo, live, editable, selected, onSelect, onMove, onMoveEnd, connectFrom, onConnect, fit, highlight, onDropServer,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null)
  const [hover, setHover] = useState<TopoSelection | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [dropPt, setDropPt] = useState<{ x: number; y: number } | null>(null)
  const reduced = useReducedMotion()
  const flags = useFlagUrls(topo.nodes.map((n) => n.region || ''))

  const byId = useMemo(() => new Map(topo.nodes.map((n) => [n.id, n])), [topo.nodes])
  const bends = useMemo(() => linkBends(topo.links), [topo.links])

  const state = (n: TopoNode): NodeState => {
    if (!n.server_id || !live) return 'none'
    const s = live.get(n.server_id)
    if (!s) return 'none'
    return s.online ? 'online' : 'offline'
  }

  // 悬停优先，其次是选中项；高亮整条上下游链路
  const focus = hover || (editable ? undefined : selected)
  const auto = useMemo(() => (focus && (focus.node || focus.link) ? connected(topo, focus) : null), [topo, focus])
  const hl = highlight || auto

  // 分列标题：同一角色的节点大致在一列时，在列顶写上角色名
  const columns = useMemo(() => editable ? ROLE_ORDER.map((r) => ({ role: r, x: COL_X[r] })) : ROLE_ORDER.map((r) => {
    const xs = topo.nodes.filter((n) => n.role === r).map((n) => n.x)
    if (!xs.length || Math.max(...xs) - Math.min(...xs) > 140) return null
    return { role: r, x: (Math.max(...xs) + Math.min(...xs)) / 2 }
  }).filter(Boolean) as { role: TopoRole; x: number }[], [topo.nodes, editable])

  // 视野：编辑器用完整画布，前台裁剪到内容区域
  const vb = useMemo(() => {
    if (!fit || !topo.nodes.length) return { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }
    const xs = topo.nodes.map((n) => n.x)
    const ys = topo.nodes.map((n) => n.y)
    const x0 = Math.max(0, Math.min(...xs) - 110)
    const x1 = Math.min(CANVAS_W, Math.max(...xs) + 110)
    const y0 = Math.max(0, Math.min(...ys) - NODE_R - (columns.length ? 78 : 40))
    const y1 = Math.min(CANVAS_H, Math.max(...ys) + NODE_R + LABEL_H + 26)
    return { x: x0, y: y0, w: Math.max(x1 - x0, 360), h: Math.max(y1 - y0, 220) }
  }, [fit, topo.nodes, columns.length])

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return { x: 0, y: 0 }
    const p = svg.createSVGPoint()
    p.x = e.clientX
    p.y = e.clientY
    const r = p.matrixTransform(m.inverse())
    return { x: r.x, y: r.y }
  }

  const onNodeDown = (e: RPointerEvent<SVGGElement>, n: TopoNode) => {
    e.stopPropagation()
    if (!editable) return
    const p = toSvg(e)
    drag.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y, sx: e.clientX, sy: e.clientY, moved: false }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const onNodeMove = (e: RPointerEvent<SVGGElement>) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return
    d.moved = true
    const p = toSvg(e)
    const snap = (v: number) => Math.round(v / 5) * 5
    onMove?.(d.id, clampX(snap(p.x - d.dx)), clampY(snap(p.y - d.dy)))
  }
  const onNodeUp = (e: RPointerEvent<SVGGElement>, n: TopoNode) => {
    const d = drag.current
    drag.current = null
    if (d?.moved) { onMoveEnd?.(); return }
    e.stopPropagation()
    if (connectFrom && connectFrom !== n.id) { onConnect?.(connectFrom, n.id); return }
    onSelect?.(selected?.node === n.id && !editable ? {} : { node: n.id })
  }

  const from = connectFrom ? byId.get(connectFrom) : undefined
  const roleColor = (n: TopoNode) => (ROLES[n.role] || ROLES.relay).color

  return (
    <svg
      ref={svgRef}
      className={clsx('topo-svg', editable && 'editable', hl && 'has-focus', connectFrom && 'connecting')}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      role="img"
      aria-label="网络出口拓扑图"
      onPointerMove={(e) => connectFrom && setPointer(toSvg(e))}
      onClick={() => onSelect?.({})}
      onDragOver={(e) => {
        if (!onDropServer || !e.dataTransfer.types.includes(DRAG_SERVER_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropPt(toSvg(e))
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropPt(null) }}
      onDrop={(e) => {
        const id = Number(e.dataTransfer.getData(DRAG_SERVER_TYPE))
        setDropPt(null)
        if (!onDropServer || !id) return
        e.preventDefault()
        const p = toSvg(e)
        onDropServer(id, clampX(Math.round(p.x / 5) * 5), clampY(Math.round(p.y / 5) * 5))
      }}
    >
      <defs>
        <pattern id="topo-dots" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="11" cy="11" r=".9" className="topo-dot" />
        </pattern>
        <radialGradient id="topo-fade" cx="50%" cy="50%" r="62%">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset=".7" stopColor="#fff" stopOpacity=".45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="topo-dots-mask"><rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#topo-fade)" /></mask>
        <radialGradient id="topo-aura" cx="50%" cy="50%" r="50%">
          <stop offset="0" className="ta-a" />
          <stop offset="1" className="ta-b" />
        </radialGradient>
        <radialGradient id="topo-core" cx="35%" cy="30%" r="80%">
          <stop offset="0" className="tc-a" />
          <stop offset="1" className="tc-b" />
        </radialGradient>
        <linearGradient id="topo-col" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="tcol-a" />
          <stop offset="1" className="tcol-b" />
        </linearGradient>
        <clipPath id="topo-flag-clip"><circle r={NODE_R - 7} /></clipPath>
        <filter id="topo-bloom" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {topo.links.map((l) => {
          const a = byId.get(l.from)
          const b = byId.get(l.to)
          if (!a || !b) return null
          return (
            <linearGradient key={l.id} id={`tg-${l.id}`} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
              <stop offset="0" style={{ stopColor: roleColor(a) }} />
              <stop offset="1" style={{ stopColor: roleColor(b) }} />
            </linearGradient>
          )
        })}
      </defs>

      {/* 背景：环境光 + 中心清晰、边缘淡出的点阵 */}
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} className="topo-bgfill" />
      <ellipse cx={vb.x + vb.w * 0.22} cy={vb.y + vb.h * 0.15} rx={vb.w * 0.45} ry={vb.h * 0.6} fill="url(#topo-aura)" />
      <ellipse cx={vb.x + vb.w * 0.85} cy={vb.y + vb.h * 0.95} rx={vb.w * 0.4} ry={vb.h * 0.55} fill="url(#topo-aura)" opacity=".7" />
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#topo-dots)" mask="url(#topo-dots-mask)" />

      {columns.map((c, i) => (
        <g key={c.role} className="topo-col" style={{ ['--c' as string]: ROLES[c.role].color }}>
          <rect x={c.x - 0.5} y={vb.y + 58} width={1} height={vb.h - 76} fill="url(#topo-col)" />
          <text x={c.x} y={vb.y + 30} textAnchor="middle" className="topo-col-en">
            <tspan className="topo-col-n">{String(i + 1).padStart(2, '0')}</tspan>
            <tspan dx="6">{ROLES[c.role].en.toUpperCase()}</tspan>
          </text>
          <text x={c.x} y={vb.y + 47} textAnchor="middle" className="topo-col-zh">{ROLES[c.role].name}</text>
        </g>
      ))}

      {dropPt && (() => {
        const r = roleForX(dropPt.x)
        return (
          <g className="topo-drop" style={{ ['--c' as string]: ROLES[r].color }}>
            <rect x={COL_X[r] - 80} y={vb.y + 8} width={160} height={vb.h - 16} rx={22} />
            <text x={COL_X[r]} y={vb.y + vb.h - 22} textAnchor="middle">放下作为「{ROLES[r].name}」</text>
            <circle cx={clampX(dropPt.x)} cy={clampY(dropPt.y)} r={NODE_R} className="topo-drop-ghost" />
          </g>
        )
      })()}

      {/* 线路 */}
      {topo.links.map((l) => {
        const a = byId.get(l.from)
        const b = byId.get(l.to)
        if (!a || !b) return null
        const g = linkPath(a, b, bends.get(l.id) || 0)
        const down = state(a) === 'offline' || state(b) === 'offline'
        const kind = KINDS[l.kind] || KINDS.normal
        const dim = hl && !hl.links.has(l.id)
        const on = hl?.links.has(l.id)
        const sel = selected?.link === l.id
        const dur = Math.min(6, Math.max(2, g.length / (l.kind === 'premium' ? 170 : 115)))
        const comet = !reduced && !down && l.kind !== 'backup'
        const anim = { animationDuration: `${dur}s`, animationDelay: `${-seed(l.id) * dur}s` }
        return (
          <g key={l.id} className={clsx('topo-link', `k-${l.kind}`, down && 'down', dim && 'dim', on && 'on', sel && 'sel')}
            style={{ ['--c' as string]: down ? 'var(--bad)' : kind.color, ['--grad' as string]: `url(#tg-${l.id})` }}>
            <path className="tl-glow" d={g.d} />
            <path className="tl-base" d={g.d} />
            {l.kind === 'premium' && !down && <path className="tl-core" d={g.d} />}
            {comet && <path className="tl-tail" d={g.d} pathLength={100} style={anim} />}
            {comet && <path className="tl-head" d={g.d} pathLength={100} style={anim} />}
            <path
              className="tl-hit"
              d={g.d}
              onPointerEnter={() => setHover({ link: l.id })}
              onPointerLeave={() => setHover(null)}
              onClick={(e) => { e.stopPropagation(); onSelect?.({ link: l.id }) }}
            />
            {l.label && <text className="tl-label" x={g.mid.x} y={g.mid.y - 7} textAnchor="middle">{l.label}</text>}
          </g>
        )
      })}

      {from && pointer && <line className="topo-rubber" x1={from.x} y1={from.y} x2={pointer.x} y2={pointer.y} />}

      {/* 节点 */}
      {topo.nodes.map((n) => {
        const st = state(n)
        const s = n.server_id ? live?.get(n.server_id) : undefined
        const role = ROLES[n.role] || ROLES.relay
        const dim = hl && !hl.nodes.has(n.id)
        const sel = selected?.node === n.id || connectFrom === n.id
        const flag = n.region ? flags[n.region.toLowerCase()] : undefined
        const sub = st === 'online' && s
          ? `↑${fmtSpeed(s.state?.net_out_speed)}  ↓${fmtSpeed(s.state?.net_in_speed)}`
          : st === 'offline' ? 'OFFLINE' : [role.en.toUpperCase(), n.region].filter(Boolean).join(' · ')
        return (
          <g
            key={n.id}
            className={clsx('topo-node', `r-${n.role}`, `s-${st}`, dim && 'dim', sel && 'sel')}
            transform={`translate(${n.x},${n.y})`}
            style={{ ['--c' as string]: role.color }}
            onPointerDown={(e) => onNodeDown(e, n)}
            onPointerMove={onNodeMove}
            onPointerUp={(e) => onNodeUp(e, n)}
            onPointerEnter={() => !drag.current && setHover({ node: n.id })}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => e.stopPropagation()}
          >
            <title>{[n.label, role.name, n.region, n.note].filter(Boolean).join(' · ')}</title>
            <rect className="tn-hit" x={-80} y={-NODE_R - 12} width={160} height={NODE_R * 2 + LABEL_H + 16} rx={20} />
            <circle className="tn-aura" r={NODE_R + 16} />
            {st === 'online' && !reduced && <circle className="tn-pulse" r={NODE_R + 2} />}
            <circle className="tn-orbit" r={NODE_R + 6} />
            <circle className="tn-core" r={NODE_R} />
            <circle className="tn-tint" r={NODE_R} />
            {flag ? (
              <>
                <image href={flag} x={-(NODE_R - 7) * 4 / 3} y={-(NODE_R - 7)} width={(NODE_R - 7) * 8 / 3} height={(NODE_R - 7) * 2} preserveAspectRatio="xMidYMid slice" clipPath="url(#topo-flag-clip)" />
                <circle className="tn-flag-ring" r={NODE_R - 7} />
              </>
            ) : (
              <path className="tn-glyph" d={GLYPH[n.role] || GLYPH.relay} transform="translate(-10.8,-10.8) scale(.9)" />
            )}
            {st !== 'none' && <circle className={clsx('tn-status', st)} cx={NODE_R * 0.72} cy={-NODE_R * 0.72} r={4.6} />}
            <text className="tn-label" y={NODE_R + 21} textAnchor="middle">{fitText(n.label, 13, 150)}</text>
            <text className={clsx('tn-sub', st === 'offline' && 'bad', st === 'online' && 'live')} y={NODE_R + 36} textAnchor="middle">{fitText(sub, 10, 150)}</text>
          </g>
        )
      })}
    </svg>
  )
}
