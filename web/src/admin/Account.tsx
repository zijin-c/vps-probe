import { useState } from 'react'
import { Field, useToast } from '../components/ui'
import { api } from '../lib/api'
import { PageHead, useAdmin } from './common'

export default function Account() {
  const { profile } = useAdmin()
  const toast = useToast()
  const [orig, setOrig] = useState('')
  const [user, setUser] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pw && pw.length < 8) return toast('新密码至少 8 位', 'err')
    if (pw !== pw2) return toast('两次输入的新密码不一致', 'err')
    setBusy(true)
    try {
      await api('/profile', { method: 'POST', body: { original_password: orig, new_username: user || undefined, new_password: pw || undefined } })
      toast('已保存，请重新登录', 'ok')
      setTimeout(() => location.reload(), 1200)
    } catch (err) {
      toast((err as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead title="账户" desc={`当前用户：${profile.username}${profile.login_ip ? ` · 登录 IP ${profile.login_ip}` : ''}`} />
      <form className="glass card-pad" style={{ maxWidth: 520, display: 'grid', gap: 14 }} onSubmit={save}>
        {profile.username === 'admin' && <div className="note warn">你还在用默认用户名 admin，部署到公网前务必修改用户名和密码。</div>}
        <Field label="当前密码"><input className="input" type="password" autoComplete="current-password" value={orig} onChange={(e) => setOrig(e.target.value)} /></Field>
        <Field label="新用户名" hint="留空不修改"><input className="input" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} /></Field>
        <Field label="新密码" hint="至少 8 位，留空不修改"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="确认新密码"><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <div><button className="btn primary" disabled={busy || !orig || (!user && !pw)}>保存</button></div>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>保存后所有已登录的会话都会失效，需要重新登录。</p>
      </form>
    </>
  )
}
