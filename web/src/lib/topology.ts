// 网络出口拓扑：数据结构、角色/线路样式元数据与几何计算（前台展示与后台编辑共用）。

export type TopoRole = 'client' | 'entry' | 'relay' | 'exit' | 'target'
export type TopoKind = 'premium' | 'normal' | 'tunnel' | 'backup'

export interface TopoNode {
  id: string
  label: string
  role: TopoRole
  server_id?: number
  region?: string
  note?: string
  x: number
  y: number
}

export interface TopoLink {
  id: string
  from: string
  to: string
  label?: string
  kind: TopoKind
  note?: string
  /** 类型与标注由探针检测结果自动识别（手动修改后变为 false） */
  auto?: boolean
}

export interface Topology {
  title?: string
  desc?: string
  nodes: TopoNode[]
  links: TopoLink[]
  updated_at?: string
}

export const CANVAS_W = 1200
export const CANVAS_H = 720
/** 节点（圆形站点）半径 */
export const NODE_R = 26
/** 标签在节点下方占用的高度 */
export const LABEL_H = 40

/** 从左到右的流向顺序 */
export const ROLE_ORDER: TopoRole[] = ['client', 'entry', 'relay', 'exit', 'target']

export const ROLES: Record<TopoRole, { name: string; en: string; color: string; desc: string }> = {
  client: { name: '用户端', en: 'Client', color: 'var(--fg-2)', desc: '用户 / 本地网络' },
  entry: { name: '入口', en: 'Ingress', color: 'var(--info)', desc: '流量接入点' },
  relay: { name: '中转', en: 'Relay', color: 'var(--violet)', desc: '隧道 / 专线中转' },
  exit: { name: '出口', en: 'Egress', color: 'var(--ok)', desc: '落地机，最终出网的 IP' },
  target: { name: '目标', en: 'Target', color: 'var(--gold)', desc: '互联网 / 目标服务' },
}

export const KINDS: Record<TopoKind, { name: string; color: string; desc: string }> = {
  premium: { name: '精品专线', color: 'var(--gold)', desc: 'IPLC / IEPL / CN2 GIA 等' },
  normal: { name: '普通线路', color: 'var(--info)', desc: '公网直连' },
  tunnel: { name: '隧道', color: 'var(--violet)', desc: 'WireGuard / GRE / 加密隧道' },
  backup: { name: '备用', color: 'var(--muted)', desc: '故障切换用的备用线路' },
}

export const emptyTopology = (): Topology => ({ nodes: [], links: [] })

export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const MARGIN_X = 90
export const clampX = (x: number) => Math.min(CANVAS_W - MARGIN_X, Math.max(MARGIN_X, x))
export const clampY = (y: number) => Math.min(CANVAS_H - NODE_R - LABEL_H - 10, Math.max(NODE_R + 60, y))

/** 五个角色固定的列位置（编辑器的列参考线、拖入时按位置判断角色、自动排列都用它） */
const COL_PAD = 130
export const COL_X: Record<TopoRole, number> = Object.fromEntries(
  ROLE_ORDER.map((r, i) => [r, Math.round(COL_PAD + (i * (CANVAS_W - COL_PAD * 2)) / (ROLE_ORDER.length - 1))]),
) as Record<TopoRole, number>

/** 按横坐标判断属于哪一列（拖入服务器时自动决定角色） */
export function roleForX(x: number): TopoRole {
  let best: TopoRole = 'exit'
  for (const r of ROLE_ORDER) if (Math.abs(COL_X[r] - x) < Math.abs(COL_X[best] - x)) best = r
  return best
}

/** 按角色分列自动排布：列从左到右为 用户端 → 入口 → 中转 → 出口 → 目标，列内保持原有上下顺序 */
export function autoLayout(t: Topology): Topology {
  const pos = new Map<string, { x: number; y: number }>()
  for (const r of ROLE_ORDER) {
    const col = t.nodes.filter((n) => n.role === r).sort((a, b) => a.y - b.y)
    const top = 120
    const span = CANVAS_H - top - 90
    const step = col.length > 1 ? Math.min(150, span / (col.length - 1)) : 0
    const start = top + (span - step * (col.length - 1)) / 2
    col.forEach((n, i) => pos.set(n.id, { x: COL_X[r], y: Math.round(start + step * i) }))
  }
  return { ...t, nodes: t.nodes.map((n) => ({ ...n, ...pos.get(n.id)! })) }
}

/** 探针对某台服务器的线路检测摘要（与 QualityBrief 的 routes / inbound 结构一致） */
export interface RouteBrief {
  routes?: Record<string, { label: string; premium?: boolean }>
  inbound?: Record<string, { label: string; premium?: boolean; guess?: boolean }>
}

export interface DetectedRoute { kind: TopoKind; label?: string; source: string }

/**
 * 根据探针检测结果识别一条线路的类型与标注。
 * 看下游节点（流量进入它的那台服务器）的检测结果；下游不是服务器（例如「互联网」）时看上游，即出口自身的线路。
 *   去程实测 / BGP 推断 > 回程检测 > 服务器备注里手填的线路；有精品网（CN2 GIA / 9929 / CMIN2 …）即判为精品专线。
 */
export function detectRoute(
  from: TopoNode, to: TopoNode,
  briefs: Record<string, RouteBrief | undefined>,
  manualRoute: (serverId: number) => string | undefined,
  nameOf: (n: TopoNode) => string,
): DetectedRoute | null {
  const n = to.server_id ? to : from.server_id ? from : null
  if (n?.server_id) {
    const b = briefs[String(n.server_id)]
    const sets: { items: { label: string; premium?: boolean; guess?: boolean }[]; what: string }[] = [
      { items: Object.values(b?.inbound || {}).filter((x) => !x.guess), what: '去程检测' },
      { items: Object.values(b?.routes || {}), what: '回程检测' },
    ]
    for (const { items, what } of sets) {
      const labels = items.filter((x) => x.label)
      if (!labels.length) continue
      const premium = [...new Set(labels.filter((x) => x.premium).map((x) => x.label))]
      const pick = premium.length ? premium : [...new Set(labels.map((x) => x.label))]
      return { kind: premium.length ? 'premium' : 'normal', label: pick.slice(0, 2).join(' / '), source: `${nameOf(n)} 的${what}` }
    }
    const manual = manualRoute(n.server_id)?.trim()
    if (manual) {
      const premium = /cn2|gia|9929|cmin2|iplc|iepl|精品|cugt|ctgnet/i.test(manual)
      return { kind: premium ? 'premium' : 'normal', label: manual.slice(0, 30), source: `${nameOf(n)} 备注的线路` }
    }
  }
  return null
}

/** 圆形节点上的连接点 + 出线方向；尽量从左右两侧出线，避开下方的文字 */
function anchor(n: TopoNode, toward: TopoNode): { x: number; y: number; nx: number; ny: number } {
  const dx = toward.x - n.x
  const dy = toward.y - n.y
  const gap = NODE_R + 5
  if (Math.abs(dx) >= Math.abs(dy) * 0.35) {
    const s = dx >= 0 ? 1 : -1
    return { x: n.x + s * gap, y: n.y, nx: s, ny: 0 }
  }
  if (dy < 0) return { x: n.x, y: n.y - gap, nx: 0, ny: -1 }
  return { x: n.x, y: n.y + gap + LABEL_H, nx: 0, ny: 1 }
}

export interface LinkGeom {
  d: string
  mid: { x: number; y: number }
  length: number
}

/** 两节点间的三次贝塞尔曲线；bend 用于同一对节点之间多条线路的错开 */
export function linkPath(a: TopoNode, b: TopoNode, bend = 0): LinkGeom {
  const p = anchor(a, b)
  const q = anchor(b, a)
  const dist = Math.hypot(q.x - p.x, q.y - p.y)
  const k = Math.max(40, dist * 0.45)
  // 垂直于连线方向的偏移
  const ux = (q.x - p.x) / (dist || 1)
  const uy = (q.y - p.y) / (dist || 1)
  const ox = -uy * bend
  const oy = ux * bend
  const c1 = { x: p.x + p.nx * k + ox, y: p.y + p.ny * k + oy }
  const c2 = { x: q.x + q.nx * k + ox, y: q.y + q.ny * k + oy }
  const t = 0.5
  const mt = 1 - t
  const mid = {
    x: mt ** 3 * p.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * q.x,
    y: mt ** 3 * p.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * q.y,
  }
  const f = (v: number) => Math.round(v * 10) / 10
  return {
    d: `M${f(p.x)},${f(p.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(q.x)},${f(q.y)}`,
    mid,
    length: dist + k * 0.6,
  }
}

/** 同一对节点之间多条线路时各自的弯曲量 */
export function linkBends(links: TopoLink[]): Map<string, number> {
  const groups = new Map<string, TopoLink[]>()
  for (const l of links) {
    const key = [l.from, l.to].sort().join('|')
    groups.set(key, [...(groups.get(key) || []), l])
  }
  const out = new Map<string, number>()
  for (const g of groups.values()) {
    g.forEach((l, i) => {
      const off = (i - (g.length - 1) / 2) * 26
      // 方向相反的线路，垂线方向也相反，需要翻转才能真正错开
      out.set(l.id, l.from < l.to ? off : -off)
    })
  }
  return out
}

/** 与某节点 / 线路相连的整条链路（上下游全部），用于悬停高亮 */
export function connected(t: Topology, focus: { node?: string; link?: string }): { nodes: Set<string>; links: Set<string> } {
  const nodes = new Set<string>()
  const links = new Set<string>()
  const out = new Map<string, TopoLink[]>()
  const inc = new Map<string, TopoLink[]>()
  for (const l of t.links) {
    out.set(l.from, [...(out.get(l.from) || []), l])
    inc.set(l.to, [...(inc.get(l.to) || []), l])
  }
  const walk = (start: string, adj: Map<string, TopoLink[]>, next: (l: TopoLink) => string) => {
    const stack = [start]
    const seen = new Set<string>([start])
    while (stack.length) {
      const id = stack.pop()!
      nodes.add(id)
      for (const l of adj.get(id) || []) {
        links.add(l.id)
        const n = next(l)
        if (!seen.has(n)) { seen.add(n); stack.push(n) }
      }
    }
  }
  if (focus.node) {
    walk(focus.node, out, (l) => l.to)
    walk(focus.node, inc, (l) => l.from)
  } else if (focus.link) {
    const l = t.links.find((x) => x.id === focus.link)
    if (l) {
      links.add(l.id)
      walk(l.to, out, (x) => x.to)
      walk(l.from, inc, (x) => x.from)
    }
  }
  return { nodes, links }
}

/** 列出从起点（无入边）到终点（无出边）的全部路径，用于前台的"路径清单" */
export function enumeratePaths(t: Topology, limit = 60): { nodes: string[]; links: string[] }[] {
  const out = new Map<string, TopoLink[]>()
  const hasIn = new Set<string>()
  for (const l of t.links) {
    out.set(l.from, [...(out.get(l.from) || []), l])
    hasIn.add(l.to)
  }
  const starts = t.nodes.filter((n) => !hasIn.has(n.id) && out.has(n.id))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.y - b.y)
  const res: { nodes: string[]; links: string[] }[] = []
  const dfs = (id: string, nodes: string[], links: string[]) => {
    if (res.length >= limit) return
    const next = (out.get(id) || []).filter((l) => !nodes.includes(l.to))
    if (!next.length) {
      if (links.length) res.push({ nodes, links })
      return
    }
    for (const l of next) dfs(l.to, [...nodes, l.to], [...links, l.id])
  }
  for (const s of starts) dfs(s.id, [s.id], [])
  return res
}

/** SVG 文本宽度估算（中日韩字符按全宽） */
export function textWidth(s: string, size: number): number {
  let w = 0
  for (const ch of s) w += /[⺀-￿]/.test(ch) ? size : size * 0.6
  return w
}

export function fitText(s: string, size: number, max: number): string {
  if (textWidth(s, size) <= max) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > max) break
    out += ch
  }
  return out + '…'
}
