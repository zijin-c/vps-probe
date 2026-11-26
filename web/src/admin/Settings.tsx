import { useEffect, useState } from 'react'
import { Field } from '../components/ui'
import { api, type ProbeConfigView } from '../lib/api'
import { PageHead, useAction, useAdmin } from './common'

export default function Settings() {
  const { setting, reloadSetting } = useAdmin()
  const [f, setF] = useState<Record<string, unknown> | null>(null)
  const [footerText, setFooterText] = useState('只读探针，Agent 不执行任何远程指令')
  const { busy, run } = useAction()

  useEffect(() => { if (setting) setF({ ...setting.config }) }, [setting])
  useEffect(() => {
    api<ProbeConfigView>('/probe/config')
      .then((v) => { if (v?.site) setFooterText(v.site.footer_text ?? '') })
      .catch(() => {})
  }, [])
  if (!f) return <div className="empty">加载中…</div>

  const str = (k: string) => (f[k] as string) || ''
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v })

  const save = async () => {
    // 面板的 PATCH /setting 是整体覆盖：把读到的全部字段原样带回，只改动表单里的项
    const userTemplates = (setting?.frontend_templates || []).filter((t) => !t.is_admin).map((t) => t.path)
    const body = {
      ...f,
      user_template: userTemplates.includes(str('user_template')) ? str('user_template') : (userTemplates[0] || 'user-dist'),
      online_stats_days: Number(f.online_stats_days) || undefined,
    }
    const ok = await run(async () => {
      await api('/setting', { method: 'PATCH', body })
      await api('/probe/config', { method: 'PATCH', body: { site: { footer_text: footerText } } })
    }, '设置已保存')
    if (ok) reloadSetting()
  }

  return (
    <>
      <PageHead title="系统设置">
        <button className="btn primary" onClick={save} disabled={busy}>保存设置</button>
      </PageHead>
      <div style={{ display: 'grid', gap: 14, maxWidth: 820 }}>
        <section className="glass card-pad">
          <h3 className="sec-title">站点</h3>
          <div className="form">
            <Field label="站点名称"><input className="input" value={str('site_name')} onChange={(e) => set('site_name', e.target.value)} /></Field>
            <Field label="面板语言" hint="影响面板自带通知的文案">
              <select className="select" value={str('language') || 'zh-CN'} onChange={(e) => set('language', e.target.value)}>
                <option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en-US">English</option>
              </select>
            </Field>
            <Field label="页脚副文案" hint="显示在前台底部「站点名 · 副文案」，留空则只显示站点名" full>
              <input className="input" placeholder="只读探针，Agent 不执行任何远程指令" value={footerText} onChange={(e) => setFooterText(e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="glass card-pad">
          <h3 className="sec-title">Agent 连接</h3>
          <div className="form">
            <Field label="Agent 连接地址" hint="Agent 用来连接面板的 域名:端口，生成安装命令时使用">
              <input className="input" placeholder="probe.example.com:443" value={str('install_host')} onChange={(e) => set('install_host', e.target.value)} />
            </Field>
            <div className="fld">
              <span>传输加密</span>
              <label className="check" style={{ height: 36 }}><input type="checkbox" checked={!!f.tls} onChange={(e) => set('tls', e.target.checked)} />Agent 通过 TLS 连接（面板前有 HTTPS 反代时勾选）</label>
            </div>
          </div>
        </section>

        <section className="glass card-pad">
          <h3 className="sec-title">反向代理</h3>
          <div className="form">
            <Field label="访客真实 IP 请求头" hint="如 X-Forwarded-For、CF-Connecting-IP；直连留空">
              <input className="input" value={str('web_real_ip_header')} onChange={(e) => set('web_real_ip_header', e.target.value)} />
            </Field>
            <Field label="Agent 真实 IP 请求头" hint="反代 gRPC 时填写，用于识别服务器 IP">
              <input className="input" value={str('agent_real_ip_header')} onChange={(e) => set('agent_real_ip_header', e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="glass card-pad">
          <h3 className="sec-title">数据</h3>
          <div className="form">
            <Field label="在线统计保留天数" hint="7 ~ 3650">
              <input className="input" type="number" min={7} max={3650} value={(f.online_stats_days as number) || ''} onChange={(e) => set('online_stats_days', Number(e.target.value))} />
            </Field>
            <div className="fld">
              <span>监控历史（TSDB）</span>
              <div style={{ height: 36, display: 'flex', alignItems: 'center' }}>
                {setting?.tsdb_enabled ? <span className="tag ok">已启用</span> : <a className="tag warn" href="/dashboard/themes">未启用：去「主题与外观」一键开启</a>}
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
