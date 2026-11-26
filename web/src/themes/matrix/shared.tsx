// 矩阵主题的公共小部件：卡片、首页概览、详情页共用
import type { UnlockItem } from '../../lib/api'
import { bytesParts, clsx } from '../../lib/format'
import type { LatencyLine } from '../../lib/hooks'

/** 27天18小时 / 5小时12分 / 12分 */
export function fmtLongUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}天${h}小时`
  if (h > 0) return `${h}小时${m}分`
  return `${Math.max(1, m)}分`
}

/** 按服务器所在地区设定到国内的物理延迟基准（ms） */
export function regionBaseline(cc?: string): { base: number; label: string } {
  const c = (cc || '').toUpperCase()
  if (['CN', 'HK', 'MO', 'TW'].includes(c)) return { base: 35, label: '港澳台/大陆' }
  if (['JP', 'KR', 'SG', 'MY', 'TH', 'VN', 'PH', 'ID', 'IN'].includes(c)) return { base: 80, label: '亚太' }
  if (['US', 'CA', 'AU', 'NZ', 'RU'].includes(c)) return { base: 165, label: '北美/澳新' }
  if (c) return { base: 220, label: '欧非/南美' }
  return { base: 100, label: '默认' }
}

export const toneOfMs = (ms: number | null | undefined, base = 100) => {
  if (ms == null) return 'bad'
  if (ms <= 0) return 'ok'
  if (ms <= base * 1.25) return 'ok'
  if (ms <= base * 1.75) return 'warn'
  return 'bad'
}

export const isPremiumRoute = (label?: string, prem?: boolean) =>
  !!prem || !!(label && /CN2\s*GIA|9929|CMIN2|CTGNet/i.test(label))

/** 方块进度条 */
export function Blocks({ value, n = 30, tone }: { value: number; n?: number; tone?: string }) {
  const v = Math.max(0, Math.min(100, value))
  const lit = v > 0 ? Math.max(1, Math.round((v / 100) * n)) : 0
  const t = tone || (v >= 90 ? 'bad' : v >= 70 ? 'warn' : 'ok')
  return (
    <div className="mx-blocks" style={{ ['--n' as string]: n }} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < lit ? t : ''} />)}
    </div>
  )
}

/** 最近 n 次采样的柱状图：高度 = 延迟，颜色 = 相对地区基准的快慢，超时为满高红柱 */
export function Bars({ values, base = 100, n = 28 }: { values: (number | null)[]; base?: number; n?: number }) {
  const pts = values.slice(-n)
  const valid = pts.filter((x): x is number => x != null)
  const top = valid.length ? Math.max(...valid) * 1.15 : 1
  return (
    <div className="mx-bars" style={{ ['--n' as string]: n }} aria-hidden="true">
      {Array.from({ length: n - pts.length }, (_, i) => <i key={`p${i}`} />)}
      {pts.map((v, i) => (
        <i key={i} className={v == null ? 'bad' : toneOfMs(v, base)} style={{ height: v == null ? '100%' : `${Math.max(18, (v / top) * 100)}%` }} />
      ))}
    </div>
  )
}

/** 线路质量评分：按地区物理延迟基准 + 丢包 + 抖动综合，0~100 */
export function lineScore(l: LatencyLine, cc?: string) {
  const reg = regionBaseline(cc)
  const v = l.delays.slice(-30).filter((x): x is number => x != null)
  let jitter = 0
  for (let i = 1; i < v.length; i++) jitter += Math.abs(v[i] - v[i - 1])
  jitter = v.length > 1 ? jitter / (v.length - 1) : 0
  const latPenalty = Math.max(0, Math.min(55, (l.avg - reg.base) / 2.8))
  const score = Math.round(Math.max(0, Math.min(100,
    100 - latPenalty - Math.min(45, l.loss * 6) - Math.min(20, jitter / 1.5))))
  return { score, jitter, reg }
}
export const scoreText = (s: number) => (s >= 85 ? '优' : s >= 70 ? '良' : s >= 50 ? '中' : '差')
export const scoreTone = (s: number) => (s >= 70 ? 'ok' : s >= 50 ? 'warn' : 'bad')

/** 质量环：一圈进度 + 分数 */
export function Ring({ score, className }: { score: number | null; className?: string }) {
  const s = score ?? 0
  return (
    <span className={clsx('mx-ring', score == null ? 'none' : scoreTone(s), className)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" className="trk" />
        <circle cx="12" cy="12" r="10" className="val" pathLength={100} strokeDasharray={`${s} 100`} transform="rotate(-90 12 12)" />
      </svg>
      <b>{score ?? '—'}</b>
    </span>
  )
}

/** 紧凑速度：91.4K/s */
export function SpeedShort({ v }: { v?: number }) {
  const [n, u] = bytesParts(v)
  return <>{n}<small>{u.replace(/i?B$/, '') || 'B'}/s</small></>
}

export const UNLOCK_SHORT: Record<string, string> = { 'YouTube Premium': 'YouTube', 'Prime Video': 'Prime' }
export const UNLOCK_TAG: Record<UnlockItem['status'], string> = { yes: '解锁', no: '屏蔽', originals: '自制', web: '网页', app: '仅APP', fail: '失败', na: '—' }
export const UNLOCK_TEXT: Record<UnlockItem['status'], string> = { yes: '解锁', no: '屏蔽', originals: '仅自制剧', web: '仅网页', app: '仅APP', fail: '检测失败', na: '—' }
export const unlockTone = (st: UnlockItem['status']) => (st === 'yes' ? 'ok' : st === 'no' ? 'bad' : st === 'fail' || st === 'na' ? 'none' : 'warn')
export const METHOD_TEXT: Record<string, string> = { probe: '国内探针实测', bgp: 'BGP 直连推断', guess: '推测（未找到探针与直连）' }
export const CARRIER_CLS: Record<string, string> = { 电信: 'ct', 联通: 'cu', 移动: 'cm' }

export const lineFor = (lines: LatencyLine[] | undefined, carrier: string) => lines?.find((l) => l.name.includes(carrier))

export const ArrGo = () => <i className="mx-arr"><svg viewBox="0 0 12 12"><path d="M3 6h6M6.5 3.5 9 6 6.5 8.5" /></svg></i>
export const ArrBack = () => <i className="mx-arr"><svg viewBox="0 0 12 12"><path d="M9 6H3M5.5 3.5 3 6l2.5 2.5" /></svg></i>
