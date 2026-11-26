import { useNavigate } from 'react-router-dom'
import { priceText } from '../../lib/billing'
import { bytesParts, clsx, fmtAgo, fmtBytes, pct } from '../../lib/format'
import { ArrBack, ArrGo, Bars, Blocks, CARRIER_CLS, METHOD_TEXT, Ring, SpeedShort, UNLOCK_SHORT, UNLOCK_TAG, UNLOCK_TEXT, fmtLongUptime, isPremiumRoute, lineFor, lineScore, regionBaseline, scoreText, toneOfMs, unlockTone } from './shared'
import { coreCount, osLabel, CARRIERS } from '../../components/ServerCard'
import { Flag, OsLogo } from '../../components/brand'
import type { CardProps } from '../registry'

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

      {traffic && traffic.limit > 0 ? (
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
      ) : (
        <section className="mx-panel mx-quota">
          <div className="mx-q" title={`无限流量 · 开机累计已用 ${fmtBytes((st.net_in_transfer || 0) + (st.net_out_transfer || 0))}`}>
            <span className="k">流量</span>
            <b className="ok">无限</b>
            <Blocks value={100} n={24} tone="ok" />
            <em><b>{fmtBytes((st.net_in_transfer || 0) + (st.net_out_transfer || 0))}</b> / 无限</em>
          </div>
          <div className="mx-q" title="无周期流量限制">
            <span className="k">周期</span>
            <b className="info">不限</b>
            <Blocks value={100} n={24} tone="info" />
            <em>无限流量</em>
          </div>
        </section>
      )}

      {hasLines && (
        <section className="mx-panel mx-lines">
          {CARRIERS.map((c) => {
            const go = brief?.inbound?.[c]
            const back = brief?.routes?.[c]
            const l = lineFor(latency, c)
            const reg = regionBaseline(s.country_code)
            const q = l && l.delays.some((x) => x != null) ? lineScore(l, s.country_code) : null
            const goPrem = isPremiumRoute(go?.label, go?.premium)
            const backPrem = isPremiumRoute(back?.label, back?.premium)
            return (
              <div key={c} className={clsx('mx-line', CARRIER_CLS[c])}>
                <span className="mx-cn"><i />{c}</span>
                <span className="mx-rt">
                  <span className={clsx('r-go', goPrem && 'prem', go?.guess && 'guess', !go && 'nil')} title={go ? `${c}去程：${go.label}${goPrem ? '（精品线路）' : ''} · ${METHOD_TEXT[go.method || ''] || ''}` : '暂无去程数据'}>
                    <ArrGo />去 <b>{go?.label || '未识别'}</b>
                  </span>
                  <span className={clsx('r-back', backPrem && 'prem', !back && 'nil')} title={back ? `${c}回程：${back.label}${backPrem ? '（精品线路）' : ''}` : '暂无回程数据'}>
                    <ArrBack />回 <b>{back?.label || '未识别'}</b>
                  </span>
                </span>
                <span className="mx-lat">
                  <span className="mx-lm" title={q ? `最近 ${Math.min(28, l!.delays.length)} 次采样 · 抖动 ${q.jitter.toFixed(1)} ms` : '暂无延迟监控数据'}>
                    <span className="mx-lt">
                      <b className={clsx('mx-ms', l ? toneOfMs(l.latest, reg.base) : '')}>{l ? (l.latest != null ? l.latest.toFixed(l.latest < 10 ? 2 : 0) : '超时') : '—'}{l?.latest != null && <small>ms</small>}</b>
                      <span className={clsx('mx-loss', l && l.loss >= 1 && 'bad')}>丢包 <em>{l ? `${l.loss.toFixed(1)}%` : '—'}</em></span>
                    </span>
                    <Bars values={l?.delays || []} base={reg.base} />
                  </span>
                  <span title={q ? `线路质量 ${q.score} 分 · ${scoreText(q.score)}（${q.reg.label}基准 ${q.reg.base}ms，按延迟/丢包/抖动估算）` : '暂无延迟监控数据'}>
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
            const cls = unlockTone(u.status)
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
