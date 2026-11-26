import { useNavigate } from 'react-router-dom'
import type { UnlockItem } from '../../lib/api'
import { priceText } from '../../lib/billing'
import { bytesParts, clsx, fmtAgo, fmtBytes, latencyTone, pct } from '../../lib/format'
import type { LatencyLine } from '../../lib/hooks'
import { coreCount, osLabel, CARRIERS } from '../../components/ServerCard'
import { Flag, OsLogo } from '../../components/brand'
import type { CardProps } from '../registry'

// ---------- 小工具 ----------

/** 27天18小时 / 5小时12分 / 12分 */
function fmtLongUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}天${h}小时`
  if (h > 0) return `${h}小时${m}分`
  return `${Math.max(1, m)}分`
}

const toneOfMs = (ms: number | null | undefined) => {
  const t = latencyTone(ms)
  return ms == null ? 'bad' : t === 'neutral' ? 'ok' : t
}

/** 方块进度条 */
function Blocks({ value, n = 30, tone }: { value: number; n?: number; tone?: string }) {
  const v = Math.max(0, Math.min(100, value))
  const lit = v > 0 ? Math.max(1, Math.round((v / 100) * n)) : 0
  const t = tone || (v >= 90 ? 'bad' : v >= 70 ? 'warn' : 'ok')
  return (
    <div className="mx-blocks" style={{ ['--n' as string]: n }} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < lit ? t : ''} />)}
    </div>
  )
}

/** 最近 n 次采样的柱状图：高度 = 延迟，颜色 = 快慢，超时为满高红柱 */
function Bars({ values, n = 28 }: { values: (number | null)[]; n?: number }) {
  const pts = values.slice(-n)
  const valid = pts.filter((x): x is number => x != null)
  const top = valid.length ? Math.max(...valid) * 1.15 : 1
  return (
    <div className="mx-bars" style={{ ['--n' as string]: n }} aria-hidden="true">
      {Array.from({ length: n - pts.length }, (_, i) => <i key={`p${i}`} />)}
      {pts.map((v, i) => (
        <i key={i} className={v == null ? 'bad' : toneOfMs(v)} style={{ height: v == null ? '100%' : `${Math.max(18, (v / top) * 100)}%` }} />
      ))}
    </div>
  )
}

/** 线路质量评分：平均延迟、丢包、抖动综合，0~100 */
function lineScore(l: LatencyLine) {
  const v = l.delays.slice(-30).filter((x): x is number => x != null)
  let jitter = 0
  for (let i = 1; i < v.length; i++) jitter += Math.abs(v[i] - v[i - 1])
  jitter = v.length > 1 ? jitter / (v.length - 1) : 0
  const score = Math.round(Math.max(0, Math.min(100,
    100 - Math.max(0, Math.min(55, (l.avg - 40) / 3.5)) - Math.min(40, l.loss * 6) - Math.min(20, jitter / 1.5))))
  return { score, jitter }
}
const scoreText = (s: number) => (s >= 85 ? '优' : s >= 70 ? '良' : s >= 50 ? '中' : '差')
const scoreTone = (s: number) => (s >= 70 ? 'ok' : s >= 50 ? 'warn' : 'bad')

/** 质量环：一圈进度 + 分数，单行高度 */
function Ring({ score }: { score: number | null }) {
  const s = score ?? 0
  return (
    <span className={clsx('mx-ring', score == null ? 'none' : scoreTone(s))}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" className="trk" />
        <circle cx="12" cy="12" r="10" className="val" pathLength={100} strokeDasharray={`${s} 100`} transform="rotate(-90 12 12)" />
      </svg>
      <b>{score ?? '—'}</b>
    </span>
  )
}

/** 紧凑速度：91.4K/s */
function SpeedShort({ v }: { v?: number }) {
  const [n, u] = bytesParts(v)
  return <>{n}<small>{u.replace(/i?B$/, '') || 'B'}/s</small></>
}

const UNLOCK_SHORT: Record<string, string> = { 'YouTube Premium': 'YouTube', 'Prime Video': 'Prime' }
const UNLOCK_TAG: Record<UnlockItem['status'], string> = { yes: '解锁', no: '屏蔽', originals: '自制', web: '网页', app: '仅APP', fail: '失败', na: '—' }
const UNLOCK_TEXT: Record<UnlockItem['status'], string> = { yes: '解锁', no: '屏蔽', originals: '仅自制剧', web: '仅网页', app: '仅APP', fail: '检测失败', na: '—' }
const METHOD_TEXT: Record<string, string> = { probe: '国内探针实测', bgp: 'BGP 直连推断', guess: '推测（未找到探针与直连）' }
const CARRIER_CLS: Record<string, string> = { 电信: 'ct', 联通: 'cu', 移动: 'cm' }

const lineFor = (lines: LatencyLine[] | undefined, carrier: string) => lines?.find((l) => l.name.includes(carrier))

// ---------- 卡片 ----------

export default function MatrixCard({ s, traffic, latency, brief }: CardProps) {
  const nav = useNavigate()
  const h = s.host || {}
  const st = s.state || {}
  const b = s.billing
  const memP = pct(st.mem_used, h.mem_total)
  const diskP = pct(st.disk_used, h.disk_total)
  const cores = coreCount(h.cpu) || 1
  const loadP = Math.min(100, ((st.load_1 || 0) / cores) * 100)

  const usedP = traffic && traffic.limit ? pct(traffic.used, traffic.limit) : 0
  let cycleP = 0, passed = 0, left = 0
  if (traffic) {
    const total = traffic.to.getTime() - traffic.from.getTime()
    const done = Date.now() - traffic.from.getTime()
    cycleP = total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : 0
    passed = Math.max(0, Math.floor(done / 86400000))
    left = Math.max(0, Math.ceil((traffic.to.getTime() - Date.now()) / 86400000))
  }
  const [outN, outU] = bytesParts(st.net_out_transfer)
  const [inN, inU] = bytesParts(st.net_in_transfer)
  const open = () => nav(`/server/${s.id}`)
  const hasLines = CARRIERS.some((c) => brief?.inbound?.[c] || brief?.routes?.[c] || lineFor(latency, c))
  const unlock = brief?.unlock || []

  return (
    <article className={clsx('mx-card', !s.online && 'down')} onClick={open} role="link" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && open()} aria-label={s.name}>
      <header className="mx-head">
        <Flag code={s.country_code} className="mx-flag" />
        <span className="mx-name" title={s.name}>{s.name}</span>
        {brief?.ip_type && <span className={clsx('mx-tag', brief.ip_type === 'native' ? 'ok' : 'warn')}>{brief.ip_type === 'native' ? '原生IP' : '广播IP'}</span>}
        <span className="spacer" />
        {s.online
          ? <span className="mx-pill ok"><i />{fmtLongUptime(st.uptime || 0)}</span>
          : <span className="mx-pill bad"><i />离线 {fmtAgo(s.last_active)}</span>}
        <OsLogo os={osLabel(h.platform)} className="mx-os" />
      </header>

      <section className="mx-panel mx-metrics">
        {([
          ['CPU', `${(st.cpu || 0).toFixed(1)}%`, st.cpu || 0, 'cpu'],
          ['内存', `${memP.toFixed(1)}%`, memP, 'mem'],
          ['存储', `${diskP.toFixed(1)}%`, diskP, 'disk'],
          ['负载', (st.load_1 ?? 0).toFixed(2), loadP, 'load'],
        ] as const).map(([k, v, p, c]) => (
          <div key={k} className={clsx('mx-metric', c)}>
            <div className="mx-mt"><span>{k}</span><b>{v}</b></div>
            <div className="mx-bar"><i style={{ width: `${Math.min(100, Math.max(0, p))}%` }} /></div>
          </div>
        ))}
      </section>

      <section className="mx-panel mx-info">
        <div className="mx-c" title="实时上行 / 下行">
          <span className="up"><i className="mx-ico">↑</i><b><SpeedShort v={st.net_out_speed} /></b></span>
          <span className="down"><i className="mx-ico">↓</i><b><SpeedShort v={st.net_in_speed} /></b></span>
        </div>
        <div className="mx-c" title={`累计上传 ${outN} ${outU} / 下载 ${inN} ${inU}`}>
          <span><i className="mx-ico">⇅</i><b>{outN}</b><small>{outU}</small><em>/</em><b>{inN}</b><small>{inU}</small></span>
        </div>
        <div className="mx-c" title="剩余天数 · 续费价格">
          <span><i className="mx-ico">◷</i><b className={b.daysLeft != null && b.daysLeft <= 7 ? 'bad' : ''}>{b.permanent ? '永久' : b.daysLeft != null ? Math.max(0, b.daysLeft) : '—'}</b>{!b.permanent && b.daysLeft != null && <small>天</small>}<em>·</em><b className="ok">{priceText(b) || '—'}</b></span>
        </div>
        <div className="mx-c mx-conn" title="TCP / UDP 连接数">
          <span>TCP <b>{st.tcp_conn_count ?? 0}</b></span>
          <span>UDP <b>{st.udp_conn_count ?? 0}</b></span>
        </div>
      </section>

      {traffic && traffic.limit > 0 && (
        <section className="mx-panel mx-quota">
          <div className="mx-q" title={`流量 已用 ${fmtBytes(traffic.used)} / 总计 ${fmtBytes(traffic.limit, 0)}`}>
            <span className="k">流量</span>
            <b className={usedP >= 90 ? 'bad' : usedP >= 70 ? 'warn' : 'ok'}>{usedP.toFixed(0)}%</b>
            <Blocks value={usedP} n={24} />
            <em><b>{fmtBytes(traffic.used)}</b> / {fmtBytes(traffic.limit, 0)}</em>
          </div>
          <div className="mx-q" title={`流量周期 已过 ${passed} 天 / 剩余 ${left} 天，${traffic.to.toLocaleDateString()} 重置`}>
            <span className="k">周期</span>
            <b className="info">{cycleP.toFixed(0)}%</b>
            <Blocks value={cycleP} n={24} tone="info" />
            <em>剩 <b className={left <= 3 ? 'warn' : ''}>{left}</b> 天 / {passed + left} 天</em>
          </div>
        </section>
      )}

      {hasLines && (
        <section className="mx-panel mx-lines">
          {CARRIERS.map((c) => {
            const go = brief?.inbound?.[c]
            const back = brief?.routes?.[c]
            const l = lineFor(latency, c)
            const q = l && l.delays.some((x) => x != null) ? lineScore(l) : null
            return (
              <div key={c} className={clsx('mx-line', CARRIER_CLS[c])}>
                <span className="mx-cn"><i />{c}</span>
                <span className="mx-rt">
                  <span className={clsx('r-go', go?.premium && 'prem', go?.guess && 'guess', !go && 'nil')} title={go ? `${c}去程：${go.label} · ${METHOD_TEXT[go.method || ''] || ''}` : '暂无去程数据'}>
                    <i className="mx-arr"><svg viewBox="0 0 12 12"><path d="M3 6h6M6.5 3.5 9 6 6.5 8.5" /></svg></i>去 <b>{go?.label || '未识别'}</b>
                  </span>
                  <span className={clsx('r-back', back?.premium && 'prem', !back && 'nil')} title={back ? `${c}回程：${back.label}` : '暂无回程数据'}>
                    <i className="mx-arr"><svg viewBox="0 0 12 12"><path d="M9 6H3M5.5 3.5 3 6l2.5 2.5" /></svg></i>回 <b>{back?.label || '未识别'}</b>
                  </span>
                </span>
                <span className="mx-lat">
                  <span className="mx-lm" title={q ? `最近 ${Math.min(28, l!.delays.length)} 次采样 · 抖动 ${q.jitter.toFixed(1)} ms` : '暂无延迟监控数据'}>
                    <span className="mx-lt">
                      <b className={clsx('mx-ms', l ? toneOfMs(l.latest) : '')}>{l ? (l.latest != null ? l.latest.toFixed(l.latest < 10 ? 2 : 0) : '超时') : '—'}{l?.latest != null && <small>ms</small>}</b>
                      <span className={clsx('mx-loss', l && l.loss >= 1 && 'bad')}>丢包 <em>{l ? `${l.loss.toFixed(1)}%` : '—'}</em></span>
                    </span>
                    <Bars values={l?.delays || []} />
                  </span>
                  <span title={q ? `线路质量 ${q.score} 分 · ${scoreText(q.score)}（按平均延迟、丢包、抖动估算，非测速）` : '暂无延迟监控数据'}>
                    <Ring score={q ? q.score : null} />
                  </span>
                </span>
              </div>
            )
          })}
        </section>
      )}

      {unlock.length > 0 && (
        <footer className="mx-unlock">
          {unlock.map((u) => {
            const cls = u.status === 'yes' ? 'ok' : u.status === 'no' ? 'bad' : u.status === 'fail' || u.status === 'na' ? 'none' : 'warn'
            return (
              <div key={u.name} className="mx-ut"
                title={`${u.name}：${UNLOCK_TEXT[u.status] || u.status}${u.region ? ` · ${u.region}` : ''}${u.status === 'yes' && u.native != null ? (u.native ? ' · 原生解锁' : ' · DNS 解锁') : ''}`}>
                {u.status === 'yes' && u.native != null && <i className={clsx('nv', u.native ? 'ok' : 'warn')} />}
                <span className="n">{UNLOCK_SHORT[u.name] || u.name}</span>
                <span className={clsx('s', cls)}>{UNLOCK_TAG[u.status] || u.status}{u.region && <sup>{u.region}</sup>}</span>
              </div>
            )
          })}
        </footer>
      )}
    </article>
  )
}
