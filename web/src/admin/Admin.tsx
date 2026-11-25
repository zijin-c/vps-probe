import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Mark, ThemeButton } from '../components/Topbar'
import { IArchive, IBell, IHome, ILayers, ILogout, IPulse, IServer, ISettings, IUser, ISend } from '../components/icons'
import { api, getSetting, type Profile, type Setting } from '../lib/api'
import { useTitle } from '../lib/hooks'
import { Ctx } from './common'
import Login from './Login'
import Servers from './Servers'
import Groups from './Groups'
import Monitors from './Monitors'
import Alerts from './Alerts'
import Notifications from './Notifications'
import Settings from './Settings'
import Backup from './Backup'
import Account from './Account'

const NAV: { group: string; items: { to: string; label: string; icon: typeof IServer }[] }[] = [
  { group: '监控', items: [
    { to: 'servers', label: '服务器', icon: IServer },
    { to: 'groups', label: '分组', icon: ILayers },
    { to: 'monitors', label: '延迟监控', icon: IPulse },
  ] },
  { group: '告警', items: [
    { to: 'alerts', label: '告警规则', icon: IBell },
    { to: 'notifications', label: '通知方式', icon: ISend },
  ] },
  { group: '系统', items: [
    { to: 'settings', label: '设置', icon: ISettings },
    { to: 'backup', label: '备份与恢复', icon: IArchive },
    { to: 'account', label: '账户', icon: IUser },
  ] },
]

export default function Admin() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [setting, setSetting] = useState<Setting | null>(null)
  useTitle(`后台 · ${setting?.config.site_name || 'VPS 探针'}`)

  const loadProfile = useCallback(() => { api<Profile>('/profile').then(setProfile).catch(() => setProfile(null)) }, [])
  const reloadSetting = useCallback(() => { getSetting().then(setSetting).catch(() => {}) }, [])
  useEffect(() => { loadProfile(); reloadSetting() }, [loadProfile, reloadSetting])

  const logout = useCallback(async () => {
    try { await api('/logout', { method: 'POST' }) } catch { /* 会话已过期也无妨 */ }
    setProfile(null)
  }, [])

  if (profile === undefined) return <div className="empty">加载中…</div>
  if (profile === null) return <Login siteName={setting?.config.site_name} onLogin={() => { loadProfile(); reloadSetting() }} />

  const site = setting?.config.site_name || 'VPS 探针'
  const link = (n: { to: string; label: string; icon: typeof IServer }) => (
    <NavLink key={n.to} to={`/dashboard/${n.to}`} className={({ isActive }) => `nav${isActive ? ' on' : ''}`}><n.icon />{n.label}</NavLink>
  )

  return (
    <Ctx.Provider value={{ profile, setting, reloadSetting, logout }}>
      <div className="admin">
        <aside className="side float">
          <a href="/" className="wordmark"><Mark /><span>{site}</span></a>
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map(link)}
            </div>
          ))}
          <span className="spacer" />
          <a className="nav" href="/"><IHome />查看前台</a>
          <div className="side-foot">
            <div className="who">{profile.username}<small>只读模式{setting?.version ? ` · ${setting.version}` : ''}</small></div>
            <ThemeButton />
            <button className="iconbtn" title="退出登录" aria-label="退出登录" onClick={logout}><ILogout /></button>
          </div>
        </aside>
        <div style={{ minWidth: 0 }}>
          {/* 窄屏：顶部品牌 + 底部悬浮玻璃标签栏 */}
          <div className="admin-top">
            <a href="/" className="wordmark"><Mark /><span>{site}</span></a>
            <span className="spacer" />
            <ThemeButton />
            <button className="iconbtn" title="退出登录" aria-label="退出登录" onClick={logout}><ILogout /></button>
          </div>
          <nav className="tabbar float">
            {NAV.flatMap((g) => g.items).map(link)}
          </nav>
          <main className="main">
            <Routes>
              <Route index element={<Navigate to="servers" replace />} />
              <Route path="servers" element={<Servers />} />
              <Route path="groups" element={<Groups />} />
              <Route path="monitors" element={<Monitors />} />
              <Route path="alerts" element={<Alerts />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="settings" element={<Settings />} />
              <Route path="backup" element={<Backup />} />
              <Route path="account" element={<Account />} />
              <Route path="*" element={<Navigate to="servers" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </Ctx.Provider>
  )
}
