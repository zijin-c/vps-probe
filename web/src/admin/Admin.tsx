import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Mark, ThemeButton } from '../components/Topbar'
import {
  IArchive, IBell, IGrid, IHome, ILayers, ILogout, IMenu, IPulse, ISend, IServer, ISettings, ISliders, IUser, IX,
} from '../components/icons'
import { api, getSetting, type Profile, type Setting } from '../lib/api'
import { useTitle } from '../lib/hooks'
import { ConfirmProvider, Ctx } from './common'
import Login from './Login'
import Overview from './Overview'
import Servers from './Servers'
import Groups from './Groups'
import Monitors from './Monitors'
import Alerts from './Alerts'
import Notifications from './Notifications'
import ProbeConfig from './ProbeConfig'
import Settings from './Settings'
import Backup from './Backup'
import Account from './Account'

const NAV: { group: string; items: { to: string; label: string; icon: typeof IServer }[] }[] = [
  { group: '总览', items: [
    { to: 'overview', label: '概览', icon: IGrid },
  ] },
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
    { to: 'probe', label: '探针配置', icon: ISliders },
    { to: 'backup', label: '备份与恢复', icon: IArchive },
    { to: 'settings', label: '系统设置', icon: ISettings },
    { to: 'account', label: '账户', icon: IUser },
  ] },
]

export default function Admin() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [setting, setSetting] = useState<Setting | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const loc = useLocation()
  useTitle(`后台 · ${setting?.config.site_name || 'VPS 探针'}`)

  const loadProfile = useCallback(() => { api<Profile>('/profile').then(setProfile).catch(() => setProfile(null)) }, [])
  const reloadSetting = useCallback(() => { getSetting().then(setSetting).catch(() => {}) }, [])
  useEffect(() => { loadProfile(); reloadSetting() }, [loadProfile, reloadSetting])
  useEffect(() => { setDrawerOpen(false) }, [loc.pathname])

  const logout = useCallback(async () => {
    try { await api('/logout', { method: 'POST' }) } catch { /* 会话已过期也无妨 */ }
    setProfile(null)
  }, [])

  if (profile === undefined) return <div className="empty">加载中…</div>
  if (profile === null) return <Login siteName={setting?.config.site_name} onLogin={() => { loadProfile(); reloadSetting() }} />

  const site = setting?.config.site_name || 'VPS 探针'
  const link = (n: { to: string; label: string; icon: typeof IServer }) => (
    <NavLink key={n.to} to={`/dashboard/${n.to}`} className={({ isActive }) => `nav${isActive ? ' on' : ''}`}>
      <n.icon />{n.label}
    </NavLink>
  )

  const navContent = (
    <>
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
    </>
  )

  return (
    <Ctx.Provider value={{ profile, setting, reloadSetting, logout }}>
      <ConfirmProvider>
        <div className="admin">
          <aside className="side float">
            <a href="/" className="wordmark"><Mark /><span>{site}</span></a>
            {navContent}
          </aside>
          <div style={{ minWidth: 0 }}>
            {/* 窄屏顶部栏 + 抽屉导航 */}
            <div className="admin-top">
              <button className="iconbtn" onClick={() => setDrawerOpen(true)} aria-label="打开菜单"><IMenu /></button>
              <a href="/" className="wordmark"><Mark /><span>{site}</span></a>
              <span className="spacer" />
              <ThemeButton />
              <button className="iconbtn" title="退出登录" aria-label="退出登录" onClick={logout}><ILogout /></button>
            </div>
            {drawerOpen && (
              <>
                <div className="drawer-back" onClick={() => setDrawerOpen(false)} />
                <aside className="drawer float">
                  <div className="row" style={{ padding: '4px 6px 10px 10px' }}>
                    <a href="/" className="wordmark"><Mark /><span>{site}</span></a>
                    <span className="spacer" />
                    <button className="iconbtn" onClick={() => setDrawerOpen(false)} aria-label="关闭菜单"><IX /></button>
                  </div>
                  {navContent}
                </aside>
              </>
            )}
            <main className="main">
              <Routes>
                <Route index element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<Overview />} />
                <Route path="servers" element={<Servers />} />
                <Route path="groups" element={<Groups />} />
                <Route path="monitors" element={<Monitors />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="probe" element={<ProbeConfig />} />
                <Route path="settings" element={<Settings />} />
                <Route path="backup" element={<Backup />} />
                <Route path="account" element={<Account />} />
                <Route path="*" element={<Navigate to="overview" replace />} />
              </Routes>
            </main>
          </div>
        </div>
      </ConfirmProvider>
    </Ctx.Provider>
  )
}
