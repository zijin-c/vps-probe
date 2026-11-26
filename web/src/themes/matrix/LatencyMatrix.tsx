// 矩阵主题的标志性图形：延迟热力矩阵
// 每行一条线路（或一台服务器），每格是一段时间的平均延迟；颜色深浅 = 相对本行的快慢，红格 = 整段超时
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from '../../lib/format'
import { toneOfMs } from './shared'

export interface MatrixRow {
  key: string | number
  label: ReactNode
  values: (number | null)[]
  base: number
  stat?: ReactNode
  title?: string
  onClick?: () => void
}

type Cell = { v: number | null; kind: 'empty' | 'loss' | 'val'; cnt: number }

function bucketize(values: (number | null)[], n: number): Cell[] {
  const L = values.length
  if (!L) return Array.from({ length: n }, () => ({ v: null, kind: 'empty', cnt: 0 }))
  if (L <= n) {
    const pad: Cell[] = Array.from({ length: n - L }, () => ({ v: null, kind: 'empty', cnt: 0 }))
    return [...pad, ...values.map((v): Cell => (v == null ? { v: null, kind: 'loss', cnt: 1 } : { v, kind: 'val', cnt: 1 }))]
  }
  const out: Cell[] = []
  for (let i = 0; i < n; i++) {
    const seg = values.slice(Math.floor((i * L) / n), Math.floor(((i + 1) * L) / n))
    const ok = seg.filter((x): x is number => x != null)
    out.push(ok.length ? { v: ok.reduce((a, b) => a + b, 0) / ok.length, kind: 'val', cnt: seg.length } : { v: null, kind: seg.length ? 'loss' : 'empty', cnt: seg.length })
  }
  return out
}

/** 根据容器宽度决定列数，每格约 9px */
function useColumns(min = 12, max = 96, cell = 9) {
  const ref = useRef<HTMLDivElement>(null)
  const [n, setN] = useState(48)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width
      setN(Math.max(min, Math.min(max, Math.floor(w / cell))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [min, max, cell])
  return [ref, n] as const
}

/** maxRows：超过这么多行时固定高度、内部滚动，避免服务器很多时把页面撑得很高 */
export default function LatencyMatrix({ rows, spanHours = 24, empty, maxRows }: { rows: MatrixRow[]; spanHours?: number; empty?: ReactNode; maxRows?: number }) {
  const [ref, n] = useColumns()
  const ticks = n < 32 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="lm">
      <div className="lm-grid">
        <div className={clsx('lm-body', !!maxRows && rows.length > maxRows && 'scroll')} style={maxRows ? { ['--rows' as string]: maxRows } : undefined}>
        {rows.map((r) => {
          const cells = bucketize(r.values, n)
          const vals = cells.filter((c) => c.kind === 'val').map((c) => c.v as number)
          const lo = vals.length ? Math.min(...vals) : 0
          const hi = vals.length ? Math.max(...vals) : 1
          return (
            <div key={r.key} className={clsx('lm-row', r.onClick && 'can')} onClick={r.onClick} title={r.title}>
              <span className="lm-label">{r.label}</span>
              <span className="lm-cells" style={{ ['--n' as string]: n }}>
                {cells.map((c, i) => {
                  if (c.kind !== 'val') return <i key={i} className={c.kind === 'loss' ? 'x' : ''} />
                  const tone = toneOfMs(c.v, r.base)
                  const lvl = hi - lo < 0.5 ? 2 : 1 + Math.round(((c.v! - lo) / (hi - lo)) * 3)
                  return <i key={i} className={clsx(tone, `l${lvl}`)} title={`${c.v!.toFixed(c.v! < 10 ? 1 : 0)} ms`} />
                })}
              </span>
              <span className="lm-stat">{r.stat}</span>
            </div>
          )
        })}
        </div>
        {!rows.length && empty && <div className="lm-empty">{empty}</div>}
        <div className="lm-row lm-axis" aria-hidden="true">
          <span className="lm-label" />
          <span className="lm-ticks" ref={ref}>
            {ticks.map((t) => (
              <i key={t} style={{ left: `${t * 100}%` }}>{t === 1 ? '现在' : spanHours >= 72 ? `-${Math.round((spanHours * (1 - t)) / 24)}d` : `-${Math.round(spanHours * (1 - t))}h`}</i>
            ))}
          </span>
          <span className="lm-stat" />
        </div>
      </div>
      <div className="lm-legend">
        <span>快</span>
        <i className="ok l1" /><i className="ok l2" /><i className="ok l3" /><i className="ok l4" />
        <span>慢</span>
        <i className="warn l3" /><span>偏高</span>
        <i className="x" /><span>超时</span>
      </div>
    </div>
  )
}
