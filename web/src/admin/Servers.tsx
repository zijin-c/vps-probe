import { useMemo, useState } from 'react'
import { ICopy, IEdit, IPlus, ITrash } from '../components/icons'
import { Field, Modal, copyText, useToast } from '../components/ui'
import { expiryText } from '../components/ServerCard'
import { api, isOnline, type ServerRow } from '../lib/api'
import { parseBilling, parseNote, priceText, type BillingData, type PlanData } from '../lib/billing'
import { clsx, fmtAgo, toneVar } from '../lib/format'
import { PageHead, confirmDelete, fromDateInput, toDateInput, useAction, useAdmin, useList } from './common'

export default function Servers() {
  const { data, reload } = useList<ServerRow>('/server')
  const [edit, setEdit] = useState<ServerRow | null>(null)
  const [install, setInstall] = useState(false)
  const { run } = useAction()
  const now = Date.now()

  const del = async (s: ServerRow) => {
    if (!confirmDelete(s.name)) return
    if (await run(() => api('/batch-delete/server', { method: 'POST', body: [s.id] }), '已删除')) reload()
  }
  const recheck = (s: ServerRow) =>
    run(() => api(`/probe/quality/${s.id}/refresh`, { method: 'POST' }), `已通知 ${s.name} 重新检测，几分钟内更新`)

  return (
    <>
      <PageHead title="服务器" desc="Agent 连接面板后自动出现在这里。点「编辑」填写名称、排序、账单与套餐。">
        <button className="btn primary" onClick={() => setInstall(true)}><IPlus />添加服务器</button>
      </PageHead>
      <div className="glass table-wrap">
        <table className="t stack">
          <thead>
            <tr><th>名称</th><th>状态</th><th>IP</th><th>价格</th><th>到期</th><th>Agent</th><th /></tr>
          </thead>
          <tbody>
            {data === null && <tr><td colSpan={7} className="empty">加载中…</td></tr>}
            {data?.length === 0 && <tr><td colSpan={7} className="empty">还没有服务器，点右上角「添加服务器」获取安装命令</td></tr>}
            {data?.map((s) => {
              const b = parseBilling(parseNote(s.public_note))
              const exp = expiryText(b)
              const on = isOnline(s.last_active, now)
              return (
                <tr key={s.id}>
                  <td className="first" style={{ display: 'block' }}>
                    <div className="row" style={{ gap: 6 }}>
                      <b style={{ fontWeight: 600 }}>{s.name}</b>
                      {s.geoip?.country_code && <span className="cc">{s.geoip.country_code.toUpperCase()}</span>}
                      {s.hide_for_guest && <span className="tag plain">隐藏</span>}
                    </div>
                    <div className="faint" style={{ fontSize: 12 }}>#{s.id}{s.display_index ? ` · 排序 ${s.display_index}` : ''}{s.note ? ` · ${s.note}` : ''}</div>
                  </td>
                  <td data-l="状态"><span className="row" style={{ gap: 6 }}><span className={clsx('dot', on ? 'on' : 'off')} />{on ? '在线' : <span className="muted">{fmtAgo(s.last_active)}</span>}</span></td>
                  <td data-l="IP" className="mono muted" style={{ fontSize: 12 }}><span>{s.geoip?.ip?.ipv4_addr || '—'}{s.geoip?.ip?.ipv6_addr && <div>{s.geoip.ip.ipv6_addr}</div>}</span></td>
                  <td data-l="价格">{priceText(b) || <span className="faint">未设置</span>}</td>
                  <td data-l="到期" style={{ color: exp && exp.tone !== 'neutral' ? toneVar(exp.tone) : 'var(--muted)' }}>{exp?.text || <span className="faint">—</span>}</td>
                  <td data-l="Agent" className="mono faint" style={{ fontSize: 12 }}>{s.host?.version || '—'}</td>
                  <td>
                    <div className="act">
                      <button className="btn sm ghost" onClick={() => recheck(s)} title="重新检测 IP 与线路质量">重测</button>
                      <button className="btn sm" onClick={() => setEdit(s)}><IEdit />编辑</button>
                      <button className="btn sm ghost danger" onClick={() => del(s)} aria-label="删除"><ITrash /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {edit && <EditServer s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
      {install && <InstallModal onClose={() => setInstall(false)} />}
    </>
  )
}

const CYCLES = [
  { v: '月', l: '月付' }, { v: '季', l: '季付' }, { v: '半年', l: '半年付' }, { v: '年', l: '年付' },
  { v: '2年', l: '两年付' }, { v: '3年', l: '三年付' }, { v: '一次性', l: '一次性' },
]

function EditServer({ s, onClose, onSaved }: { s: ServerRow; onClose: () => void; onSaved: () => void }) {
  const note = useMemo(() => parseNote(s.public_note), [s.public_note])
  const rawIsJson = !s.public_note || s.public_note.trim().startsWith('{')
  const [name, setName] = useState(s.name)
  const [displayIndex, setDisplayIndex] = useState(s.display_index || 0)
  const [hide, setHide] = useState(!!s.hide_for_guest)
  const [privNote, setPrivNote] = useState(s.note || '')
  const [bill, setBill] = useState<BillingData>({ autoRenewal: '0', cycle: '月', ...note.billingDataMod })
  const [plan, setPlan] = useState<PlanData>({ trafficType: '2', ...note.planDataMod })
  const [permanent, setPermanent] = useState(!!note.billingDataMod?.endDate?.startsWith('0000'))
  const [advanced, setAdvanced] = useState(!rawIsJson)
  const [raw, setRaw] = useState(s.public_note || '')
  const { busy, run } = useAction()

  const composeNote = () => {
    if (advanced) return raw
    const b: BillingData = { ...bill }
    if (permanent) b.endDate = '0000-00-00T23:59:59+08:00'
    const hasBill = !!(b.amount || b.endDate)
    const hasPlan = Object.values(plan).some((v) => v && v !== '0' && v !== '2')
    const out: Record<string, unknown> = { ...note }
    if (hasBill) out.billingDataMod = b; else delete out.billingDataMod
    if (hasPlan || hasBill) out.planDataMod = plan; else delete out.planDataMod
    return Object.keys(out).length ? JSON.stringify(out) : ''
  }

  const save = async () => {
    const public_note = composeNote()
    if (advanced && public_note.trim().startsWith('{')) {
      try { JSON.parse(public_note) } catch { return alert('公开备注不是合法 JSON') }
    }
    const ok = await run(() => api(`/server/${s.id}`, {
      method: 'PATCH',
      body: {
        name, note: privNote, public_note, display_index: Number(displayIndex) || 0, hide_for_guest: hide,
        enable_ddns: !!s.enable_ddns, ddns_profiles: s.ddns_profiles || [], override_ddns_domains: s.override_ddns_domains || {},
      },
    }), '已保存')
    if (ok) onSaved()
  }

  const preview = parseBilling(parseNote(advanced ? raw : composeNote()))

  return (
    <Modal title={`编辑 · ${s.name}`} onClose={onClose} width={720} footer={<>
      <button className="btn" onClick={onClose}>取消</button>
      <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>保存</button>
    </>}>
      <div className="form">
        <Field label="名称"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="排序" hint="数字越大越靠前"><input className="input" type="number" value={displayIndex} onChange={(e) => setDisplayIndex(Number(e.target.value))} /></Field>
        <Field label="私有备注" hint="只有后台可见" full><input className="input" value={privNote} onChange={(e) => setPrivNote(e.target.value)} /></Field>
        <label className="check full"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />对访客隐藏（前台不显示）</label>

        <div className="form-sec" style={{ display: 'flex', alignItems: 'center' }}>
          账单与套餐（前台卡片与 TG 机器人读取）
          <span className="spacer" />
          <label className="check" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
            <input type="checkbox" checked={advanced} onChange={(e) => { if (e.target.checked) setRaw(composeNote()); setAdvanced(e.target.checked) }} />直接编辑 JSON
          </label>
        </div>

        {advanced ? (
          <Field label="公开备注（原始 JSON）" full hint="与官方前端格式兼容：billingDataMod / planDataMod">
            <textarea className="textarea" rows={8} value={raw} onChange={(e) => setRaw(e.target.value)} />
          </Field>
        ) : (
          <>
            <Field label="价格" hint="带币种符号，如 $10、¥88、€5"><input className="input" placeholder="$10" value={bill.amount || ''} onChange={(e) => setBill({ ...bill, amount: e.target.value })} /></Field>
            <Field label="付款周期">
              <select className="select" value={bill.cycle} onChange={(e) => setBill({ ...bill, cycle: e.target.value })}>
                {CYCLES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </Field>
            <Field label="开始日期"><input className="input" type="date" value={toDateInput(bill.startDate)} onChange={(e) => setBill({ ...bill, startDate: fromDateInput(e.target.value) })} /></Field>
            <Field label="到期日期">
              <input className="input" type="date" disabled={permanent} value={permanent ? '' : toDateInput(bill.endDate)} onChange={(e) => setBill({ ...bill, endDate: fromDateInput(e.target.value) })} />
            </Field>
            <div className="full" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <label className="check"><input type="checkbox" checked={bill.autoRenewal === '1'} onChange={(e) => setBill({ ...bill, autoRenewal: e.target.checked ? '1' : '0' })} />自动续费（过期后按周期顺延）</label>
              <label className="check"><input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />永久（不到期）</label>
            </div>
            <Field label="带宽"><input className="input" placeholder="1Gbps" value={plan.bandwidth || ''} onChange={(e) => setPlan({ ...plan, bandwidth: e.target.value })} /></Field>
            <Field label="月流量" hint="仅展示；配额进度请在「告警规则」加周期流量规则"><input className="input" placeholder="256GB" value={plan.trafficVol || ''} onChange={(e) => setPlan({ ...plan, trafficVol: e.target.value })} /></Field>
            <Field label="流量计费">
              <select className="select" value={plan.trafficType || '2'} onChange={(e) => setPlan({ ...plan, trafficType: e.target.value })}>
                <option value="2">双向计费</option>
                <option value="1">单向计费</option>
              </select>
            </Field>
            <div className="fld">
              <span>IP</span>
              <div style={{ display: 'flex', gap: 16, height: 36, alignItems: 'center' }}>
                <label className="check"><input type="checkbox" checked={plan.IPv4 === '1'} onChange={(e) => setPlan({ ...plan, IPv4: e.target.checked ? '1' : '0' })} />IPv4</label>
                <label className="check"><input type="checkbox" checked={plan.IPv6 === '1'} onChange={(e) => setPlan({ ...plan, IPv6: e.target.checked ? '1' : '0' })} />IPv6</label>
              </div>
            </div>
            <Field label="线路标签" hint="逗号分隔，显示为金色标签" full><input className="input" placeholder="CN2 GIA, 9929, CMIN2" value={plan.networkRoute || ''} onChange={(e) => setPlan({ ...plan, networkRoute: e.target.value })} /></Field>
            <Field label="其它标签" hint="逗号分隔，如 原生IP、解锁奈飞" full><input className="input" placeholder="原生IP" value={plan.extra || ''} onChange={(e) => setPlan({ ...plan, extra: e.target.value })} /></Field>
          </>
        )}
        <div className="full muted" style={{ fontSize: 12.5 }}>
          预览：{priceText(preview) || '未设置价格'} · {preview.permanent ? '永久' : preview.daysLeft != null ? `剩余 ${preview.daysLeft} 天` : '未设置到期'}{preview.remainingValue ? ` · 剩余价值 ${preview.remainingValue}` : ''}
        </div>
      </div>
    </Modal>
  )
}

function InstallModal({ onClose }: { onClose: () => void }) {
  const { profile, setting } = useAdmin()
  const toast = useToast()
  const host = (setting?.config.install_host as string) || ''
  const [server, setServer] = useState(host || `${location.hostname}:${location.port || (location.protocol === 'https:' ? '443' : '80')}`)
  const [tls, setTls] = useState(setting?.config.tls ?? location.protocol === 'https:')
  const panel = location.origin
  const secret = profile.agent_secret || ''
  const cmd = `curl -fsSL ${panel}/probe/agent/install.sh | sudo sh -s -- --panel ${panel} --server ${server}${tls ? ' --tls' : ''} --secret ${secret}`
  const uninstall = `curl -fsSL ${panel}/probe/agent/install.sh | sudo sh -s -- --uninstall`

  return (
    <Modal title="添加服务器" onClose={onClose} width={720}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="muted" style={{ margin: 0 }}>在要监控的 VPS 上以 root 执行下面的命令。Agent 从本面板下载（只读版本，不含远程执行），装好后几秒内就会出现在列表里。</p>
        <div className="form">
          <Field label="Agent 连接地址" hint="域名或 IP:端口。走 HTTPS 反代时填 域名:443 并勾选 TLS">
            <input className="input" value={server} onChange={(e) => setServer(e.target.value)} />
          </Field>
          <div className="fld">
            <span>传输加密</span>
            <label className="check" style={{ height: 36 }}><input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />使用 TLS</label>
          </div>
        </div>
        {!host && <div className="note warn">还没有在「系统设置」里填写 Agent 连接地址，当前用的是浏览器地址，部署到服务器后建议去设置一下。</div>}
        {!secret && <div className="note bad">没取到 Agent 密钥，请重新登录后再试。</div>}
        <div className="code">{cmd}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={() => copyText(cmd).then(() => toast('已复制安装命令', 'ok'))}><ICopy />复制安装命令</button>
          <button className="btn" onClick={() => copyText(uninstall).then(() => toast('已复制卸载命令', 'ok'))}>复制卸载命令</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>命令里包含 Agent 密钥，请勿公开分享。不要使用官方哪吒的安装脚本——那个会装上带远程执行能力的官方 Agent。</p>
      </div>
    </Modal>
  )
}
