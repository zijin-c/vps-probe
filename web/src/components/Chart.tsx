import { useMemo, useRef, useState } from 'react'
import { fmtAxisTime, fmtTipTime } from '../lib/format'

export interface Series {
  name: string
  color: string
  points: { t: number; v: number | null }[]
}

// 矿物色系：在暖灰底上互相区分、明暗两套主题都可读
const PALETTE = ['#e0763a', '#4fa58a', '#7d8fd6', '#d1a33f', '#c06a8f', '#5aa9b8']
export const seriesColor = (i: number) => PALETTE[i % PALETTE.length]

/** 多序列折线图（SVG），悬停显示数值，点击图例可隐藏序列 */
export function LineChart({ series, height = 220, format, yMax, area }: {
  series: Series[]
  height?: number
  format: (v: number) => string
  yMax?: number
  area?: boolean
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<{ px: number; t: number } | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const W = 1000
  const H = height
  const P = { l: 0, r: 4, t: 8, b: 22 }
  const GUTTER = 50

  const visible = useMemo(() => series.filter((s) => !hidden.has(s.name)), [series, hidden])
  const { tMin, tMax, vMax } = useMemo(() => {
    let tMin = Infinity, tMax = -Infinity, vMax = 0
    for (const s of visible) for (const p of s.points) {
      if (p.t < tMin) tMin = p.t
      if (p.t > tMax) tMax = p.t
      if (p.v != null && p.v > vMax) vMax = p.v
    }
    if (!isFinite(tMin)) { tMax = Date.now(); tMin = tMax - 3600e3 }
    if (tMax === tMin) tMax = tMin + 60e3
    return { tMin, tMax, vMax: yMax ?? niceMax(vMax) }
  }, [visible, yMax])

  const x = (t: number) => P.l + ((t - tMin) / (tMax - tMin)) * (W - P.l - P.r)
  const y = (v: number) => P.t + (1 - v / (vMax || 1)) * (H - P.t - P.b)
  const span = tMax - tMin

  const paths = visible.map((s) => {
    let d = ''
    let a = ''
    let pen = false
    let segStart = 0
    let lastX = 0
    for (const p of s.points) {
      if (p.v == null) {
        if (pen && area) a += `L${lastX},${y(0)}L${segStart},${y(0)}Z`
        pen = false
        continue
      }
      const px = x(p.t).toFixed(1), py = y(p.v).toFixed(1)
      if (!pen) segStart = +px
      d += `${pen ? 'L' : 'M'}${px},${py}`
      if (area) a += `${pen ? 'L' : 'M'}${px},${py}`
      lastX = +px
      pen = true
    }
    if (pen && area) a += `L${lastX},${y(0)}L${segStart},${y(0)}Z`
    return { s, d, a }
  })

  const ticksY = [0, 0.5, 1].map((f) => f * vMax)
  const ticksX = Array.from({ length: 5 }, (_, i) => tMin + (span * i) / 4)

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const vx = ((e.clientX - r.left) / r.width) * W
    if (vx < P.l || vx > W - P.r) return setHover(null)
    setHover({ px: e.clientX - r.left, t: tMin + ((vx - P.l) / (W - P.l - P.r)) * span })
  }

  const rows = hover
    ? visible.map((s) => {
        let best: { t: number; v: number | null } | undefined
        for (const p of s.points) if (!best || Math.abs(p.t - hover.t) < Math.abs(best.t - hover.t)) best = p
        return { s, p: best }
      }).filter((r) => r.p && r.p.v != null)
    : []
  const empty = series.every((s) => s.points.length === 0)
  const boxW = ref.current?.clientWidth || 600

  return (
    <div className="chart-wrap">
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name} className={hidden.has(s.name) ? 'off' : ''} onClick={() => setHidden((h) => {
              const n = new Set(h)
              if (n.has(s.name)) n.delete(s.name); else n.add(s.name)
              return n
            })}>
              <i style={{ background: s.color }} />{s.name}
            </span>
          ))}
        </div>
      )}
      <div style={{ position: 'relative', paddingLeft: GUTTER }}>
        {/* 坐标文字用 HTML 叠放，避免 SVG 横向拉伸后字体变形 */}
        {ticksY.map((v, i) => (
          <span key={i} className="faint tnum" style={{ position: 'absolute', left: 0, top: y(v) - 8, fontSize: 11, width: GUTTER - 8, textAlign: 'right', whiteSpace: 'nowrap' }}>{format(v)}</span>
        ))}
        <div style={{ position: 'relative' }}>
          <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
            onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ display: 'block', touchAction: 'pan-y' }}>
            {ticksY.map((v, i) => (
              <line key={i} x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={i ? '2 4' : undefined} vectorEffect="non-scaling-stroke" />
            ))}
            {paths.map(({ s, a }) => area && a && <path key={`a-${s.name}`} d={a} fill={s.color} opacity={0.07} />)}
            {paths.map(({ s, d }) => <path key={s.name} d={d} fill="none" stroke={s.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
            {hover && <line x1={x(hover.t)} x2={x(hover.t)} y1={P.t} y2={H - P.b} stroke="var(--line-strong)" vectorEffect="non-scaling-stroke" />}
          </svg>
          {ticksX.map((t, i) => (
            <span key={i} className="faint tnum" style={{
              position: 'absolute', bottom: 2, fontSize: 11, whiteSpace: 'nowrap',
              left: `${(x(t) / W) * 100}%`, transform: i === 0 ? 'none' : i === 4 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}>{fmtAxisTime(t, span)}</span>
          ))}
          {hover && rows.length > 0 && (
            <div className="tip float" style={{ left: hover.px + 190 > boxW ? hover.px - 184 : hover.px + 14, top: 6 }}>
              <div className="faint" style={{ marginBottom: 4 }}>{fmtTipTime(rows[0].p!.t)}</div>
              {rows.map(({ s, p }) => (
                <div key={s.name} className="row" style={{ gap: 8 }}>
                  <i style={{ width: 7, height: 7, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                  <span style={{ flex: 1, color: 'var(--fg-2)' }}>{s.name}</span>
                  <b>{format(p!.v!)}</b>
                </div>
              ))}
            </div>
          )}
          {empty && <div className="faint" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 13 }}>暂无数据</div>}
        </div>
      </div>
    </div>
  )
}

function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p
  return 10 * p
}
