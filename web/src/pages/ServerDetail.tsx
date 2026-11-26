import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FLAG_NAMES, HistoryPanel, PART_NAMES, PartStatus, UNLOCK_LOGO, riskTone, type Period } from '../components/DetailParts'
import { CARRIERS, coreCount, expiryText, osLabel } from '../components/ServerCard'
import { Flag, OsLogo } from '../components/brand'
import Topbar from '../components/Topbar'
import { useSkin } from '../lib/theme'
import DetailMatrix from '../themes/matrix/DetailMatrix'
import { IBack } from '../components/icons'
import { AnimNum, Ring, Seg, Sparkline } from '../components/ui'
import { api, type IPInfo, type QualityPart, type QualityReport, type InboundItem, type RouteItem, type UnlockItem } from '../lib/api'
import { priceText, splitTags } from '../lib/billing'
import { bytesParts, clsx, fmtAgo, fmtBytes, fmtDate, fmtUptime, latencyTone, maskIP, pct, toneVar } from '../lib/format'
import { cycleTrafficMap, useLiveServers, useProbeMeta, useQuality, useServiceData, useSetting, useSignedIn, useTitle, type LatencyLine } from '../lib/hooks'


export default function ServerDetail() {
  const id = Number(useParams().id)
  const setting = useSetting()
  const probeMeta = useProbeMeta()
  const site = setting?.config.site_name || 'VPS 探针'
  const signedIn = useSignedIn()
  const { servers, loaded } = useLiveServers()
  const s = servers.find((x) => x.id === id)
  useTitle(s ? `${s.name} · ${site}` : site)
  const [period, setPeriod] = useState<Period>('1d')
  const { summary, byServer } = useServiceData(period)
  const traffic = useMemo(() => cycleTrafficMap(summary.cycle_transfer_stats).get(id), [summary, id])
  const { report, reload } = useQuality(id)
  const lines = byServer.get(id) || []
  const { skin } = useSkin()

  if (loaded && !s) {
    return (
      <>
        <Topbar title={site} />
        <main className="page">
          <div className="glass empty"><h3>找不到这台服务器</h3>它可能已被删除或对访客隐藏。<div style={{ marginTop: 16 }}><Link to="/" className="btn">返回首页</Link></div></div>
        </main>
      </>
    )
  }
  if (!s) return <><Topbar title={site} /><main className="page"><div className="skel glass" style={{ minHeight: 160 }} /></main></>

  const h = s.host || {}
  const st = s.state || {}
  const b = s.billing
  const plan = s.note.planDataMod || {}
  const bill = s.note.billingDataMod || {}
  const exp = expiryText(b)
  const cores = coreCount(h.cpu)
  const memP = pct(st.mem_used, h.mem_total)
  const diskP = pct(st.disk_used, h.disk_total)
  const extras = splitTags(plan.extra)

  return (
    <>
      <Topbar title={site} />
      <main className="page sd-page">
        <Link to="/" className="back"><IBack />全部服务器</Link>

        <section className={clsx('hero glass', s.online ? 'is-on' : 'is-off')}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1>
              <span className={clsx('dot', s.online ? 'on pulse' : 'off')} />
              {s.country_code && <Flag code={s.country_code} className="hero-flag" />}
              <span>{s.name}</span>
              {s.country_code && <span className="cc">{s.country_code.toUpperCase()}</span>}
              {h.platform && <OsLogo os={osLabel(h.platform)} className="hero-os" />}
            </h1>
            <div className="meta">
              {[osLabel(h.platform) + (h.platform_version ? ` ${h.platform_version}` : ''), h.arch, h.virtualization, cores ? `${cores} 核` : ''].filter(Boolean).join(' · ')}
              <span className="sep">·</span>
              {s.online ? <>已运行 <b>{fmtUptime(st.uptime || 0)}</b></> : <span className="bad">离线 · 最后上报 {fmtAgo(s.last_active)}</span>}
            </div>
          </div>
          <div className="hero-tags">
            {priceText(b) && <span className="tag price-tag">{priceText(b)}</span>}
            {exp && <span className={clsx('tag', exp.tone !== 'neutral' && exp.tone)}>{exp.text}</span>}
            {b.remainingValue && <span className="tag plain">余值 {b.remainingValue}</span>}
            {extras.map((t) => <span key={t} className="tag plain">{t}</span>)}
          </div>
        </section>

        <div className="kpis">
          <RingKpi cls="kpi-cpu" k="CPU" p={st.cpu || 0} s={`负载 ${(st.load_1 ?? 0).toFixed(2)} · ${(st.load_5 ?? 0).toFixed(2)} · ${(st.load_15 ?? 0).toFixed(2)}`} />
          <RingKpi cls="kpi-mem" k="内存" p={memP} s={`${fmtBytes(st.mem_used)} / ${fmtBytes(h.mem_total)}`} />
          <RingKpi cls="kpi-disk" k="硬盘" p={diskP} s={`${fmtBytes(st.disk_used)} / ${fmtBytes(h.disk_total)}`} />
          {traffic && traffic.limit > 0
            ? <RingKpi cls="kpi-cycle" k="周期流量" p={pct(traffic.used, traffic.limit)} s={`${fmtBytes(traffic.used)} / ${fmtBytes(traffic.limit, 0)} · ${fmtDate(traffic.to)} 重置`} />
            : <RingKpi cls="kpi-cycle" k="Swap" p={pct(st.swap_used, h.swap_total)} s={`${fmtBytes(st.swap_used)} / ${fmtBytes(h.swap_total)}`} />}
          <SpeedKpi cls="kpi-up" k="上行" v={st.net_out_speed || 0} s={`累计 ${fmtBytes(st.net_out_transfer)}`} tone="ok" />
          <SpeedKpi cls="kpi-down" k="下行" v={st.net_in_speed || 0} s={`累计 ${fmtBytes(st.net_in_transfer)}`} tone="info" />
        </div>

        <section className="sec sd-lat">
          <div className="sec-h"><h2>三网延迟</h2><span className="hint">{period === '1d' ? '近 24 小时' : period === '7d' ? '近 7 天' : '近 30 天'}</span></div>
          <div className="glass">
            {lines.length === 0
              ? <div className="empty" style={{ padding: 30 }}>还没有延迟监控。管理员可在后台「延迟监控」添加三网测速点。</div>
              : skin === 'matrix' ? <DetailMatrix lines={lines} cc={s.country_code} spanHours={period === '7d' ? 168 : period === '30d' ? 720 : 24} /> : <LatencyTable lines={lines} />}
          </div>
        </section>

        <QualitySections id={id} report={report} reload={reload} signedIn={signedIn} />

        <section className="sec sd-hist">
          <div className="sec-h"><h2>历史</h2></div>
          <HistoryPanel id={id} lines={lines} period={period} setPeriod={setPeriod} signedIn={signedIn}
            memTotal={h.mem_total} diskTotal={h.disk_total} tsdb={setting?.tsdb_enabled !== false} />
        </section>

        <section className="sec two sd-spec">
          <div>
            <div className="sec-h"><h2>设备</h2></div>
            <dl className="glass dl">
              <dt>系统</dt><dd>{osLabel(h.platform)} {h.platform_version} <span className="muted">{h.arch}</span></dd>
              <dt>处理器</dt><dd>{h.cpu?.join(' / ') || '—'}</dd>
              {h.gpu?.length ? <><dt>显卡</dt><dd>{h.gpu.join(' / ')}</dd></> : null}
              <dt>虚拟化</dt><dd>{h.virtualization || '—'}</dd>
              <dt>内存 / Swap</dt><dd>{fmtBytes(h.mem_total)} / {fmtBytes(h.swap_total)}</dd>
              <dt>硬盘</dt><dd>{fmtBytes(h.disk_total)}</dd>
              <dt>连接</dt><dd>TCP {st.tcp_conn_count ?? 0} · UDP {st.udp_conn_count ?? 0} · 进程 {st.process_count ?? 0}</dd>
              <dt>开机时间</dt><dd>{h.boot_time ? fmtDate(new Date(h.boot_time * 1000), true) : '—'}</dd>
              {h.version && <><dt>Agent</dt><dd className="mono">{h.version}</dd></>}
            </dl>
          </div>
          <div>
            <div className="sec-h"><h2>账单与套餐</h2></div>
            <dl className="glass dl">
              <dt>价格</dt><dd>{priceText(b) || '—'}{b.autoRenewal && <span className="muted"> · 自动续费</span>}</dd>
              <dt>周期</dt><dd>{bill.startDate ? fmtDate(new Date(bill.startDate)) : '—'} → {b.permanent ? '永久' : fmtDate(b.end)}</dd>
              <dt>剩余</dt><dd>{b.permanent ? '永久' : b.daysLeft != null ? `${Math.max(0, b.daysLeft)} 天` : '—'}{b.remainingValue && <span className="muted"> · 余值 {b.remainingValue}</span>}</dd>
              <dt>带宽</dt><dd>{plan.bandwidth || '—'}</dd>
              <dt>流量</dt><dd>{plan.trafficVol || '—'}{plan.trafficVol && <span className="muted"> · {plan.trafficType === '1' ? '单向计费' : '双向计费'}</span>}</dd>
              <dt>IP</dt><dd>{[plan.IPv4 === '1' && 'IPv4', plan.IPv6 === '1' && 'IPv6'].filter(Boolean).join(' + ') || '—'}</dd>
            </dl>
          </div>
        </section>

        <footer className="foot"><span>{site}</span>{probeMeta.footer_text && <><span>·</span><span>{probeMeta.footer_text}</span></>}</footer>
      </main>
    </>
  )
}

function RingKpi({ k, p, s, cls }: { k: string; p: number; s: string; cls?: string }) {
  return (
    <div className={clsx('kpi glass', cls)}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="label">{k}</div>
          <div className="v" style={{ marginBottom: 0 }}><AnimNum value={p} format={(v) => `${v.toFixed(1)}%`} /></div>
        </div>
        <Ring value={p} size={40} stroke={4.5} />
      </div>
      <div className="s">{s}</div>
    </div>
  )
}

function SpeedKpi({ k, v, s, tone, cls }: { k: string; v: number; s: string; tone: 'ok' | 'info'; cls?: string }) {
  const [, u] = bytesParts(v)
  return (
    <div className={clsx('kpi glass', cls)}>
      <div className="label">{k}</div>
      <div className="v" style={{ color: `var(--${tone})`, marginBottom: 0 }}>{bytesParts(v)[0]}<small style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginLeft: 3 }}>{u}/s</small></div>
      <div className="s" style={{ marginTop: 18 }}>{s}</div>
    </div>
  )
}

function LatencyTable({ lines }: { lines: LatencyLine[] }) {
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>线路</th><th style={{ width: '46%' }}>趋势</th><th className="r">当前</th><th className="r">平均</th><th className="r">丢包</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.serviceId}>
              <td style={{ fontWeight: 550 }}>{l.name}</td>
              <td style={{ minWidth: 140 }}><Sparkline values={l.delays} /></td>
              <td className="r" style={{ fontWeight: 650, color: toneVar(latencyTone(l.latest)) }}>{l.latest != null ? `${Math.round(l.latest)} ms` : '超时'}</td>
              <td className="r muted">{Math.round(l.avg)} ms</td>
              <td className={clsx('r', l.loss >= 1 ? 'bad' : 'muted')}>{l.loss.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- IP 质量 / 回程 / 解锁 ----------

function QualitySections({ id, report, reload, signedIn }: { id: number; report?: QualityReport; reload: () => void; signedIn: boolean }) {
  const [fam, setFam] = useState<'v4' | 'v6'>('v4')
  if (report === undefined) return null
  const hasV6 = !!report.ipv6
  const ip = fam === 'v6' ? report.ipv6 : report.ipv4
  const never = (p: QualityPart) => !report.parts_at?.[p] && !report.status?.running?.includes(p) && !report.status?.pending?.includes(p)
  const emptyText = (p: QualityPart) => never(p)
    ? (signedIn ? `还没有检测过${PART_NAMES[p]}，点右上角「开始检测」。需要 1.1 及以上版本的 Agent。` : '暂无检测数据')
    : report.status?.running?.includes(p) || report.status?.pending?.includes(p) ? '正在检测，结果出来后会自动显示…' : '暂无数据'

  const allNever = (['route', 'unlock', 'ip'] as QualityPart[]).every(never)
  const runAll = async () => {
    try {
      await api(`/probe/quality/${id}/refresh`, { method: 'POST', body: { parts: ['route', 'unlock', 'ip'] } })
      reload()
    } catch { /* PartStatus 会提示 */ }
  }
  return (
    <>
      {signedIn && allNever && (
        <div className="note info row" style={{ marginTop: 30, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 220 }}>这台服务器还没做过线路与解锁检测。检测由 Agent 在本机完成，大约需要 1 分钟。</span>
          <button className="btn sm primary" onClick={runAll}>一键检测全部</button>
        </div>
      )}
      <section className="sec sd-route">
        <div className="sec-h">
          <h2>三网线路</h2>
          <PartStatus part="route" id={id} report={report} reload={reload} signedIn={signedIn} />
        </div>
        {report.routes_v4?.length ? <RoutePanel routes={report.routes_v4} inbound={report.inbound_v4} /> : (
          <div className="glass empty" style={{ padding: 28 }}>{report.error && !never('route') ? report.error : emptyText('route')}</div>
        )}
      </section>

      <section className="sec sd-unlock">
        <div className="sec-h">
          <h2>流媒体与 AI 解锁</h2>
          <PartStatus part="unlock" id={id} report={report} reload={reload} signedIn={signedIn} />
        </div>
        {report.unlock?.length ? <UnlockGrid items={report.unlock} /> : <div className="glass empty" style={{ padding: 28 }}>{emptyText('unlock')}</div>}
      </section>

      <section className="sec sd-ip">
        <div className="sec-h">
          <h2>IP 质量</h2>
          {hasV6 && <Seg value={fam} onChange={setFam} options={[{ value: 'v4', label: 'IPv4' }, { value: 'v6', label: 'IPv6' }]} />}
          <PartStatus part="ip" id={id} report={report} reload={reload} signedIn={signedIn} />
        </div>
        {ip ? <IPPanel ip={ip} /> : <div className="glass empty" style={{ padding: 28 }}>{report.parts_at?.ip ? `没有 ${fam === 'v6' ? 'IPv6' : 'IPv4'} 出口` : emptyText('ip')}</div>}
      </section>
    </>
  )
}

function IPPanel({ ip }: { ip: IPInfo }) {
  const sources = ip.sources || []
  const flags = [...new Set(sources.flatMap((x) => x.flags || []))]
  return (
    <div className="two">
      <dl className="glass dl">
        <dt>地址</dt><dd className="mono">{ip.ip.includes('*') ? ip.ip : maskIP(ip.ip)}</dd>
        <dt>类型</dt>
        <dd className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {ip.ip_type === 'native' ? <span className="tag ok">原生 IP</span> : ip.ip_type === 'broadcast' ? <span className="tag warn">广播 IP</span> : <span className="tag plain">未知</span>}
          {ip.reg_country && ip.country && <span className="muted" style={{ fontSize: 12 }}>注册地 {ip.reg_country} · 使用地 {ip.country}</span>}
        </dd>
        <dt>ASN</dt><dd>{ip.asn ? <span className="mono">{ip.asn}</span> : '—'}</dd>
        <dt>组织</dt><dd>{ip.org || '—'}</dd>
        <dt>位置</dt><dd>{[ip.city, ip.country].filter(Boolean).join(', ') || '—'}</dd>
        <dt>标记</dt>
        <dd className="wrap">{flags.length ? flags.map((f) => <span key={f} className={clsx('tag', f === 'hosting' ? 'plain' : 'bad')}>{FLAG_NAMES[f] || f}</span>) : <span className="ok">无代理 / VPN / Tor 标记</span>}</dd>
      </dl>
      <div className="glass table-wrap">
        <table className="t">
          <thead><tr><th>数据库</th><th>使用类型</th><th>公司类型</th><th className="r">风险</th></tr></thead>
          <tbody>
            {sources.length === 0 && <tr><td colSpan={4} className="muted">没有可用的数据源</td></tr>}
            {sources.map((src) => (
              <tr key={src.name}>
                <td style={{ fontWeight: 550 }}>{src.name}</td>
                <td>{src.usage ? <UsageTag v={src.usage} /> : <span className="faint">—</span>}</td>
                <td>{src.company ? <UsageTag v={src.company} /> : <span className="faint">—</span>}</td>
                <td className="r">
                  {src.risk != null || src.risk_label
                    ? <span className={clsx('tag', riskTone(src.risk, src.risk_label))}>{src.risk != null ? `${src.risk < 10 ? +src.risk.toFixed(2) : Math.round(src.risk)} · ` : ''}{src.risk_label || ''}</span>
                    : <span className="faint">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}



function UsageTag({ v }: { v: string }) {
  return <span className={clsx('tag', v === '家宽' || v === '手机' ? 'ok' : 'plain')}>{v}</span>
}


/** 按运营商分三列，每列列出北京 / 上海 / 广州的回程，点击展开路由 */
function RoutePanel({ routes, inbound }: { routes: RouteItem[]; inbound?: InboundItem[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const byCarrier = CARRIERS.map((c) => ({ c, items: routes.filter((r) => r.carrier === c) })).filter((x) => x.items.length)
  return (
    <div className="route-grid">
      {byCarrier.map(({ c, items }) => {
        const best = items.find((r) => r.premium) || items[0]
        const go = inbound?.find((x) => x.carrier === c)
        const how = go?.method === 'probe' ? `实测${go.city ? ` · ${go.city}` : ''}` : go?.method === 'bgp' ? 'BGP 推断' : '推测'
        return (
          <div key={c} className="route-col glass">
            <h3>{c}<span className="spacer" />{best && <span className={clsx('tag', best.premium ? 'route' : 'plain')}>{best.label}</span>}</h3>
            {go && (
              <div className="route-item" title={go.method === 'probe' ? '由国内探针（Globalping）对本机做 MTR 判定' : go.method === 'bgp' ? '根据公开 BGP 数据中的直连关系推断' : '未找到国内探针与直连关系，按运营商默认骨干网推测'}>
                <span className="city">去程</span>
                <span className={clsx('tag', go.premium ? 'route' : 'plain')} style={go.guess ? { opacity: .65 } : undefined}>{go.label}</span>
                {go.premium && <span className="gold" style={{ fontSize: 11.5 }}>精品</span>}
                <span className="spacer" />
                <span className="faint" style={{ fontSize: 11.5 }}>{how}</span>
              </div>
            )}
            {items.map((r) => {
              const key = `${r.carrier}-${r.city}`
              return (
                <div key={key}>
                  <div className="route-item" onClick={() => r.hops?.length && setOpen(open === key ? null : key)} role={r.hops?.length ? 'button' : undefined}>
                    <span className="city">{r.city}</span>
                    <span className={clsx('tag', r.premium ? 'route' : r.label === '超时' ? 'bad' : 'plain')}>{r.label || '未知'}</span>
                    {r.premium && <span className="gold" style={{ fontSize: 11.5 }}>精品</span>}
                    <span className="spacer" />
                    <span style={{ color: toneVar(latencyTone(r.rtt ?? null)), fontWeight: 600 }}>{r.rtt ? `${Math.round(r.rtt)} ms` : ''}</span>
                    {r.hops?.length ? <span className="faint" style={{ fontSize: 11 }}>{open === key ? '▴' : '▾'}</span> : null}
                  </div>
                  {open === key && r.hops && (
                    <div className="hops">
                      {r.hops.map((hp) => (
                        <div key={hp.ttl} style={{ display: 'contents' }}>
                          <span className="faint">{hp.ttl}</span>
                          <span>{hp.ip || '*'}</span>
                          <span className={hp.tag ? 'gold' : 'faint'}>{[hp.asn, hp.tag].filter(Boolean).join(' · ')}</span>
                          <span className="muted" style={{ textAlign: 'right' }}>{hp.rtt ? `${hp.rtt.toFixed(1)}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

const UNLOCK_TEXT: Record<UnlockItem['status'], string> = { yes: '已解锁', no: '不可用', originals: '仅自制剧', web: '仅网页', app: '仅 APP', fail: '检测失败', na: '不支持' }


function UnlockGrid({ items }: { items: UnlockItem[] }) {
  return (
    <div className="unlock-grid">
      {items.map((u) => {
        const tone = u.status === 'yes' ? 'ok' : u.status === 'originals' || u.status === 'web' || u.status === 'app' ? 'warn' : u.status === 'no' ? 'bad' : 'faint'
        const logo = UNLOCK_LOGO[u.name]
        return (
          <div key={u.name} className="unlock glass" title={u.note}>
            <span className="logo" style={logo ? { color: logo.c } : undefined}>{logo?.t || u.name[0]}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="name">{u.name}</div>
              <div className={clsx('st', tone)}>
                {UNLOCK_TEXT[u.status] || u.status}
                {u.status === 'yes' && u.native === false && <span className="warn"> · DNS</span>}
                {u.status === 'yes' && u.native && <span className="muted"> · 原生</span>}
              </div>
            </div>
            {u.region && <span className="cc">{u.region}</span>}
          </div>
        )
      })}
    </div>
  )
}

