export type Tone = 'ok' | 'warn' | 'bad' | 'neutral'

const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB']

/** 返回 [数值, 单位]，方便把单位排成小字 */
export function bytesParts(b: number | undefined | null, digits = 1): [string, string] {
  const v = Number(b) || 0
  if (v < 1024) return [v.toFixed(0), 'B']
  let n = v / 1024
  let i = 0
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024
    i++
  }
  return [n.toFixed(n >= 100 ? 0 : digits), UNITS[i]]
}

export function fmtBytes(b: number | undefined | null, digits = 1): string {
  const [n, u] = bytesParts(b, digits)
  return `${n} ${u}`
}

/** 用量对："15/32 GB"（同单位时合并单位），否则 "512 MB/2 GB" */
export function fmtPair(used: number | undefined, total: number | undefined): string {
  const [a, ua] = bytesParts(used, 1)
  const [b, ub] = bytesParts(total, 0)
  return ua === ub ? `${a}/${b} ${ub}` : `${a} ${ua}/${b} ${ub}`
}

export function fmtSpeed(b: number | undefined | null): string {
  return `${fmtBytes(b)}/s`
}

export function fmtPct(v: number | undefined | null, digits = 1): string {
  return `${(Number(v) || 0).toFixed(digits)}%`
}

export function pct(used?: number, total?: number): number {
  if (!total) return 0
  return Math.min(100, Math.max(0, ((used || 0) * 100) / total))
}

/** 运行时长：12 分钟 / 5 小时 / 4 天 */
export function fmtUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} 分钟`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时`
  return `${Math.floor(s / 86400)} 天`
}

export function fmtAgo(date: string | undefined, now = Date.now()): string {
  if (!date || date.startsWith('0001')) return '从未上线'
  const t = Date.parse(date)
  if (!t) return '从未上线'
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return '刚刚'
  return `${fmtUptime(s)}前`
}

export function fmtDate(d: Date | undefined, withTime = false): string {
  if (!d || isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return withTime ? `${s} ${p(d.getHours())}:${p(d.getMinutes())}` : s
}

export function fmtAxisTime(ts: number, spanMs: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  if (spanMs <= 2 * 86400e3) return `${p(d.getHours())}:${p(d.getMinutes())}`
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function fmtTipTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function usageTone(p: number): Tone {
  if (p >= 90) return 'bad'
  if (p >= 70) return 'warn'
  return 'ok'
}

/** 延迟分级：以国内访问海外的常见水平为参照 */
export function latencyTone(ms: number | null | undefined): Tone {
  if (ms == null || ms <= 0) return 'neutral'
  if (ms < 180) return 'ok'
  if (ms < 300) return 'warn'
  return 'bad'
}

export const toneVar = (t: Tone) => (t === 'neutral' ? 'var(--faint)' : `var(--${t})`)

export function clsx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ')
}

/** IPv4 遮罩成 1.2.*.*，IPv6 只留前两段 */
export function maskIP(ip?: string): string {
  if (!ip) return ''
  if (ip.includes(':')) return `${ip.split(':').slice(0, 2).join(':')}:*`
  const p = ip.split('.')
  return p.length === 4 ? `${p[0]}.${p[1]}.*.*` : ip
}
