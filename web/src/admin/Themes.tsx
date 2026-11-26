import { useEffect, useState } from 'react'
import { IExternal, IRefresh } from '../components/icons'
import { Seg, useToast } from '../components/ui'
import { api } from '../lib/api'
import { clsx } from '../lib/format'
import { THEMES, type ThemeDef } from '../themes/registry'
import { PageHead } from './common'

type Mode = 'auto' | 'dark' | 'light'

interface ConfigBits {
  site: { theme: string; theme_mode: Mode }
  history: { enabled: boolean; retention_days: number; active: boolean }
}

/** 用主题配色画一张迷你卡片作为预览 */
function Preview({ t, mode }: { t: ThemeDef; mode: 'dark' | 'light' }) {
  const [bg, card, a, b, c] = t.swatch[mode]
  const fg = mode === 'dark' ? 'rgba(255,255,255,.82)' : 'rgba(10,20,40,.78)'
  const dim = mode === 'dark' ? 'rgba(255,255,255,.12)' : 'rgba(10,20,40,.08)'
  return (
    <div className="th-prev" style={{ background: bg }}>
      <div className="th-prev-card" style={{ background: card, borderColor: dim }}>
        <div className="th-prev-row">
          <i style={{ background: dim, width: 18 }} />
          <i style={{ background: fg, width: 54, opacity: .85 }} />
          <span style={{ flex: 1 }} />
          <i style={{ background: b, width: 34, opacity: .9, borderRadius: 99 }} />
        </div>
        <div className="th-prev-bars">
          {[a, b, c, a].map((col, i) => (
            <div key={i}><i style={{ background: dim }}><em style={{ background: col, width: `${[38, 62, 25, 48][i]}%` }} /></i></div>
          ))}
        </div>
        <div className="th-prev-blocks">
          {Array.from({ length: 16 }, (_, i) => <i key={i} style={{ background: i < 7 ? c : dim }} />)}
        </div>
      </div>
    </div>
  )
}

export default function Themes() {
  const toast = useToast()
  const [cfg, setCfg] = useState<ConfigBits | null>(null)
  const [saving, setSaving] = useState(false)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [hist, setHist] = useState<{ enabled: boolean; retention_days: number } | null>(null)

  const load = () => api<ConfigBits>('/probe/config').then((c) => {
    setCfg(c)
    setHist({ enabled: c.history.enabled, retention_days: c.history.retention_days })
    setRestartNeeded(c.history.enabled !== c.history.active)
  }).catch((e) => toast(e.message, 'err'))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveSite = async (patch: Partial<ConfigBits['site']>) => {
    if (!cfg) return
    setSaving(true)
    try {
      await api('/probe/config', { method: 'PATCH', body: { site: patch } })
      setCfg({ ...cfg, site: { ...cfg.site, ...patch } })
      toast(patch.theme ? `已切换为「${THEMES.find((t) => t.id === patch.theme)?.name}」，所有访客刷新后生效` : '已保存', 'ok')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setSaving(false)
    }
  }

  const saveHistory = async () => {
    if (!hist) return
    setSaving(true)
    try {
      const r = await api<{ need_restart: boolean }>('/probe/config', { method: 'PATCH', body: { history: hist } })
      if (r?.need_restart) setRestartNeeded(true)
      toast(r?.need_restart ? '已保存，重启面板后生效' : '已保存', 'ok')
      load()
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setSaving(false)
    }
  }

  const restart = async () => {
    setRestarting(true)
    try {
      await api('/probe/restart', { method: 'POST' })
    } catch { /* 连接可能在响应前就断开 */ }
    // 等面板退出再回来
    const started = Date.now()
    await new Promise((r) => setTimeout(r, 3000))
    const poll = async (): Promise<void> => {
      try {
        await api('/setting')
        setRestarting(false)
        toast('面板已重启', 'ok')
        load()
      } catch {
        if (Date.now() - started > 60_000) {
          setRestarting(false)
          toast('面板没有自动拉起，请检查 docker restart 策略或 systemd 设置', 'err')
          return
        }
        await new Promise((r) => setTimeout(r, 2000))
        return poll()
      }
    }
    await poll()
  }

  if (!cfg || !hist) return <div className="empty">加载中…</div>

  return (
    <>
      <PageHead title="主题与外观" desc="选择前台主题与默认明暗。访客自己点过明暗切换后，以访客的选择为准。" />

      <section className="glass card-pad" style={{ marginBottom: 14 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h3 className="sec-title" style={{ margin: 0 }}>访客默认明暗</h3>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>"跟随系统"会按访客设备的深色/浅色设置显示。</p>
          </div>
          <Seg<Mode> value={cfg.site.theme_mode} onChange={(m) => saveSite({ theme_mode: m })} options={[
            { value: 'auto', label: '跟随系统' }, { value: 'dark', label: '深色' }, { value: 'light', label: '浅色' },
          ]} />
        </div>
      </section>

      <h3 className="sec-title" style={{ margin: '24px 2px 12px' }}>主题仓库</h3>
      <div className="th-grid">
        {THEMES.map((t) => {
          const active = cfg.site.theme === t.id
          return (
            <article key={t.id} className={clsx('glass th-card', active && 'active')}>
              <div className="th-prevs">
                <Preview t={t} mode="dark" />
                <Preview t={t} mode="light" />
              </div>
              <div className="th-body">
                <div className="row" style={{ gap: 8 }}>
                  <b className="th-name">{t.name}</b>
                  {active && <span className="tag ok">使用中</span>}
                  <span className="spacer" />
                  <span className="faint" style={{ fontSize: 12 }}>{t.author}</span>
                </div>
                <p className="muted th-desc">{t.desc}</p>
                <div className="wrap">{t.tags.map((x) => <span key={x} className="tag plain">{x}</span>)}<span className="tag plain">深色 + 浅色</span></div>
                <div className="row" style={{ gap: 8, marginTop: 14 }}>
                  <button className="btn primary sm" disabled={active || saving} onClick={() => saveSite({ theme: t.id })}>{active ? '当前主题' : '使用此主题'}</button>
                  <a className="btn sm" href={`/?theme=${t.id}`} target="_blank" rel="noreferrer"><IExternal />预览</a>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <h3 className="sec-title" style={{ margin: '28px 2px 12px' }}>历史数据</h3>
      <section className="glass card-pad">
        <div className="row" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="row" style={{ gap: 8 }}>
              <b>记录历史监控数据</b>
              {cfg.history.active ? <span className="tag ok">记录中</span> : <span className="tag warn">未记录</span>}
            </div>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.6 }}>
              开启后详情页可以看 7 天 / 30 天的 CPU、内存、网速与延迟曲线。数据存放在面板的 data/tsdb 目录，
              不需要手动修改任何配置文件。小内存服务器可把保留天数调短。
            </p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={hist.enabled} onChange={(e) => setHist({ ...hist, enabled: e.target.checked })} />
            <span />
          </label>
        </div>
        <div className="row" style={{ marginTop: 16, gap: 10, flexWrap: 'wrap' }}>
          <span className="label">保留</span>
          <Seg<number> value={hist.retention_days} onChange={(d) => setHist({ ...hist, retention_days: d })}
            options={[7, 15, 30, 90, 180].map((d) => ({ value: d, label: `${d} 天` }))} />
          <span className="spacer" />
          <button className="btn primary sm" disabled={saving || (hist.enabled === cfg.history.enabled && hist.retention_days === cfg.history.retention_days)} onClick={saveHistory}>保存</button>
        </div>
        {restartNeeded && (
          <div className="note warn row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 200 }}>设置已保存，需要重启面板才会生效（约 10 秒，期间页面会短暂断开）。</span>
            <button className="btn sm" disabled={restarting} onClick={restart}><IRefresh />{restarting ? '重启中…' : '立即重启面板'}</button>
          </div>
        )}
      </section>
    </>
  )
}
