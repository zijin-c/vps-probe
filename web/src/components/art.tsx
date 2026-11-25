// 手绘矢量：品牌标记、实时雷达、等高线背景、空状态插画。
// 全部用 currentColor / CSS 变量着色，明暗主题自动适配。
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LiveServer } from '../lib/hooks'

/** 品牌标记：一枚带刻度的观测镜，右上角一颗信号点 */
export function Mark({ className = 'mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.1" opacity=".45" />
      <path d="M12 1.75v2.5M12 19.75v2.5M1.75 12h2.5M19.75 12h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 12L18.2 5.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="18.2" cy="5.8" r="2.4" fill="var(--signal)" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  )
}

/** 稳定的伪随机：同一台机器每次都落在同一方位 */
function hashAngle(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 3600) / 10
}

const SWEEP_SECONDS = 7.2

/**
 * 舰队雷达：每台服务器是一个光点。
 * 方位按名称哈希固定；离圆心越远 CPU 越忙；离线机器停在最外圈、空心红点。
 * 扫描线经过时光点会亮起一次（动画延迟与扫描相位对齐）。
 */
export function Radar({ servers }: { servers: LiveServer[] }) {
  const nav = useNavigate()
  const C = 200
  const ticks = useMemo(() => {
    const out: JSX.Element[] = []
    for (let a = 0; a < 360; a += 3) {
      const major = a % 30 === 0
      const mid = a % 15 === 0
      const r1 = 188
      const r2 = major ? 176 : mid ? 181 : 184
      const rad = (a * Math.PI) / 180
      out.push(
        <line key={a} x1={C + r1 * Math.sin(rad)} y1={C - r1 * Math.cos(rad)} x2={C + r2 * Math.sin(rad)} y2={C - r2 * Math.cos(rad)}
          className={major ? 'rd-tick major' : 'rd-tick'} />,
      )
      if (major) {
        const rl = 168
        out.push(
          <text key={`t${a}`} x={C + rl * Math.sin(rad)} y={C - rl * Math.cos(rad)} className="rd-deg" textAnchor="middle" dominantBaseline="central">
            {String(a).padStart(3, '0')}
          </text>,
        )
      }
    }
    return out
  }, [])

  // 名称相近的机器可能撞到同一角度，按角度排序后做最小间隔分离
  const blips = useMemo(() => {
    const raw = servers.map((s) => ({ s, a: hashAngle(`${s.id}:${s.name}`) })).sort((x, y) => x.a - y.a)
    for (let i = 1; i < raw.length; i++) if (raw[i].a - raw[i - 1].a < 14) raw[i].a = raw[i - 1].a + 14
    return raw.map(({ s, a }) => {
      const cpu = Math.max(0, Math.min(100, s.state?.cpu || 0))
      const r = s.online ? 38 + cpu * 1.12 : 150
      const rad = (a * Math.PI) / 180
      return { s, a: a % 360, x: C + r * Math.sin(rad), y: C - r * Math.cos(rad), right: Math.sin(rad) >= -0.05 }
    })
  }, [servers])

  return (
    <div className="radar" style={{ ['--sweep' as string]: `${SWEEP_SECONDS}s` }}>
      <div className="radar-sweep" aria-hidden="true" />
      <svg viewBox="0 0 400 400" className="radar-svg" role="img" aria-label="服务器雷达图">
        <defs>
          <radialGradient id="rd-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="var(--signal)" stopOpacity=".10" />
            <stop offset=".7" stopColor="var(--signal)" stopOpacity=".02" />
            <stop offset="1" stopColor="var(--signal)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r="160" fill="url(#rd-glow)" />
        <circle cx={C} cy={C} r="188" className="rd-ring strong" />
        {[150, 112, 75, 38].map((r) => <circle key={r} cx={C} cy={C} r={r} className="rd-ring" />)}
        <path d={`M${C} ${C - 160}V${C + 160}M${C - 160} ${C}H${C + 160}`} className="rd-cross" />
        <path d={`M${C - 113} ${C - 113}L${C + 113} ${C + 113}M${C + 113} ${C - 113}L${C - 113} ${C + 113}`} className="rd-cross faint" />
        {ticks}
        <text x={C + 4} y={C - 38 - 4} className="rd-scale">25%</text>
        <text x={C + 4} y={C - 75 - 4} className="rd-scale">CPU 50%</text>
        <text x={C + 4} y={C - 112 - 4} className="rd-scale">75%</text>
        <text x={C + 4} y={C - 150 - 4} className="rd-scale">OFFLINE</text>
        <circle cx={C} cy={C} r="2.5" className="rd-core" />

        {blips.map(({ s, a, x, y, right }) => (
          <g key={s.id} className={s.online ? 'rd-blip' : 'rd-blip off'} onClick={() => nav(`/server/${s.id}`)}
            style={{ ['--d' as string]: `${(a / 360) * SWEEP_SECONDS - SWEEP_SECONDS}s` }}>
            <title>{`${s.name} · ${s.online ? `CPU ${(s.state?.cpu || 0).toFixed(1)}%` : '离线'}`}</title>
            <circle cx={x} cy={y} r="11" className="rd-hit" />
            {s.online && <circle cx={x} cy={y} r="3" className="rd-echo" />}
            <circle cx={x} cy={y} r={s.online ? 3.2 : 3.4} className="rd-dot" />
            <text x={x + (right ? 8 : -8)} y={y + 0.5} textAnchor={right ? 'start' : 'end'} dominantBaseline="central" className="rd-label">
              {(s.country_code || '··').toUpperCase()}
              <tspan className="rd-label-sub" dx="4">{(s.name || '').slice(0, 16)}</tspan>
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

/** 噪声扰动的闭合曲线（等高线），确定性生成 */
function contour(cx: number, cy: number, r: number, seed: number, amp: number): string {
  const n = 72
  let d = ''
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2
    const k = r + amp * (Math.sin(t * 3 + seed) * 0.55 + Math.sin(t * 5 - seed * 1.7) * 0.3 + Math.cos(t * 2 + seed * 0.6) * 0.45)
    const x = cx + k * Math.cos(t) * 1.25
    const y = cy + k * Math.sin(t)
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return `${d}Z`
}

/** 全局背景：两簇等高线 + 细网格坐标，像一张勘测图 */
export function Backdrop() {
  const paths = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i < 14; i++) out.push(contour(1380, 120, 40 + i * 38, 0.9 + i * 0.23, 14 + i * 4.2))
    for (let i = 0; i < 10; i++) out.push(contour(140, 980, 50 + i * 44, 2.1 + i * 0.31, 18 + i * 5))
    return out
  }, [])
  return (
    <div className="backdrop" aria-hidden="true">
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        {paths.map((d, i) => <path key={i} d={d} className={i % 5 === 4 ? 'bd-line index' : 'bd-line'} />)}
      </svg>
    </div>
  )
}

/** 空状态：一面没有回波的小雷达 */
export function EmptyArt() {
  return (
    <svg className="empty-art" viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <circle cx="60" cy="60" r="52" stroke="currentColor" strokeOpacity=".35" />
      <circle cx="60" cy="60" r="36" stroke="currentColor" strokeOpacity=".22" strokeDasharray="2 4" />
      <circle cx="60" cy="60" r="18" stroke="currentColor" strokeOpacity=".22" strokeDasharray="2 4" />
      <path d="M60 8v104M8 60h104" stroke="currentColor" strokeOpacity=".14" />
      <path d="M60 60L96.8 23.2" stroke="currentColor" strokeOpacity=".6" strokeLinecap="round" />
      <path d="M60 60L96.8 23.2A52 52 0 0 1 112 60Z" fill="currentColor" fillOpacity=".06" />
      <circle cx="60" cy="60" r="2.5" fill="currentColor" />
    </svg>
  )
}
