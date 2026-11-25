// 面板 API 客户端。响应外层统一为 { success?, data?, error? }，HTTP 状态通常是 200。
// 注意：所有字段都是 omitempty，空数组/0/空串会被省略，读取时一律给默认值。

export interface Host {
  platform?: string
  platform_version?: string
  arch?: string
  virtualization?: string
  version?: string
  cpu?: string[]
  gpu?: string[]
  mem_total?: number
  disk_total?: number
  swap_total?: number
  boot_time?: number
}

export interface HostState {
  cpu?: number
  mem_used?: number
  swap_used?: number
  disk_used?: number
  net_in_transfer?: number
  net_out_transfer?: number
  net_in_speed?: number
  net_out_speed?: number
  uptime?: number
  load_1?: number
  load_5?: number
  load_15?: number
  tcp_conn_count?: number
  udp_conn_count?: number
  process_count?: number
}

export interface StreamServer {
  id: number
  name?: string
  public_note?: string
  display_index?: number
  host?: Host
  state?: HostState
  country_code?: string
  last_active?: string
}

export interface StreamFrame {
  now?: number
  online?: number
  servers?: StreamServer[]
}

export interface CycleStats {
  name: string
  from: string
  to: string
  max: number
  min: number
  server_name?: Record<string, string>
  transfer?: Record<string, number>
  next_update?: Record<string, string>
}

export interface ServiceSummary {
  service_name?: string
  current_up: number
  current_down: number
  total_up: number
  total_down: number
  delay?: number[]
  up?: number[]
  down?: number[]
}

export interface ServiceResponse {
  services?: Record<string, ServiceSummary>
  cycle_transfer_stats?: Record<string, CycleStats>
}

export interface ServiceHistory {
  service_id: number
  service_name?: string
  servers?: {
    server_id: number
    server_name?: string
    stats: {
      avg_delay: number
      up_percent: number
      total_up: number
      total_down: number
      data_points?: { ts: number; delay: number; status: 0 | 1 }[]
    }
  }[]
}

export interface MetricSeries {
  server_id: number
  metric: string
  data_points?: { ts: number; value: number }[]
}

export interface Setting {
  config: {
    language?: string
    site_name?: string
    custom_code?: string
    custom_code_dashboard?: string
    install_host?: string
    tls?: boolean
    user_template?: string
    admin_template?: string
    [k: string]: unknown
  }
  version?: string
  frontend_templates?: { path?: string; name?: string; is_admin?: boolean }[]
  tsdb_enabled?: boolean
}

export interface Profile {
  id: number
  username: string
  role: number
  agent_secret?: string
  login_ip?: string
}

export interface ServerRow {
  id: number
  name: string
  uuid?: string
  note?: string
  public_note?: string
  display_index: number
  hide_for_guest?: boolean
  enable_ddns?: boolean
  ddns_profiles?: number[]
  override_ddns_domains?: Record<string, string[]>
  host?: Host
  state?: HostState
  geoip?: { ip?: { ipv4_addr?: string; ipv6_addr?: string }; country_code?: string }
  last_active?: string
}

export interface ServerGroup {
  group: { id: number; name: string }
  servers?: number[] | null
}

export interface Service {
  id: number
  name: string
  type: number
  target: string
  duration: number
  display_index?: number
  notify?: boolean
  notification_group_id?: number
  cover: number
  hide_for_guest?: boolean
  min_latency?: number
  max_latency?: number
  latency_notify?: boolean
  skip_servers?: Record<string, boolean>
  fail_trigger_tasks?: number[] | null
  recover_trigger_tasks?: number[] | null
  enable_trigger_task?: boolean
}

export interface Rule {
  type: string
  min?: number
  max?: number
  cycle_start?: string
  cycle_interval?: number
  cycle_unit?: string
  duration?: number
  cover: number
  ignore?: Record<string, boolean>
}

export interface AlertRule {
  id: number
  name: string
  enable?: boolean
  trigger_mode?: number
  notification_group_id?: number
  rules: Rule[]
  fail_trigger_tasks?: number[] | null
  recover_trigger_tasks?: number[] | null
}

export interface Notification {
  id: number
  name: string
  url?: string
  request_method?: number
  request_type?: number
  request_header?: string
  request_body?: string
  verify_tls?: boolean
  format_metric_units?: boolean
}

export interface NotificationGroup {
  group: { id: number; name: string }
  notifications?: number[] | null
}

// ---- 探针扩展配置（probe.yaml）与本地备份 ----
export interface ProbeConfigView {
  site?: {
    footer_text: string
  }
  telegram: {
    has_bot_token: boolean
    chat_ids: number[]
    api_base: string
    notify_offline: boolean
    offline_seconds: number
    traffic_percents: number[]
    expire_days: number[]
    notify_hour: number
    running: boolean
  }
  backup: {
    daily: boolean
    hour: number
    keep: number
    send_to_telegram: boolean
    include_history: boolean
  }
  quality: {
    interval_hours: number
    has_ipinfo_token: boolean
    has_abuseipdb_key: boolean
    has_ip2location_key: boolean
  }
}

export interface LocalBackupEntry {
  name: string
  size: number
  mod_time: string
}

// ---- IP 质量 / 线路质量（Agent 内置检测，经面板 /api/v1/probe/quality 下发）----
export interface IPSource {
  name: string            // 数据库名，如 ipinfo / ipapi.is
  usage?: string          // 使用类型：机房 / 家宽 / 商业 / 手机 / 教育
  company?: string        // 公司类型
  risk?: number | null    // 风险分 0-100
  risk_label?: string     // 低风险 / 中风险 / 高风险 / 极高风险
  flags?: string[]        // proxy / vpn / tor / hosting / abuser …
}
export interface IPInfo {
  ip: string              // 访客看到的是遮罩后的地址
  asn?: string
  org?: string
  country?: string        // 地理位置国家代码
  reg_country?: string    // 注册国家代码
  city?: string
  ip_type?: 'native' | 'broadcast' | ''
  sources?: IPSource[]
}
export interface UnlockItem {
  name: string
  status: 'yes' | 'no' | 'originals' | 'web' | 'app' | 'fail' | 'na'
  region?: string
  native?: boolean        // 原生解锁 vs DNS/代理解锁
  note?: string
}
export interface RouteHop { ttl: number; ip?: string; rtt?: number; asn?: string; tag?: string }
export interface RouteItem {
  carrier: string         // 电信 / 联通 / 移动
  city?: string
  target?: string
  label: string           // CN2 GIA / 163 / 9929 / 4837 / CMIN2 / CMI …
  premium?: boolean       // 精品线路
  rtt?: number            // 最后一跳延迟
  hops?: RouteHop[]
}
export type QualityPart = 'ip' | 'unlock' | 'route'
export interface QualityStatus {
  running?: QualityPart[]   // Agent 已领取，正在检测
  pending?: QualityPart[]   // 已请求，等待 Agent 领取（1 分钟内）
  since?: string
}
/** 首页卡片用的摘要 */
export interface QualityBrief {
  routes?: Record<string, { label: string; premium?: boolean }>
  unlock?: { name: string; status: UnlockItem['status']; region?: string }[]
  ip_type?: 'native' | 'broadcast' | ''
  usage?: string
}
export interface QualityReport {
  status?: QualityStatus
  parts_at?: Partial<Record<QualityPart, string>>
  updated_at?: string
  agent_version?: string
  ipv4?: IPInfo
  ipv6?: IPInfo
  unlock?: UnlockItem[]
  routes_v4?: RouteItem[]
  routes_v6?: RouteItem[]
  error?: string
}

export class ApiError extends Error {
  status: number
  constructor(msg: string, status = 200) {
    super(msg)
    this.status = status
  }
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|; )nz-csrf=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

const ERR_TEXT: Record<string, string> = {
  ApiErrorUnauthorized: '未登录或登录已过期',
  'unauthorized: only 1d data available for guests': '访客只能查看 1 天内的数据',
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method || 'GET'
  const headers: Record<string, string> = {}
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = csrf()
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  let j: { success?: boolean; data?: T; error?: string } = {}
  try {
    j = await res.json()
  } catch {
    throw new ApiError(`HTTP ${res.status}`, res.status)
  }
  if (!j.success) {
    const e = j.error || `HTTP ${res.status}`
    throw new ApiError(ERR_TEXT[e] || e, res.status)
  }
  return j.data as T
}

export const isUnauthorized = (e: unknown) => e instanceof ApiError && /未登录|Unauthorized/i.test(e.message)

// ---- 便捷封装 ----
export const getSetting = () => api<Setting>('/setting')
export const getService = () => api<ServiceResponse>('/service').then((d) => d || {})
export const getServiceHistory = (id: number | string, period = '1d') => api<ServiceHistory>(`/service/${id}/history?period=${period}`)
export const getMetric = (id: number, metric: string, period = '1d') =>
  api<MetricSeries>(`/server/${id}/metrics?metric=${metric}&period=${period}`)

/** WebSocket 订阅服务器实时数据；public_note 只在首帧下发，需要自己合并 */
export function subscribeServers(onFrame: (f: StreamFrame) => void, onState?: (connected: boolean) => void): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retry = 0
  let timer: number | undefined
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/api/v1/ws/server`)
    ws.onopen = () => {
      retry = 0
      onState?.(true)
    }
    ws.onmessage = (ev) => {
      try {
        onFrame(JSON.parse(ev.data))
      } catch {
        /* ignore malformed */
      }
    }
    ws.onclose = () => {
      onState?.(false)
      if (closed) return
      timer = window.setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++))
    }
  }
  connect()
  return () => {
    closed = true
    clearTimeout(timer)
    ws?.close()
  }
}

/** 服务器是否在线：最后上报 30 秒内 */
export function isOnline(lastActive?: string, now = Date.now()): boolean {
  if (!lastActive || lastActive.startsWith('0001')) return false
  return now - Date.parse(lastActive) < 30_000
}
