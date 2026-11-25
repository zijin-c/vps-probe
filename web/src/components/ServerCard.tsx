import { useNavigate } from 'react-router-dom'
import type { QualityBrief } from '../lib/api'
import { priceText, splitTags, type Billing } from '../lib/billing'
import { bytesParts, clsx, fmtAgo, fmtBytes, fmtPair, fmtSpeed, fmtUptime, latencyTone, pct, toneVar, type Tone } from '../lib/format'
import type { CycleTraffic, LatencyLine, LiveServer } from '../lib/hooks'
import { IDown, IUp } from './icons'
import { AnimNum, Meter, Sparkline, glowHandlers } from './ui'

const OS_NAMES = ['debian', 'ubuntu', 'centos', 'alpine', 'rocky', 'almalinux', 'fedora', 'arch', 'windows', 'darwin', 'freebsd', 'openwrt', 'opensuse']

export function osLabel(p?: string): string {
  const s = (p || '').toLowerCase()
  for (const k of OS_NAMES) if (s.includes(k)) return k === 'darwin' ? 'macOS' : k === 'almalinux' ? 'AlmaLinux' : k === 'opensuse' ? 'openSUSE' : k[0].toUpperCase() + k.slice(1)
  return p || ''
}

/** "Intel Xeon 2 Virtual Core" → 2 */
export function coreCount(cpu?: string[]): number {
  let n = 0
  for (const c of cpu || []) {
    const m = c.match(/(\d+)\s+(Virtual|Physical)\s+Core/i)
    n += m ? parseInt(m[1], 10) : 1
  }
  return n
}

export function expiryText(b: Billing): { text: string; tone: Tone } | null {
  if (b.permanent) return { text: '永久', tone: 'neutral' }
  if (b.daysLeft == null) return null
  if (b.daysLeft <= 0) return { text: '已到期', tone: 'bad' }
  return { text: `${b.daysLeft} 天后到期`, tone: b.daysLeft <= 7 ? 'bad' : b.daysLeft <= 30 ? 'warn' : 'neutral' }
}

export const CARRIERS = ['电信', '联通', '移动']

/** 自动识别的回程线路标签，没有检测结果时退回手填的线路 */
export function RouteTags({ brief, manual }: { brief?: QualityBrief; manual?: string }) {
  const auto = CARRIERS.filter((c) => brief?.routes?.[c])
  if (auto.length) {
    return (
      <>
        {auto.map((c) => {
          const r = brief!.routes![c]
          return <span key={c} className={clsx('tag', r.premium ? 'route' : 'plain')} title={`${c}回程：${r.label}${r.premium ? '（精品）' : ''}`}><span className="k">{c}</span>{r.label}</span>
        })}
      </>
    )
  }
  return <>{splitTags(manual).map((t) => <span key={t} className="tag route">{t}</span>)}</>
}

function Stat({ k, v, unit, sub, p, tone, format, still }: {
  k: string; v: number; unit?: string; sub: string; p: number; tone?: Tone; format?: (n: number) => string
  still?: boolean // 带单位换算的值不做过渡，否则数字和单位会对不上
}) {
  const fmt = format || ((n: number) => n.toFixed(1))
  return (
    <div style={{ minWidth: 0 }}>
      <div className="stat-k">{k}</div>
      <div className="stat-v">{still ? fmt(v) : <AnimNum value={v} format={fmt} />}{unit && <small>{unit}</small>}</div>
      <Meter value={p} tone={tone} />
      <div className="stat-s">{sub}</div>
    </div>
  )
}

export default function ServerCard({ s, traffic, latency, brief }: { s: LiveServer; traffic?: CycleTraffic; latency?: LatencyLine[]; brief?: QualityBrief }) {
  const nav = useNavigate()
  const h = s.host || {}
  const st = s.state || {}
  const plan = s.note.planDataMod || {}
  const cores = coreCount(h.cpu)
  const memP = pct(st.mem_used, h.mem_total)
  const diskP = pct(st.disk_used, h.disk_total)
  const price = priceText(s.billing)
  const exp = expiryText(s.billing)
  const lines = (latency || []).slice(0, 3)
  const meta = [osLabel(h.platform), h.virtualization, cores ? `${cores} 核` : '', h.mem_total ? fmtBytes(h.mem_total, 0) : ''].filter(Boolean)
  const hasRoutes = !!(brief?.routes && Object.keys(brief.routes).length) || !!plan.networkRoute
  // 手填标签若与自动识别重复（如"原生IP"）就不再显示
  const extras = splitTags(plan.extra).filter((t) => !(brief?.ip_type && /^(原生|广播)\s*IP$/i.test(t)))

  let trafficStat
  if (traffic && traffic.limit > 0) {
    const p = pct(traffic.used, traffic.limit)
    trafficStat = <Stat k="流量" v={p} unit="%" p={p} sub={`${fmtBytes(traffic.used)} / ${fmtBytes(traffic.limit, 0)}`} />
  } else {
    const total = (st.net_in_transfer || 0) + (st.net_out_transfer || 0)
    const [, u] = bytesParts(total)
    trafficStat = <Stat k="流量" v={total} unit={` ${u}`} p={0} tone="neutral" sub={plan.trafficVol ? `套餐 ${plan.trafficVol}` : '开机累计'}
      format={(n) => bytesParts(n)[0]} still />
  }

  const open = () => nav(`/server/${s.id}`)
  return (
    <article className={clsx('card glass', !s.online && 'down')} onClick={open} role="link" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && open()} aria-label={s.name} {...glowHandlers()}>
      <div className="card-top">
        <div className="card-title">
          <div className="card-name">
            <span className={clsx('dot', s.online ? 'on' : 'off')} />
            <span>{s.name}</span>
          </div>
          <div className="card-meta">
            {meta.join(' · ')}
            {meta.length > 0 && <span className="sep">·</span>}
            {s.online ? <>运行 <b>{fmtUptime(st.uptime || 0)}</b></> : <span className="bad">离线 {fmtAgo(s.last_active)}</span>}
          </div>
        </div>
        {s.country_code && <span className="cc" title={s.country_code}>{s.country_code.toUpperCase()}</span>}
      </div>

      <div className="stats">
        <Stat k="CPU" v={st.cpu || 0} unit="%" p={st.cpu || 0} sub={`负载 ${(st.load_1 ?? 0).toFixed(2)}`} />
        <Stat k="内存" v={memP} unit="%" p={memP} sub={fmtPair(st.mem_used, h.mem_total)} />
        <Stat k="硬盘" v={diskP} unit="%" p={diskP} sub={fmtPair(st.disk_used, h.disk_total)} />
        {trafficStat}
      </div>

      <div className="netline">
        <div className="netpill">
          <span className="ar up"><i><IUp /></i>{fmtSpeed(st.net_out_speed)}</span>
          <span className="tot">出 {fmtBytes(st.net_out_transfer)}</span>
        </div>
        <div className="netpill">
          <span className="ar down"><i><IDown /></i>{fmtSpeed(st.net_in_speed)}</span>
          <span className="tot">入 {fmtBytes(st.net_in_transfer)}</span>
        </div>
      </div>

      {lines.length > 0 && (
        <div className="lat">
          {lines.map((l) => (
            <div key={l.serviceId} style={{ display: 'contents' }}>
              <span className="n" title={l.name}>{l.name}</span>
              <Sparkline values={l.delays} />
              <span className="v" style={{ color: toneVar(latencyTone(l.latest)) }}>{l.latest != null ? `${Math.round(l.latest)}ms` : '超时'}</span>
              <span className={clsx('l', l.loss >= 1 && 'bad')} title="24 小时丢包率">{l.loss < 0.05 ? '0%' : `${l.loss.toFixed(l.loss < 10 ? 1 : 0)}%`}</span>
            </div>
          ))}
        </div>
      )}

      {(hasRoutes || brief?.ip_type || extras.length > 0) && (
        <div className="qrow">
          <RouteTags brief={brief} manual={plan.networkRoute} />
          {brief?.ip_type === 'native' && <span className="tag ok">原生 IP</span>}
          {brief?.ip_type === 'broadcast' && <span className="tag plain">广播 IP</span>}
          {extras.map((t) => <span key={t} className="tag plain">{t}</span>)}
        </div>
      )}

      {(price || exp) && (
        <div className="card-foot">
          {price && <span className="price">{price}</span>}
          {exp && <span className="exp" style={{ color: exp.tone === 'neutral' ? 'var(--muted)' : toneVar(exp.tone) }}>{exp.text}</span>}
          {s.billing.remainingValue && <><span className="spacer" /><span>余值 {s.billing.remainingValue}</span></>}
        </div>
      )}
    </article>
  )
}
