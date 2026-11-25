// 与面板 TG 机器人（service/probe/view.go）一致的"公开备注"解析。
// 格式兼容官方前端：{ billingDataMod: {...}, planDataMod: {...} }

export interface BillingData {
  startDate?: string
  endDate?: string
  autoRenewal?: string
  cycle?: string
  amount?: string
}

export interface PlanData {
  bandwidth?: string
  trafficVol?: string
  trafficType?: string
  IPv4?: string
  IPv6?: string
  networkRoute?: string
  extra?: string
}

export interface PublicNote {
  billingDataMod?: BillingData
  planDataMod?: PlanData
}

export interface Billing {
  known: boolean
  permanent: boolean
  free: boolean
  amount: string
  cycle: string
  cycleLabel: string
  cycleMonths: number
  end?: Date
  autoRenewal: boolean
  daysLeft?: number
  remainingValue?: string
}

export function parseNote(raw?: string): PublicNote {
  if (!raw || !raw.trim().startsWith('{')) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function cycleMonths(s = ''): number {
  const l = s.toLowerCase().trim()
  const m = l.match(/\d+/)
  const mult = m ? Math.max(1, parseInt(m[0], 10)) : 1
  if (/month|月|^mo$/.test(l)) return mult
  if (/quarter|季/.test(l)) return 3 * mult
  if (/half|半/.test(l)) return 6 * mult
  if (/year|年|^yr$/.test(l)) return 12 * mult
  return 0
}

export function cycleLabel(months: number, raw = ''): string {
  switch (months) {
    case 1: return '月'
    case 3: return '季'
    case 6: return '半年'
    case 12: return '年'
    case 24: return '两年'
    case 36: return '三年'
  }
  return raw || ''
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d)
  r.setMonth(r.getMonth() + n)
  return r
}

export function parseBilling(note: PublicNote, now = new Date()): Billing {
  const b = note.billingDataMod || {}
  const months = cycleMonths(b.cycle)
  const amount = (b.amount || '').trim()
  const res: Billing = {
    known: false,
    permanent: false,
    free: amount === '0' || amount === '-1' || /free|免费/i.test(amount),
    amount,
    cycle: b.cycle || '',
    cycleLabel: cycleLabel(months, b.cycle),
    cycleMonths: months,
    autoRenewal: b.autoRenewal === '1' || b.autoRenewal === 'true',
  }
  if (!b.endDate) return res
  if (b.endDate.startsWith('0000')) {
    res.known = true
    res.permanent = true
    return res
  }
  let end = new Date(b.endDate)
  if (isNaN(end.getTime())) return res
  if (res.autoRenewal && months > 0) {
    for (let i = 0; end < now && i < 1200; i++) end = addMonths(end, months)
  }
  res.known = true
  res.end = end
  res.daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000)
  const num = amount.match(/\d+(?:\.\d+)?/)
  if (num && months > 0 && res.daysLeft > 0) {
    const price = parseFloat(num[0])
    const start = addMonths(end, -months)
    const cycleDays = (end.getTime() - start.getTime()) / 86400000
    const remainDays = (end.getTime() - now.getTime()) / 86400000
    if (price > 0) res.remainingValue = amount.replace(num[0], ((price * remainDays) / cycleDays).toFixed(2))
  }
  return res
}

/** 价格展示，如 "$10 / 年" */
export function priceText(b: Billing): string {
  if (b.free) return '免费'
  if (!b.amount) return ''
  return b.cycleLabel ? `${b.amount} / ${b.cycleLabel}` : b.amount
}

/** "CN2 GIA,9929|CMIN2" → ["CN2 GIA","9929","CMIN2"] */
export function splitTags(s?: string): string[] {
  return (s || '')
    .split(/[,，|/、]+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/** "256GB" / "1TB" → bytes；无法解析返回 0 */
export function parseVolume(s?: string): number {
  const m = (s || '').trim().match(/^([\d.]+)\s*([KMGTP]?)i?B?$/i)
  if (!m) return 0
  const n = parseFloat(m[1])
  const p = 'BKMGTP'.indexOf((m[2] || 'B').toUpperCase())
  return n * Math.pow(1024, Math.max(0, p))
}
