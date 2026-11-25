import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { clsx, latencyTone, usageTone, type Tone } from '../lib/format'
import { IX } from './icons'

/** 细进度条；tone 不传时按用量自动着色 */
export function Meter({ value, tone }: { value: number; tone?: Tone }) {
  const v = Math.max(0, Math.min(100, value || 0))
  const t = tone ?? usageTone(v)
  return (
    <div className={clsx('meter', t)} role="meter" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${v}%` }} />
    </div>
  )
}

/** 环形仪表 */
export function Ring({ value, size = 44, stroke = 5 }: { value: number; size?: number; stroke?: number }) {
  const v = Math.max(0, Math.min(100, value || 0))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const tone = usageTone(v)
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`var(--${tone})`} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .8s cubic-bezier(.2,.8,.2,1)' }} />
    </svg>
  )
}

/** 数字平滑过渡（实时数据每 2 秒更新时不跳变） */
export function AnimNum({ value, format }: { value: number; format: (v: number) => string }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    const b = value
    if (a === b || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(b); from.current = b; return }
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 600)
      const e = 1 - Math.pow(1 - k, 3)
      const v = a + (b - a) * e
      setShown(v)
      from.current = v
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{format(shown)}</>
}

/**
 * 延迟迷你折线：null 表示该采样不可达，在底部画红点。
 * viewBox 0..100 × 0..20，宽度随容器拉伸。
 */
export function Sparkline({ values, max }: { values: (number | null)[]; max?: number }) {
  const pts = values.slice(-40)
  const id = useRef(`sg${Math.random().toString(36).slice(2, 8)}`).current
  if (pts.length < 2) return <svg className="spark" viewBox="0 0 100 20" preserveAspectRatio="none" />
  const finite = pts.filter((v): v is number => v != null)
  const hi = max ?? Math.max(1, ...finite) * 1.12
  const lo = finite.length ? Math.min(...finite) * 0.88 : 0
  const step = 100 / (pts.length - 1)
  const y = (v: number) => 17 - ((v - lo) / Math.max(1, hi - lo)) * 15
  let d = ''
  let area = ''
  let pen = false
  let segStart = 0
  let lastX = 0
  pts.forEach((v, i) => {
    const x = i * step
    if (v == null) {
      if (pen) area += `L${lastX.toFixed(2)},20L${segStart.toFixed(2)},20Z`
      pen = false
      return
    }
    if (!pen) segStart = x
    d += `${pen ? 'L' : 'M'}${x.toFixed(2)},${y(v).toFixed(2)}`
    area += `${pen ? 'L' : 'M'}${x.toFixed(2)},${y(v).toFixed(2)}`
    lastX = x
    pen = true
  })
  if (pen) area += `L${lastX.toFixed(2)},20L${segStart.toFixed(2)},20Z`
  const last = [...pts].reverse().find((v) => v != null)
  const tone = latencyTone(last ?? null)
  const color = tone === 'neutral' ? 'var(--faint)' : `var(--${tone})`
  return (
    <svg className="spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((v, i) => v == null && <circle key={i} cx={i * step} cy={18.5} r={0.9} fill="var(--bad)" />)}
    </svg>
  )
}

export function Modal({ title, onClose, children, footer, width }: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal float" style={width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog" aria-modal="true">
        <div className="modal-h">
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <span className="spacer" />
          <button className="iconbtn" onClick={onClose} aria-label="关闭"><IX /></button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, hint, children, full }: { label: ReactNode; hint?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <label className={clsx('fld', full && 'full')}>
      <span>{label}</span>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </label>
  )
}

/** 胶囊分段控件，选中项下面有一块滑动的玻璃滑块 */
export function Seg<T extends string | number>({ value, options, onChange, label, className }: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  label?: string
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  // 首次绘制不做滑动动画，只有用户切换后才动
  const [animate, setAnimate] = useState(false)
  useEffect(() => { const t = setTimeout(() => setAnimate(true), 50); return () => clearTimeout(t) }, [])
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLButtonElement>('button.on')
    if (!el) return setThumb(null)
    const measure = () => setThumb({ left: el.offsetLeft, width: el.offsetWidth })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [value, options.length])
  return (
    <div ref={box} className={clsx('seg', className)} role="group" aria-label={label}>
      {thumb && <span className="thumb" style={{ left: thumb.left, width: thumb.width, transition: animate ? undefined : 'none' }} />}
      {options.map((o) => (
        <button key={String(o.value)} type="button" title={o.title} aria-pressed={o.value === value}
          className={clsx(o.value === value && 'on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---- Toast ----
type ToastItem = { id: number; text: string; kind: 'ok' | 'err' | 'info' }
const ToastCtx = createContext<(text: string, kind?: ToastItem['kind']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, kind: ToastItem['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setItems((xs) => [...xs.slice(-2), { id, text, kind }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'err' ? 5000 : 2600)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => <div key={t.id} className={clsx('toast float', t.kind)}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
  return Promise.resolve()
}

/** 卡片上的指针柔光：更新 CSS 变量 --mx / --my */
export function glowHandlers() {
  return {
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
      e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
    },
  }
}
