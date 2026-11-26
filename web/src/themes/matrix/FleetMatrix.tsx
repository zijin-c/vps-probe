// 首页右侧：每台服务器一行，三网延迟取平均，画成 24 小时热力矩阵
import { useNavigate } from 'react-router-dom'
import { Flag } from '../../components/brand'
import { clsx } from '../../lib/format'
import type { LatencyLine, LiveServer } from '../../lib/hooks'
import LatencyMatrix, { type MatrixRow } from './LatencyMatrix'
import { regionBaseline, toneOfMs } from './shared'

const MAX_ROWS = 7

/** 把同一台服务器的多条线路按时间对齐（尾部对齐）后取平均；全部超时记为 null */
function combine(lines: LatencyLine[]): (number | null)[] {
  const len = Math.max(0, ...lines.map((l) => l.delays.length))
  const out: (number | null)[] = []
  for (let i = 0; i < len; i++) {
    const vs = lines.map((l) => l.delays[l.delays.length - len + i]).filter((x) => x !== undefined)
    const ok = vs.filter((x): x is number => x != null)
    out.push(ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : vs.length ? null : null)
  }
  return out
}

export default function FleetMatrix({ servers, byServer }: { servers: LiveServer[]; byServer: Map<number, LatencyLine[]> }) {
  const nav = useNavigate()
  const ordered = [...servers.filter((s) => s.online), ...servers.filter((s) => !s.online)]
  const monitored = ordered.filter((s) => (byServer.get(s.id) || []).length)
  // 有监控的排前面，没监控的也列出（灰格），超过 MAX_ROWS 行时矩阵内部滚动
  const list = [...monitored, ...ordered.filter((s) => !monitored.includes(s))]
  const lineCount = monitored.reduce((a, s) => a + (byServer.get(s.id)?.length || 0), 0)

  const rows: MatrixRow[] = list.map((s) => {
    const lines = byServer.get(s.id) || []
    const vals = combine(lines)
    const base = regionBaseline(s.country_code).base
    const latest = lines.length ? (() => {
      const ls = lines.map((l) => l.latest).filter((x): x is number => x != null)
      return ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : null
    })() : undefined
    return {
      key: s.id,
      base,
      values: vals,
      title: `${s.name}${lines.length ? ` · ${lines.length} 条线路平均` : ' · 未配置延迟监控'}`,
      onClick: () => nav(`/server/${s.id}`),
      label: <><Flag code={s.country_code} className="lm-flag" /><span className={clsx('lm-name', !s.online && 'off')}>{s.name}</span></>,
      stat: !s.online
        ? <span className="bad">离线</span>
        : latest === undefined ? <span className="faint">—</span>
        : latest === null ? <span className="bad">超时</span>
        : <span className={toneOfMs(latest, base)}>{latest < 10 ? latest.toFixed(1) : Math.round(latest)}<small>ms</small></span>,
    }
  })

  return (
    <div className="fm">
      <div className="fm-h">
        <span className="eyebrow">Latency matrix<span className="sep">/</span>三网延迟</span>
        <span className="fm-meta"><i className="fm-live" />{lineCount ? `${list.length} 台 · ${lineCount} 条监控 · 近 24 小时` : '尚未配置延迟监控'}</span>
      </div>
      <LatencyMatrix rows={rows} empty="暂无服务器" maxRows={MAX_ROWS} />
    </div>
  )
}
