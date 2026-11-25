import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ISearch } from '../components/icons'
import { Modal, useToast } from '../components/ui'
import { api, isUnauthorized, type Profile, type Setting } from '../lib/api'
import { clsx } from '../lib/format'

export interface AdminCtx {
  profile: Profile
  setting: Setting | null
  reloadSetting: () => void
  logout: () => void
}

export const Ctx = createContext<AdminCtx>(null as unknown as AdminCtx)
export const useAdmin = () => useContext(Ctx)

// ---- 全局玻璃风确认弹窗（替代 window.confirm）----
export interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>
const ConfirmCtx = createContext<ConfirmFn>(async () => false)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setReq(opts)
    })
  }, [])

  const finish = useCallback((v: boolean) => {
    resolver.current?.(v)
    resolver.current = null
    setReq(null)
  }, [])

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {req && (
        <Modal
          title={req.title}
          onClose={() => finish(false)}
          width={440}
          footer={
            <>
              <button className="btn" onClick={() => finish(false)}>{req.cancelText || '取消'}</button>
              <button
                className={clsx('btn', req.danger ? 'danger solid' : 'primary')}
                onClick={() => finish(true)}
                autoFocus
              >
                {req.confirmText || '确定'}
              </button>
            </>
          }
        >
          <div style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--fg-2)' }}>{req.message}</div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  )
}

export const useConfirm = () => useContext(ConfirmCtx)

export function useConfirmDelete() {
  const confirm = useConfirm()
  return useCallback(
    (what: string, detail?: string) =>
      confirm({
        title: '确认删除',
        message: (
          <>
            确定删除「<b>{what}</b>」吗？{detail ? <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>{detail}</div> : '此操作不可撤销。'}
          </>
        ),
        confirmText: '删除',
        danger: true,
      }),
    [confirm],
  )
}

/** 读取列表接口；空列表时面板会省略 data，这里统一成 [] */
export function useList<T>(path: string) {
  const [data, setData] = useState<T[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const toast = useToast()
  const reload = useCallback(() => {
    setLoading(true)
    api<T[]>(path)
      .then((d) => { setData(d || []); setError('') })
      .catch((e) => {
        setError(e.message)
        if (isUnauthorized(e)) location.reload()
        else toast(e.message, 'err')
      })
      .finally(() => setLoading(false))
  }, [path, toast])
  useEffect(() => { reload() }, [reload])
  return { data, loading, error, reload }
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
      <div className="row" style={{ flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

/** 轻量开关控件 */
export function Switch({ checked, onChange, disabled, label }: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={clsx('switch', checked && 'on')}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  )
}

/** 服务器多选（带搜索、全选/反选/清空） */
export function ServerPicker({ servers, value, onChange }: {
  servers: { id: number; name: string }[]
  value: Record<string, boolean>
  onChange: (v: Record<string, boolean>) => void
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? servers.filter((x) => x.name.toLowerCase().includes(s) || String(x.id).includes(s)) : servers
  }, [servers, q])

  if (!servers.length) return <div className="muted">还没有服务器</div>

  const selectedCount = servers.filter((s) => value[s.id]).length
  const selectAll = () => {
    const next = { ...value }
    filtered.forEach((s) => { next[s.id] = true })
    onChange(next)
  }
  const invert = () => {
    const next = { ...value }
    filtered.forEach((s) => {
      if (next[s.id]) delete next[s.id]
      else next[s.id] = true
    })
    onChange(next)
  }
  const clearAll = () => {
    if (!q.trim()) return onChange({})
    const next = { ...value }
    filtered.forEach((s) => { delete next[s.id] })
    onChange(next)
  }

  return (
    <div className="picker">
      <div className="picker-bar">
        {servers.length > 6 && (
          <div className="pill-input" style={{ width: 180 }}>
            <ISearch />
            <input className="input" style={{ height: 30, fontSize: 12.5 }} placeholder="筛选服务器…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
        <span className="muted" style={{ fontSize: 12 }}>已选 {selectedCount} / {servers.length}</span>
        <span className="spacer" />
        <button type="button" className="btn xs ghost" onClick={selectAll}>全选</button>
        <button type="button" className="btn xs ghost" onClick={invert}>反选</button>
        <button type="button" className="btn xs ghost" onClick={clearAll} disabled={selectedCount === 0}>清空</button>
      </div>
      <div className="picker-grid">
        {filtered.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: '6px 0' }}>没有匹配的服务器</div>}
        {filtered.map((s) => {
          const on = !!value[s.id]
          return (
            <label key={s.id} className={clsx('picker-item', on && 'on')}>
              <input type="checkbox" checked={on} onChange={(e) => {
                const n = { ...value }
                if (e.target.checked) n[s.id] = true
                else delete n[s.id]
                onChange(n)
              }} />
              <span>{s.name}</span>
            </label>
          )
        })}
      </div>
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
