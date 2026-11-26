import { useEffect, useState, type ReactNode } from 'react'
import { LineChart, seriesColor, type Series } from './Chart'
import { Seg, useToast } from './ui'
import { api, getMetric, type MetricSeries, type QualityPart, type QualityReport } from '../lib/api'
import { bytesParts, fmtAgo, pct } from '../lib/format'
import { useNow, type LatencyLine } from '../lib/hooks'

export type Period = '1d' | '7d' | '30d'
type Tab = 'latency' | 'cpu' | 'mem' | 'disk' | 'net' | 'load' | 'conn'

export const PART_NAMES: Record<QualityPart, string> = { ip: 'IP 质量', unlock: '流媒体解锁', route: '三网回程' }

/** 分区标题右侧：上次检测时间 / 排队 / 检测中 + 管理员的重新检测按钮 */
export function PartStatus({ part, id, report, reload, signedIn }: { part: QualityPart; id: number; report?: QualityReport; reload: () => void; signedIn: boolean }) {
  const toast = useToast()
  const now = useNow(1000)
  const running = report?.status?.running?.includes(part)
  const pending = report?.status?.pending?.includes(part)
  const at = report?.parts_at?.[part]
  const trigger = async () => {
    try {
      await api(`/probe/quality/${id}/refresh`, { method: 'POST', body: { parts: [part] } })
      toast(`已请求检测${PART_NAMES[part]}，Agent 会在 1 分钟内开始`, 'ok')
      reload()
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }
  let status: ReactNode = null
  if (running) {
    const secs = report?.status?.since ? Math.max(0, Math.round((now - Date.parse(report.status.since)) / 1000)) : 0
    status = <span className="running"><span className="spinner" />检测中 · {secs} 秒</span>
  } else if (pending) {
    status = <span className="running"><span className="spinner" />排队中，等待 Agent 领取</span>
  } else if (at) {
    status = <span className="hint">检测于 {fmtAgo(at, now)}</span>
  }
  return (
    <>
      {status}
      <span className="spacer" />
      {signedIn && !running && !pending && (
        <button className="btn xs" onClick={trigger}>{at ? '重新检测' : '开始检测'}</button>
      )}
    </>
  )
}

// ---------- 历史图表 ----------

const TABS: { value: Tab; label: string }[] = [
  { value: 'latency', label: '延迟' }, { value: 'cpu', label: 'CPU' }, { value: 'mem', label: '内存' },
  { value: 'disk', label: '硬盘' }, { value: 'net', label: '网速' }, { value: 'load', label: '负载' }, { value: 'conn', label: '连接' },
]

const METRICS: Record<Exclude<Tab, 'latency'>, { names: { m: string; label: string }[]; kind: 'pct' | 'bytes-pct' | 'speed' | 'num' }> = {
  cpu: { names: [{ m: 'cpu', label: 'CPU' }], kind: 'pct' },
  mem: { names: [{ m: 'memory', label: '内存' }], kind: 'bytes-pct' },
  disk: { names: [{ m: 'disk', label: '硬盘' }], kind: 'bytes-pct' },
  net: { names: [{ m: 'net_out_speed', label: '上行' }, { m: 'net_in_speed', label: '下行' }], kind: 'speed' },
  load: { names: [{ m: 'load1', label: '1 分钟' }, { m: 'load5', label: '5 分钟' }, { m: 'load15', label: '15 分钟' }], kind: 'num' },
  conn: { names: [{ m: 'tcp_conn', label: 'TCP' }, { m: 'udp_conn', label: 'UDP' }, { m: 'process_count', label: '进程' }], kind: 'num' },
}

export function HistoryPanel({ id, lines, period, setPeriod, signedIn, memTotal, diskTotal, tsdb }: {
  id: number; lines: LatencyLine[]; period: Period; setPeriod: (p: Period) => void; signedIn: boolean
  memTotal?: number; diskTotal?: number; tsdb: boolean
}) {
  const [tab, setTab] = useState<Tab>('latency')
  const [smooth, setSmooth] = useState(() => { try { return localStorage.getItem('probe-smooth') === '1' } catch { return false } })
  const toggleSmooth = (v: boolean) => { setSmooth(v); try { localStorage.setItem('probe-smooth', v ? '1' : '0') } catch { /* ignore */ } }
  return (
    <div className="glass chart-card">
      <div className="chart-head">
        <Seg className="scroll" value={tab} onChange={setTab} options={TABS} />
        <span className="spacer" />
        {tab === 'latency' && (
          <label className="check" style={{ fontSize: 12.5 }} title="去掉偶发的尖峰，便于看趋势">
            <input type="checkbox" checked={smooth} onChange={(e) => toggleSmooth(e.target.checked)} />削峰
          </label>
        )}
        {signedIn
          ? <Seg value={period} onChange={setPeriod} options={[{ value: '1d', label: '24h' }, { value: '7d', label: '7 天' }, { value: '30d', label: '30 天' }]} />
          : <span className="faint" style={{ fontSize: 12 }}>访客可查看 24 小时</span>}
      </div>
      <div className="chart-body">
        {tab === 'latency'
          ? <LineChart height={230} format={(v) => `${Math.round(v)}ms`} series={lines.map((l, i) => ({
              name: l.name, color: seriesColor(i), points: (smooth ? peakCut(l.delays) : l.delays).map((v, k) => ({ t: l.ts[k], v })),
            }))} />
          : <MetricChart key={`${tab}-${period}`} id={id} tab={tab} period={period} memTotal={memTotal} diskTotal={diskTotal} tsdb={tsdb} />}
      </div>
    </div>
  )
}

/** 削峰：用 11 点滑动中位数剔除离群尖峰，再做 EWMA(α=0.3) 平滑；不可达点保持为空 */
function peakCut(values: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = values.map((v, i) => {
    if (v == null) return null
    const win = values.slice(Math.max(0, i - 5), i + 6).filter((x): x is number => x != null).sort((a, b) => a - b)
    const med = win[Math.floor(win.length / 2)]
    return med != null && v > med * 1.8 && v - med > 15 ? med : v
  })
  let ema: number | null = null
  return out.map((v) => {
    if (v == null) { ema = null; return null }
    ema = ema == null ? v : 0.3 * v + 0.7 * ema
    return ema
  })
}

function MetricChart({ id, tab, period, memTotal, diskTotal, tsdb }: {
  id: number; tab: Exclude<Tab, 'latency'>; period: Period; memTotal?: number; diskTotal?: number; tsdb: boolean
}) {
  const toast = useToast()
  const [data, setData] = useState<MetricSeries[] | null>(null)
  const def = METRICS[tab]
  useEffect(() => {
    if (!tsdb) return
    let alive = true
    Promise.all(def.names.map((n) => getMetric(id, n.m, period)))
      .then((r) => alive && setData(r))
      .catch((e) => { if (alive) { setData([]); toast(e.message, 'err') } })
    return () => { alive = false }
  }, [id, tab, period, tsdb]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!tsdb) return <div className="empty" style={{ padding: 32 }}>面板未开启历史数据。管理员可在后台「主题与外观 → 历史数据」一键开启。</div>
  if (!data) return <div style={{ height: 230 }} />
  const total = tab === 'mem' ? memTotal : diskTotal
  const series: Series[] = data.map((d, i) => ({
    name: def.names[i].label,
    color: tab === 'net' ? (i ? seriesColor(0) : seriesColor(1)) : seriesColor(i),
    points: (d?.data_points || []).map((p) => ({ t: p.ts, v: def.kind === 'bytes-pct' ? pct(p.value, total) : p.value })),
  }))
  const format = def.kind === 'speed' ? (v: number) => { const [n, u] = bytesParts(v, 0); return `${n}${u}` }
    : def.kind === 'num' ? (v: number) => (v < 10 ? v.toFixed(1) : v.toFixed(0)) : (v: number) => `${Math.round(v)}%`
  return <LineChart series={series} height={230} format={format} area={series.length === 1} yMax={def.kind === 'pct' || def.kind === 'bytes-pct' ? 100 : undefined} />
}


export const FLAG_NAMES: Record<string, string> = { proxy: '代理', vpn: 'VPN', tor: 'Tor', hosting: '机房', abuser: '滥用记录', bot: '爬虫', crawler: '爬虫', relay: '中继' }

export function riskTone(score?: number | null, label?: string): string {
  const l = label || ''
  if (/极高|高|封禁|High/i.test(l) && !/低/.test(l)) return 'bad'
  if (/中|可疑|Elevated|Medium/i.test(l)) return 'warn'
  if (score != null) return score >= 66 ? 'bad' : score >= 33 ? 'warn' : 'ok'
  return 'ok'
}

export const UNLOCK_LOGO: Record<string, { t: string; c: string }> = {
  Netflix: { t: 'N', c: '#e50914' }, 'YouTube Premium': { t: '▶', c: '#ff0033' }, 'Disney+': { t: 'D+', c: '#3d7bff' },
  'Prime Video': { t: 'P', c: '#1fa1f1' }, TikTok: { t: '♪', c: '#25f4ee' }, ChatGPT: { t: 'AI', c: '#10a37f' }, Reddit: { t: 'R', c: '#ff4500' },
}
