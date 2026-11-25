import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, isUnauthorized, type Profile, type Setting } from '../lib/api'
import { useToast } from '../components/ui'

export interface AdminCtx {
  profile: Profile
  setting: Setting | null
  reloadSetting: () => void
  logout: () => void
}

export const Ctx = createContext<AdminCtx>(null as unknown as AdminCtx)
export const useAdmin = () => useContext(Ctx)

/** 读取列表接口；空列表时面板会省略 data，这里统一成 [] */
export function useList<T>(path: string) {
  const [data, setData] = useState<T[] | null>(null)
  const [error, setError] = useState('')
  const toast = useToast()
  const reload = useCallback(() => {
    api<T[]>(path)
      .then((d) => { setData(d || []); setError('') })
      .catch((e) => {
        setError(e.message)
        if (isUnauthorized(e)) location.reload()
        else toast(e.message, 'err')
      })
  }, [path, toast])
  useEffect(() => { reload() }, [reload])
  return { data, error, reload }
}

/** 包装一次写操作：成功提示 + 刷新，失败弹错误 */
export function useAction() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast(ok, 'ok')
      return true
    } catch (e) {
      toast((e as Error).message, 'err')
      return false
    } finally {
      setBusy(false)
    }
  }, [toast])
  return { busy, run }
}

export function PageHead({ title, desc, children }: { title: string; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ph">
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      <span className="spacer" />
      {children}
    </div>
  )
}

export function confirmDelete(what: string) {
  return window.confirm(`确定删除「${what}」吗？此操作不可撤销。`)
}

/** 服务器多选（用于监控/告警的覆盖范围） */
export function ServerPicker({ servers, value, onChange }: {
  servers: { id: number; name: string }[]
  value: Record<string, boolean>
  onChange: (v: Record<string, boolean>) => void
}) {
  if (!servers.length) return <div className="muted">还没有服务器</div>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
      {servers.map((s) => (
        <label key={s.id} className="check">
          <input type="checkbox" checked={!!value[s.id]} onChange={(e) => {
            const n = { ...value }
            if (e.target.checked) n[s.id] = true
            else delete n[s.id]
            onChange(n)
          }} />
          {s.name}
        </label>
      ))}
    </div>
  )
}

export const toDateInput = (s?: string) => {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** yyyy-mm-dd → 本地时区 00:00 的 RFC3339 字符串（带偏移，与官方前端格式一致） */
export const fromDateInput = (s: string) => {
  if (!s) return ''
  const d = new Date(`${s}T00:00:00`)
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  return `${s}T00:00:00${sign}${p(off / 60)}:${p(off % 60)}`
}
