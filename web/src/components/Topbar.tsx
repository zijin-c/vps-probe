import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useNow } from '../lib/hooks'
import { useTheme } from '../lib/theme'
import { Mark } from './art'
import { IMoon, ISun, ITopology, IUser } from './icons'

export { Mark }

export function ThemeButton() {
  const [theme, toggle] = useTheme()
  return (
    <button className="iconbtn" onClick={toggle} title={theme === 'dark' ? '浅色模式' : '深色模式'} aria-label="切换明暗">
      {theme === 'dark' ? <ISun /> : <IMoon />}
    </button>
  )
}

/** 顶栏右侧的 UTC 时钟，等宽数字，像仪器面板上的读数 */
function Clock() {
  const now = new Date(useNow(1000))
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <span className="clock" title="协调世界时">
      <span className="clock-k">UTC</span>
      {p(now.getUTCHours())}<i>:</i>{p(now.getUTCMinutes())}<i>:</i>{p(now.getUTCSeconds())}
    </span>
  )
}

export default function Topbar({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="header">
      <div className="header-in">
        <Link to="/" className="wordmark"><Mark /><span>{title}</span></Link>
        <span className="spacer" />
        {right}
        <Clock />
        <span className="hdr-sep" />
        <ThemeButton />
        <Link className="iconbtn" to="/topology" title="网络拓扑" aria-label="网络拓扑"><ITopology /></Link>
        <a className="iconbtn" href="/dashboard/" title="后台" aria-label="后台"><IUser /></a>
      </div>
    </header>
  )
}
