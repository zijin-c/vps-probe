import { useState } from 'react'
import { Field } from '../components/ui'
import { Mark, Radar } from '../components/art'
import { ThemeButton } from '../components/Topbar'
import { api } from '../lib/api'

export default function Login({ siteName, onLogin }: { siteName?: string; onLogin: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await api('/login', { method: 'POST', body: { username, password } })
      onLogin()
    } catch (e) {
      const m = (e as Error).message
      setErr(m === '未登录或登录已过期' ? '用户名或密码不正确' : m)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <aside className="login-art">
        <Radar servers={[]} />
        <div className="wordmark"><Mark /><span>{siteName || 'VPS 探针'}</span></div>
        <div className="login-quote">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Read-only observatory</div>
          <h2>看得见每一台机器，<br /><em>却碰不到</em>任何一台。</h2>
          <p>面板与 Agent 双侧移除了终端、命令与文件管理。这里只有观测，没有遥控。</p>
        </div>
      </aside>
      <div className="login-side">
      <div style={{ position: 'fixed', top: 14, right: 14 }}><ThemeButton /></div>
      <form className="login-box" onSubmit={submit}>
        <div className="eyebrow">Console · 后台</div>
        <div>
          <h1>登录</h1>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>管理服务器、监控与告警</p>
        </div>
        <Field label="用户名"><input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="密码"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {err && <div className="note bad">{err}</div>}
        <button className="btn primary" disabled={busy || !username || !password} style={{ height: 36 }}>{busy ? '登录中…' : '登录'}</button>
        <a href="/" className="muted" style={{ fontSize: 13, textAlign: 'center' }}>返回前台</a>
      </form>
      </div>
    </div>
  )
}
