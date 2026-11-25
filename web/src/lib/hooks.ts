import { useEffect, useState } from 'react'
import {
  api, getService, getServiceHistory, getSetting, isOnline, subscribeServers,
  type CycleStats, type QualityBrief, type QualityReport, type ServiceResponse, type Setting, type StreamServer,
} from './api'
import { parseBilling, parseNote, type Billing, type PublicNote } from './billing'

export interface LiveServer extends StreamServer {
  online: boolean
  note: PublicNote
  billing: Billing
}

// 模块级共享 WebSocket 状态：前台页面间切换（首页 ↔ 详情页）复用同一条连接，
// 避免反复建连/断连导致的卡顿与在线人数虚增。
interface LiveSnapshot {
  servers: LiveServer[]
  viewers: number
  connected: boolean
  loaded: boolean
}

const liveNotes = new Map<number, string>()
let liveSnap: LiveSnapshot = { servers: [], viewers: 0, connected: false, loaded: false }
const liveListeners = new Set<() => void>()
let liveStop: (() => void) | null = null
let liveCloseTimer: number | undefined

function emitLive() {
  liveListeners.forEach((fn) => fn())
}

function ensureLiveStarted() {
  if (liveCloseTimer !== undefined) {
    clearTimeout(liveCloseTimer)
    liveCloseTimer = undefined
  }
  if (liveStop) return
  liveStop = subscribeServers(
    (f) => {
      const now = f.now || Date.now()
      const list = (f.servers || []).map((s) => {
        if (s.public_note !== undefined) liveNotes.set(s.id, s.public_note)
        const raw = liveNotes.get(s.id) || ''
        const note = parseNote(raw)
        return { ...s, public_note: raw, online: isOnline(s.last_active, now), note, billing: parseBilling(note, new Date(now)) }
      })
      liveSnap = { servers: list, viewers: f.online || 0, connected: true, loaded: true }
      emitLive()
    },
    (connected) => {
      if (liveSnap.connected !== connected) {
        liveSnap = { ...liveSnap, connected }
        emitLive()
      }
    },
  )
}

function maybeStopLive() {
  if (liveListeners.size > 0 || !liveStop) return
  liveCloseTimer = window.setTimeout(() => {
    liveCloseTimer = undefined
    if (liveListeners.size === 0 && liveStop) {
      liveStop()
      liveStop = null
      liveSnap = { ...liveSnap, connected: false }
    }
  }, 3000)
}

/** 实时服务器列表（WebSocket，2 秒一帧；全局复用单条连接） */
export function useLiveServers() {
  const [snap, setSnap] = useState<LiveSnapshot>(() => liveSnap)

  useEffect(() => {
    const onUpdate = () => setSnap(liveSnap)
    liveListeners.add(onUpdate)
    ensureLiveStarted()
    onUpdate()
    return () => {
      liveListeners.delete(onUpdate)
      maybeStopLive()
    }
  }, [])

  return snap
}

export interface LatencyLine {
  serviceId: number
  name: string
  latest: number | null
  avg: number
  loss: number
  delays: (number | null)[]
  status: (0 | 1)[]
  ts: number[]
}

/** 服务监控概览 + 每台服务器的延迟线（每 60 秒刷新） */
export function useServiceData(period = '1d', enabled = true) {
  const [summary, setSummary] = useState<ServiceResponse>({})
  const [byServer, setByServer] = useState<Map<number, LatencyLine[]>>(new Map())

  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = async () => {
      try {
        const sum = await getService()
        if (!alive) return
        setSummary(sum)
        const ids = Object.keys(sum.services || {})
        const histories = await Promise.all(ids.map((id) => getServiceHistory(id, period).catch(() => null)))
        if (!alive) return
        const map = new Map<number, LatencyLine[]>()
        histories.forEach((h) => {
          if (!h) return
          for (const s of h.servers || []) {
            const pts = s.stats.data_points || []
            const total = s.stats.total_up + s.stats.total_down
            const line: LatencyLine = {
              serviceId: h.service_id,
              name: h.service_name || sum.services?.[h.service_id]?.service_name || `监控 ${h.service_id}`,
              latest: pts.length ? (pts[pts.length - 1].status ? pts[pts.length - 1].delay : null) : null,
              avg: s.stats.avg_delay,
              loss: total ? (s.stats.total_down * 100) / total : 0,
              delays: pts.map((p) => (p.status ? p.delay : null)),
              status: pts.map((p) => p.status),
              ts: pts.map((p) => p.ts),
            }
            const arr = map.get(s.server_id) || []
            arr.push(line)
            map.set(s.server_id, arr)
          }
        })
        for (const arr of map.values()) arr.sort((a, b) => a.serviceId - b.serviceId)
        setByServer(map)
      } catch {
        /* 未配置服务时忽略 */
      }
    }
    load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [period, enabled])

  return { summary, byServer }
}

export interface CycleTraffic {
  used: number
  limit: number
  from: Date
  to: Date
  rule: string
}

/** 每台服务器的周期流量：多条规则命中时取配额最小的 */
export function cycleTrafficMap(stats?: Record<string, CycleStats>): Map<number, CycleTraffic> {
  const m = new Map<number, CycleTraffic>()
  for (const st of Object.values(stats || {})) {
    for (const [sid, used] of Object.entries(st.transfer || {})) {
      const id = Number(sid)
      const cur = m.get(id)
      if (!cur || (st.max > 0 && (cur.limit === 0 || st.max < cur.limit))) {
        m.set(id, { used, limit: st.max, from: new Date(st.from), to: new Date(st.to), rule: st.name })
      }
    }
  }
  return m
}

/**
 * 读取 Agent 上报的 IP / 线路 / 解锁检测结果。
 * 有检测在排队或进行中时每 5 秒刷新一次，否则每 5 分钟。
 */
export function useQuality(id: number) {
  const [report, setReport] = useState<QualityReport | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const busy = !!(report?.status?.running?.length || report?.status?.pending?.length)
  useEffect(() => {
    let alive = true
    api<QualityReport>(`/probe/quality/${id}`)
      .then((r) => alive && setReport(r || {}))
      .catch(() => alive && setReport({}))
    const t = setTimeout(() => setTick((x) => x + 1), busy ? 5_000 : 300_000)
    return () => { alive = false; clearTimeout(t) }
  }, [id, tick, busy])
  const reload = () => setTick((x) => x + 1)
  return { report, reload }
}

/** 所有服务器的线路 / 解锁摘要（首页卡片），每 2 分钟刷新 */
export function useQualitySummary() {
  const [data, setData] = useState<Record<string, QualityBrief>>({})
  useEffect(() => {
    let alive = true
    const load = () => api<Record<string, QualityBrief>>('/probe/quality').then((d) => alive && setData(d || {})).catch(() => {})
    load()
    const t = setInterval(load, 120_000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return data
}

/** 是否已登录后台（决定能否查看 7/30 天历史） */
export function useSignedIn() {
  const [yes, setYes] = useState(false)
  useEffect(() => { api('/profile').then(() => setYes(true)).catch(() => setYes(false)) }, [])
  return yes
}

export function useSetting() {
  const [setting, setSetting] = useState<Setting | null>(null)
  useEffect(() => {
    getSetting().then(setSetting).catch(() => setSetting(null))
  }, [])
  return setting
}

export function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [interval])
  return now
}

export function useTitle(title: string) {
  useEffect(() => {
    if (title) document.title = title
  }, [title])
}

export function useDebounced<T>(v: T, ms = 200): T {
  const [d, setD] = useState(v)
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms)
    return () => clearTimeout(t)
  }, [v, ms])
  return d
}
