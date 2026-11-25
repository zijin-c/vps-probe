import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../lib/theme'
import { IMoon, ISun, IUser } from './icons'

/** 品牌标记：玻璃质感的圆角方块 + 脉冲线 */
export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="mk-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".22" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".06" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="7" fill="url(#mk-fill)" stroke="currentColor" strokeOpacity=".35" />
      <path d="M5.5 12.5h3l1.8-4 2.6 7.5 1.8-3.5h3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ThemeButton() {
  const [theme, toggle] = useTheme()
  return (
    <button className="iconbtn" onClick={toggle} title={theme === 'dark' ? '浅色模式' : '深色模式'} aria-label="切换明暗">
      {theme === 'dark' ? <ISun /> : <IMoon />}
    </button>
  )
}

export default function Topbar({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="header">
      <div className="header-in float">
        <Link to="/" className="wordmark"><Mark /><span>{title}</span></Link>
        <span className="spacer" />
        {right}
        <ThemeButton />
        <a className="iconbtn" href="/dashboard/" title="后台" aria-label="后台"><IUser /></a>
      </div>
    </header>
  )
}
