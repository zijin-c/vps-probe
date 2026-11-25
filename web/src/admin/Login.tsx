import { useState } from 'react'
import { Field } from '../components/ui'
import { Mark, ThemeButton } from '../components/Topbar'
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
      <div style={{ position: 'fixed', top: 14, right: 14 }}><ThemeButton /></div>
      <form className="login-box glass" onSubmit={submit}>
        <div className="wordmark"><Mark /><span>{siteName || 'VPS 探针'}</span></div>
        <div>
          <h1>登录后台</h1>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>管理服务器、监控与告警</p>
        </div>
        <Field label="用户名"><input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="密码"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {err && <div className="note bad">{err}</div>}
        <button className="btn primary" disabled={busy || !username || !password} style={{ height: 36 }}>{busy ? '登录中…' : '登录'}</button>
        <a href="/" className="muted" style={{ fontSize: 13, textAlign: 'center' }}>返回前台</a>
      </form>
    </div>
  )
}
