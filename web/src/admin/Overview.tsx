import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IDownload, IExternal, IRefresh, IServer, ISliders } from '../components/icons'
import { Meter, useToast } from '../components/ui'
import { expiryText } from '../components/ServerCard'
import {
  api, getService, isOnline,
  type ProbeConfigView, type ServerRow, type ServiceResponse,
} from '../lib/api'
import { parseBilling, parseNote, priceText } from '../lib/billing'
import { clsx, fmtAgo, fmtBytes, toneVar } from '../lib/format'
import { downloadBackupFile } from './Backup'
import { PageHead, useAdmin } from './common'

export default function Overview() {
  const { profile, setting } = useAdmin()
  const toast = useToast()
  const [servers, setServers] = useState<ServerRow[] | null>(null)
  const [svc, setSvc] = useState<ServiceResponse | null>(null)
  const [probeCfg, setProbeCfg] = useState<ProbeConfigView | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(() => {
    setNow(Date.now())
    api<ServerRow[]>('/server').then((d) => setServers(d || [])).catch(() => setServers([]))
    getService().then(setSvc).catch(() => setSvc({}))
    api<ProbeConfigView>('/probe/config').then(setProbeCfg).catch(() => setProbeCfg(null))
  }, [])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => {
    const list = servers || []
    const online = list.filter((s) => isOnline(s.last_active, now))
    const offline = list.filter((s) => !isOnline(s.last_active, now))
    const expiring = list
      .map((s) => ({ s, b: parseBilling(parseNote(s.public_note)) }))
      .filter(({ b }) => !b.permanent && b.daysLeft != null && b.daysLeft <= 30)
      .sort((a, b) => (a.b.daysLeft ?? 999) - (b.b.daysLeft ?? 999))

    const trafficRows: { serverId: string; name: string; ruleName: string; used: number; max: number; pct: number }[] = []
    Object.values(svc?.cycle_transfer_stats || {}).forEach((st) => {
      if (!st.max) return
      Object.entries(st.transfer || {}).forEach(([sid, used]) => {
        const pct = Math.min(100, (used / st.max) * 100)
        trafficRows.push({
          serverId: sid,
          name: st.server_name?.[sid] || list.find((x) => String(x.id) === sid)?.name || `#${sid}`,
          ruleName: st.name,
          used,
          max: st.max,
          pct,
        })
      })
    })
    trafficRows.sort((a, b) => b.pct - a.pct)
    const highTraffic = trafficRows.filter((r) => r.pct >= 80)

    return { total: list.length, online, offline, expiring, trafficRows, highTraffic }
  }, [servers, svc, now])

  const backupNow = async () => {
    setDownloading(true)
    try {
      const { name, size } = await downloadBackupFile(false)
      toast(`已下载 ${name}（${fmtBytes(size)}）`, 'ok')
    } catch (e) {
      toast(`下载失败：${(e as Error).message}`, 'err')
    } finally {
      setDownloading(false)
    }
  }

  const checks = [
    {
      ok: profile.username !== 'admin',
      label: profile.username === 'admin' ? '仍在使用默认管理员账号 admin' : `管理员账号：${profile.username}`,
      to: '/dashboard/account',
      action: '去修改',
    },
    {
      ok: !!(setting?.config.install_host as string),
      label: (setting?.config.install_host as string) ? `Agent 地址：${setting?.config.install_host}` : '尚未配置 Agent 连接地址（install_host）',
      to: '/dashboard/settings',
      action: '去设置',
    },
    {
      ok: !!setting?.tsdb_enabled,
      label: setting?.tsdb_enabled ? 'TSDB 历史监控已启用' : 'TSDB 历史监控未启用（仅保留实时数据）',
      to: '/dashboard/settings',
      action: '查看',
    },
    {
      ok: !!probeCfg?.telegram.has_bot_token,
      label: probeCfg?.telegram.running
        ? `Telegram 机器人运行中（${probeCfg.telegram.chat_ids.length} 个授权会话）`
        : probeCfg?.telegram.has_bot_token
          ? '已填 TG Token，需重启面板启动机器人'
          : '未配置 Telegram 交互机器人',
      to: '/dashboard/probe',
      action: '配置',
    },
  ]

  return (
    <>
      <PageHead title="概览" desc="服务器状态、到期提醒、流量配额与探针扩展运行状态一览。">
        <button className="btn" onClick={load}><IRefresh />刷新</button>
        <button className="btn primary" onClick={backupNow} disabled={downloading}>
          <IDownload />{downloading ? '打包中…' : '下载备份'}
        </button>
      </PageHead>

      <div className="ov-grid">
        <Link to="/dashboard/servers" className="glass sum clickable">
          <div className="label">在线服务器</div>
          <div className="big tnum">
            {servers === null ? '—' : stats.online.length}
            <small>/ {servers === null ? '—' : stats.total}</small>
          </div>
          <div className="sub">
            {stats.offline.length > 0
              ? <span className="bad">{stats.offline.length} 台离线</span>
              : <span className="ok">全部在线</span>}
          </div>
        </Link>

        <Link to="/dashboard/servers" className="glass sum clickable">
          <div className="label">30 天内到期</div>
          <div className="big tnum" style={{ color: stats.expiring.length ? 'var(--warn)' : undefined }}>
            {servers === null ? '—' : stats.expiring.length}
            <small>台</small>
          </div>
          <div className="sub">
            {stats.expiring[0]
              ? `最近：${stats.expiring[0].s.name}（${expiryText(stats.expiring[0].b)?.text || ''}）`
              : '暂无临期服务器'}
          </div>
        </Link>

        <Link to="/dashboard/alerts" className="glass sum clickable">
          <div className="label">流量配额预警</div>
          <div className="big tnum" style={{ color: stats.highTraffic.length ? 'var(--bad)' : undefined }}>
            {svc === null ? '—' : stats.highTraffic.length}
            <small>/ {stats.trafficRows.length} 项</small>
          </div>
          <div className="sub">
            {stats.highTraffic.length > 0
              ? `最高：${stats.highTraffic[0].name} ${stats.highTraffic[0].pct.toFixed(0)}%`
              : stats.trafficRows.length > 0 ? '所有配额均低于 80%' : '未配置周期流量规则'}
          </div>
        </Link>

        <Link to="/dashboard/probe" className="glass sum clickable">
          <div className="label">Telegram 机器人</div>
          <div className="big" style={{ fontSize: 20, marginTop: 10 }}>
            {probeCfg === null ? '—' : probeCfg.telegram.running ? <span className="ok">运行中</span> : <span className="muted">未启用</span>}
          </div>
          <div className="sub">
            {probeCfg?.telegram.chat_ids.length ? `已授权 ${probeCfg.telegram.chat_ids.length} 个会话` : '点击配置机器人'}
          </div>
        </Link>
      </div>

      <div className="ov-two">
        <section className="glass card-pad">
          <div className="row" style={{ marginBottom: 14 }}>
            <h3 className="sec-title" style={{ margin: 0 }}>离线与临期关注</h3>
            <span className="spacer" />
            <Link to="/dashboard/servers" className="btn xs ghost"><IServer />管理服务器</Link>
          </div>
          <div className="ov-list">
            {servers === null && <div className="muted">加载中…</div>}
            {servers !== null && stats.offline.length === 0 && stats.expiring.length === 0 && (
              <div className="muted" style={{ padding: '14px 0', textAlign: 'center' }}>一切正常，没有离线或 30 天内到期的服务器</div>
            )}
            {stats.offline.map((s) => (
              <div key={`off-${s.id}`} className="ov-row">
                <span className="dot off" />
                <b style={{ fontWeight: 600 }}>{s.name}</b>
                <span className="tag bad">离线</span>
                <span className="spacer" />
                <span className="muted" style={{ fontSize: 12 }}>{fmtAgo(s.last_active)}</span>
                <a href={`/server/${s.id}`} target="_blank" rel="noreferrer" className="iconbtn" title="查看前台详情" style={{ width: 28, height: 28 }}><IExternal /></a>
              </div>
            ))}
            {stats.expiring.map(({ s, b }) => {
              const exp = expiryText(b)
              return (
                <div key={`exp-${s.id}`} className="ov-row">
                  <span className={clsx('dot', isOnline(s.last_active, now) ? 'on' : 'off')} />
                  <b style={{ fontWeight: 600 }}>{s.name}</b>
                  <span className="muted" style={{ fontSize: 12 }}>{priceText(b)}</span>
                  <span className="spacer" />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: exp ? toneVar(exp.tone) : undefined }}>{exp?.text}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="glass card-pad">
          <div className="row" style={{ marginBottom: 14 }}>
            <h3 className="sec-title" style={{ margin: 0 }}>周期流量排行</h3>
            <span className="spacer" />
            <Link to="/dashboard/alerts" className="btn xs ghost">配置配额</Link>
          </div>
          <div className="ov-list">
            {svc === null && <div className="muted">加载中…</div>}
            {svc !== null && stats.trafficRows.length === 0 && (
              <div className="muted" style={{ padding: '14px 0', textAlign: 'center' }}>
                还没有周期流量统计，前往「告警规则」添加一条周期流量规则即可
              </div>
            )}
            {stats.trafficRows.slice(0, 6).map((r) => (
              <div key={`${r.ruleName}-${r.serverId}`} className="ov-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b style={{ fontWeight: 600 }}>{r.name}</b>
                  <span className="tag plain">{r.ruleName}</span>
                  <span className="spacer" />
                  <span className="tnum" style={{ fontSize: 12.5 }}>
                    {fmtBytes(r.used)} <span className="muted">/ {fmtBytes(r.max)}</span>
                  </span>
                </div>
                <Meter value={r.pct} />
              </div>
            ))}
          </div>
        </section>

        <section className="glass card-pad" style={{ gridColumn: '1 / -1' }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <h3 className="sec-title" style={{ margin: 0 }}>配置与安全检查</h3>
            <span className="spacer" />
            <Link to="/dashboard/probe" className="btn xs ghost"><ISliders />探针配置</Link>
          </div>
          <div className="ov-list">
            {checks.map((c, i) => (
              <div key={i} className="ov-row">
                <span className={clsx('tag', c.ok ? 'ok' : 'warn')}>{c.ok ? '正常' : '建议完善'}</span>
                <span>{c.label}</span>
                <span className="spacer" />
                <Link to={c.to} className="btn xs ghost">{c.action}</Link>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
