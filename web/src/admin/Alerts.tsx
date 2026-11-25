import { useState } from 'react'
import { IEdit, IPlus, ITrash } from '../components/icons'
import { Field, Modal } from '../components/ui'
import { api, type AlertRule, type NotificationGroup, type Rule, type ServerRow } from '../lib/api'
import { fmtBytes } from '../lib/format'
import { PageHead, ServerPicker, confirmDelete, fromDateInput, toDateInput, useAction, useList } from './common'

type Unit = 'pct' | 'gb' | 'mbs' | 'num' | 'none' | 'c'
const TYPES: { v: string; l: string; unit: Unit; cycle?: boolean }[] = [
  { v: 'offline', l: '离线', unit: 'none' },
  { v: 'transfer_all_cycle', l: '周期流量（双向）', unit: 'gb', cycle: true },
  { v: 'transfer_out_cycle', l: '周期流量（出站）', unit: 'gb', cycle: true },
  { v: 'transfer_in_cycle', l: '周期流量（入站）', unit: 'gb', cycle: true },
  { v: 'cpu', l: 'CPU 使用率', unit: 'pct' },
  { v: 'memory', l: '内存使用率', unit: 'pct' },
  { v: 'disk', l: '硬盘使用率', unit: 'pct' },
  { v: 'swap', l: 'Swap 使用率', unit: 'pct' },
  { v: 'load1', l: '1 分钟负载', unit: 'num' },
  { v: 'net_all_speed', l: '总网速', unit: 'mbs' },
  { v: 'net_out_speed', l: '上行网速', unit: 'mbs' },
  { v: 'net_in_speed', l: '下行网速', unit: 'mbs' },
  { v: 'tcp_conn_count', l: 'TCP 连接数', unit: 'num' },
  { v: 'process_count', l: '进程数', unit: 'num' },
  { v: 'temperature_max', l: '最高温度', unit: 'c' },
]
const typeOf = (v: string) => TYPES.find((t) => t.v === v)
const GB = 1024 ** 3
const MB = 1024 ** 2
const toUi = (u: Unit, v = 0) => (u === 'gb' ? +(v / GB).toFixed(2) : u === 'mbs' ? +(v / MB).toFixed(2) : v)
const fromUi = (u: Unit, v: number) => (u === 'gb' ? Math.round(v * GB) : u === 'mbs' ? Math.round(v * MB) : v)
const unitLabel: Record<Unit, string> = { pct: '%', gb: 'GB', mbs: 'MB/s', num: '', none: '', c: '°C' }

function ruleText(r: Rule): string {
  const t = typeOf(r.type)
  if (!t) return r.type
  if (t.unit === 'none') return `${t.l} 超过 ${r.duration || 0} 秒`
  if (t.cycle) return `${t.l} > ${fmtBytes(r.max)}，每 ${r.cycle_interval} ${({ hour: '小时', day: '天', week: '周', month: '月', year: '年' } as Record<string, string>)[r.cycle_unit || 'month']}重置`
  const parts = []
  if (r.max) parts.push(`> ${toUi(t.unit, r.max)}${unitLabel[t.unit]}`)
  if (r.min) parts.push(`< ${toUi(t.unit, r.min)}${unitLabel[t.unit]}`)
  return `${t.l} ${parts.join(' 或 ')}，持续 ${r.duration || 0} 秒`
}

export default function Alerts() {
  const { data, reload } = useList<AlertRule>('/alert-rule')
  const { data: servers } = useList<ServerRow>('/server')
  const { data: groups } = useList<NotificationGroup>('/notification-group')
  const [edit, setEdit] = useState<AlertRule | 'new' | 'traffic' | null>(null)
  const { run } = useAction()

  const del = async (a: AlertRule) => {
    if (!confirmDelete(a.name)) return
    if (await run(() => api('/batch-delete/alert-rule', { method: 'POST', body: [a.id] }), '已删除')) reload()
  }

  return (
    <>
      <PageHead title="告警规则" desc="「周期流量」规则同时决定前台卡片上的流量配额进度条与 TG 流量提醒。">
        <button className="btn" onClick={() => setEdit('traffic')}><IPlus />流量配额</button>
        <button className="btn primary" onClick={() => setEdit('new')}><IPlus />新建规则</button>
      </PageHead>
      <div className="glass table-wrap">
        <table className="t">
          <thead><tr><th>名称</th><th>条件</th><th>通知组</th><th>状态</th><th /></tr></thead>
          <tbody>
            {data?.length === 0 && <tr><td colSpan={5} className="empty">还没有规则。先点「流量配额」给服务器设置每月流量吧</td></tr>}
            {data?.map((a) => (
              <tr key={a.id}>
                <td><b>{a.name}</b></td>
                <td style={{ fontSize: 12.5 }}>{a.rules.map((r, i) => <div key={i}>{ruleText(r)}</div>)}</td>
                <td>{groups?.find((g) => g.group.id === a.notification_group_id)?.group.name || <span className="muted">—</span>}</td>
                <td>{a.enable ? <span className="tag ok">启用</span> : <span className="tag plain">停用</span>}</td>
                <td><div className="act">
                  <button className="btn sm" onClick={() => setEdit(a)}><IEdit />编辑</button>
                  <button className="btn sm danger" onClick={() => del(a)}><ITrash /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <AlertModal a={typeof edit === 'string' ? null : edit} preset={edit === 'traffic' ? 'traffic' : undefined}
        servers={servers || []} groups={groups || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
    </>
  )
}

function firstOfMonth() {
  const d = new Date()
  return fromDateInput(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
}

function AlertModal({ a, preset, servers, groups, onClose, onSaved }: {
  a: AlertRule | null; preset?: 'traffic'; servers: ServerRow[]; groups: NotificationGroup[]; onClose: () => void; onSaved: () => void
}) {
  const r0: Rule = a?.rules[0] || (preset === 'traffic'
    ? { type: 'transfer_all_cycle', max: 256 * GB, cycle_start: firstOfMonth(), cycle_interval: 1, cycle_unit: 'month', cover: 0 }
    : { type: 'offline', duration: 60, cover: 0 })
  const [name, setName] = useState(a?.name || (preset === 'traffic' ? '月流量 256GB' : ''))
  const [rule, setRule] = useState<Rule>(r0)
  const [enable, setEnable] = useState(a ? !!a.enable : true)
  const [mode, setMode] = useState(a?.trigger_mode || 0)
  const [group, setGroup] = useState(a?.notification_group_id || 0)
  const { busy, run } = useAction()
  const t = typeOf(rule.type) || TYPES[0]
  const set = (p: Partial<Rule>) => setRule({ ...rule, ...p })

  const changeType = (v: string) => {
    const nt = typeOf(v)!
    if (nt.cycle) set({ type: v, cycle_start: rule.cycle_start || firstOfMonth(), cycle_interval: rule.cycle_interval || 1, cycle_unit: rule.cycle_unit || 'month', max: rule.max && typeOf(rule.type)?.cycle ? rule.max : 256 * GB, min: 0, duration: 0 })
    else set({ type: v, cycle_start: undefined, cycle_interval: undefined, cycle_unit: undefined, max: nt.unit === 'pct' ? 90 : 0, min: 0, duration: rule.duration || 60 })
  }

  const save = async () => {
    const r: Rule = { ...rule }
    if (t.unit === 'none') { delete r.max; delete r.min }
    if (t.cycle) delete r.duration
    const body = {
      name, rules: [r, ...(a?.rules.slice(1) || [])], enable, trigger_mode: mode, notification_group_id: group,
      fail_trigger_tasks: [], recover_trigger_tasks: [],
    }
    const ok = await run(() => a ? api(`/alert-rule/${a.id}`, { method: 'PATCH', body }) : api('/alert-rule', { method: 'POST', body }), '已保存')
    if (ok) onSaved()
  }

  return (
    <Modal title={a ? '编辑规则' : preset === 'traffic' ? '设置流量配额' : '新建规则'} onClose={onClose} width={680} footer={<>
      <button className="btn" onClick={onClose}>取消</button>
      <button className="btn primary" disabled={busy || !name.trim()} onClick={save}>保存</button>
    </>}>
      <div className="form">
        <Field label="名称"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="类型">
          <select className="select" value={rule.type} onChange={(e) => changeType(e.target.value)}>
            {TYPES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
          </select>
        </Field>

        {t.cycle ? <>
          <Field label="流量上限（GB）"><input className="input" type="number" value={toUi('gb', rule.max)} onChange={(e) => set({ max: fromUi('gb', Number(e.target.value)) })} /></Field>
          <Field label="周期起点" hint="例如每月 1 号重置就选某月 1 号"><input className="input" type="date" value={toDateInput(rule.cycle_start)} onChange={(e) => set({ cycle_start: fromDateInput(e.target.value) })} /></Field>
          <Field label="每"><input className="input" type="number" min={1} value={rule.cycle_interval || 1} onChange={(e) => set({ cycle_interval: Number(e.target.value) })} /></Field>
          <Field label="周期单位">
            <select className="select" value={rule.cycle_unit || 'month'} onChange={(e) => set({ cycle_unit: e.target.value })}>
              <option value="day">天</option><option value="week">周</option><option value="month">月</option><option value="year">年</option>
            </select>
          </Field>
        </> : t.unit === 'none' ? (
          <Field label="离线多少秒后告警" full><input className="input" type="number" min={3} value={rule.duration || 60} onChange={(e) => set({ duration: Number(e.target.value) })} /></Field>
        ) : <>
          <Field label={`高于（${unitLabel[t.unit] || '值'}）`} hint="0 表示不检查"><input className="input" type="number" value={toUi(t.unit, rule.max)} onChange={(e) => set({ max: fromUi(t.unit, Number(e.target.value)) })} /></Field>
          <Field label={`低于（${unitLabel[t.unit] || '值'}）`} hint="0 表示不检查"><input className="input" type="number" value={toUi(t.unit, rule.min)} onChange={(e) => set({ min: fromUi(t.unit, Number(e.target.value)) })} /></Field>
          <Field label="持续秒数" full hint="指标持续超标这么久才告警（3 ~ 86400）"><input className="input" type="number" min={3} value={rule.duration || 60} onChange={(e) => set({ duration: Number(e.target.value) })} /></Field>
        </>}

        <Field label="覆盖范围">
          <select className="select" value={rule.cover} onChange={(e) => set({ cover: Number(e.target.value) })}>
            <option value={0}>全部服务器（可排除）</option>
            <option value={1}>仅选中的服务器</option>
          </select>
        </Field>
        <Field label="触发方式">
          <select className="select" value={mode} onChange={(e) => setMode(Number(e.target.value))}>
            <option value={0}>每次都通知</option>
            <option value={1}>只通知一次（恢复后再次触发才通知）</option>
          </select>
        </Field>
        <div className="fld full">
          <span>{rule.cover === 1 ? '应用到这些服务器' : '排除这些服务器'}</span>
          <ServerPicker servers={servers} value={rule.ignore || {}} onChange={(v) => set({ ignore: v })} />
        </div>
        <Field label="通知组" full hint="TG 机器人的流量/到期提醒不依赖这里；这里是面板自带的 Webhook 通知">
          <select className="select" value={group} onChange={(e) => setGroup(Number(e.target.value))}>
            <option value={0}>不通知（仅统计）</option>
            {groups.map((g) => <option key={g.group.id} value={g.group.id}>{g.group.name}</option>)}
          </select>
        </Field>
        <label className="check full"><input type="checkbox" checked={enable} onChange={(e) => setEnable(e.target.checked)} />启用</label>
        {a && a.rules.length > 1 && <div className="full muted" style={{ fontSize: 12.5 }}>此规则包含 {a.rules.length} 个条件，这里只编辑第一个，其余保持不变。</div>}
      </div>
    </Modal>
  )
}
