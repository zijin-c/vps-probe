import { useCallback, useEffect, useState } from 'react'
import { ISend } from '../components/icons'
import { Field, useToast } from '../components/ui'
import { api, type ProbeConfigView } from '../lib/api'
import { PageHead, useAction } from './common'

function parseNumList(raw: string): number[] {
  return raw
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n))
}

export default function ProbeConfig() {
  const toast = useToast()
  const { busy, run } = useAction()
  const [cfg, setCfg] = useState<ProbeConfigView | null>(null)
  const [needRestart, setNeedRestart] = useState(false)
  const [testing, setTesting] = useState(false)

  // Telegram
  const [botToken, setBotToken] = useState('')
  const [chatIds, setChatIds] = useState('')
  const [apiBase, setApiBase] = useState('https://api.telegram.org')
  const [notifyOffline, setNotifyOffline] = useState(true)
  const [offlineSeconds, setOfflineSeconds] = useState(120)
  const [trafficPercents, setTrafficPercents] = useState('80, 90, 100')
  const [expireDays, setExpireDays] = useState('7, 3, 1')
  const [notifyHour, setNotifyHour] = useState(10)

  // IP 质量检测
  const [intervalHours, setIntervalHours] = useState(24)
  const [ipinfoToken, setIpinfoToken] = useState('')
  const [abuseKey, setAbuseKey] = useState('')
  const [ip2locKey, setIp2locKey] = useState('')

  const applyView = useCallback((v: ProbeConfigView) => {
    setCfg(v)
    setBotToken('')
    setChatIds((v.telegram.chat_ids || []).join(', '))
    setApiBase(v.telegram.api_base || 'https://api.telegram.org')
    setNotifyOffline(v.telegram.notify_offline)
    setOfflineSeconds(v.telegram.offline_seconds || 120)
    setTrafficPercents((v.telegram.traffic_percents || []).join(', '))
    setExpireDays((v.telegram.expire_days || []).join(', '))
    setNotifyHour(v.telegram.notify_hour)

    setIntervalHours(v.quality.interval_hours || 24)
    setIpinfoToken('')
    setAbuseKey('')
    setIp2locKey('')
  }, [])

  useEffect(() => {
    api<ProbeConfigView>('/probe/config').then(applyView).catch((e) => toast(e.message, 'err'))
  }, [applyView, toast])

  const save = async () => {
    const body = {
      telegram: {
        bot_token: botToken.trim() || undefined,
        chat_ids: parseNumList(chatIds),
        api_base: apiBase.trim() || 'https://api.telegram.org',
        notify_offline: notifyOffline,
        offline_seconds: Number(offlineSeconds) || 120,
        traffic_percents: parseNumList(trafficPercents),
        expire_days: parseNumList(expireDays),
        notify_hour: Number(notifyHour) || 0,
      },
      backup: {
        daily: false,
      },
      quality: {
        interval_hours: Number(intervalHours) || 24,
        ipinfo_token: ipinfoToken.trim() || undefined,
        abuseipdb_key: abuseKey.trim() || undefined,
        ip2location_key: ip2locKey.trim() || undefined,
      },
    }
    await run(async () => {
      const res = await api<{ need_restart: boolean; config: ProbeConfigView }>('/probe/config', { method: 'PATCH', body })
      applyView(res.config)
      if (res.need_restart) setNeedRestart(true)
    }, '探针配置已保存')
  }

  const testTg = async () => {
    setTesting(true)
    try {
      const msg = await api<string>('/probe/telegram/test', {
        method: 'POST',
        body: {
          bot_token: botToken.trim(),
          api_base: apiBase.trim(),
          chat_ids: parseNumList(chatIds),
        },
      })
      toast(msg || '测试消息已发送', 'ok')
    } catch (e) {
      toast(`测试失败：${(e as Error).message}`, 'err')
    } finally {
      setTesting(false)
    }
  }

  if (!cfg) return <div className="empty">加载中…</div>

  return (
    <>
      <PageHead title="探针配置" desc={<>可视化编辑 <code>data/probe.yaml</code>：Telegram 交互机器人与 IP 质量检测密钥。</>}>
        <button className="btn primary" onClick={save} disabled={busy}>保存配置</button>
      </PageHead>

      {needRestart && (
        <div className="note warn" style={{ marginBottom: 14, maxWidth: 860 }}>
          你修改了 Telegram Bot Token、Chat ID 或 API 地址，已写入 <code>data/probe.yaml</code>；重启面板后交互式机器人将按新配置生效（离线/流量/到期/质量检测参数已实时生效）。
        </div>
      )}

      <div style={{ display: 'grid', gap: 14, maxWidth: 860 }}>
        <section className="glass card-pad">
          <div className="row" style={{ marginBottom: 14 }}>
            <h3 className="sec-title" style={{ margin: 0 }}>Telegram 机器人与提醒</h3>
            <span className={cfg.telegram.running ? 'tag ok' : 'tag plain'}>
              {cfg.telegram.running ? '机器人运行中' : cfg.telegram.has_bot_token ? '已配置（重启生效）' : '未启用'}
            </span>
            <span className="spacer" />
            <button type="button" className="btn sm" onClick={testTg} disabled={testing}>
              <ISend />{testing ? '发送中…' : '发送测试消息'}
            </button>
          </div>
          <div className="form">
            <Field
              label={<>Bot Token {cfg.telegram.has_bot_token && <span className="tag ok" style={{ marginLeft: 6 }}>已配置</span>}</>}
              hint="从 @BotFather 获取；留空保持原值，填 - 清空"
            >
              <input className="input mono" type="password" placeholder={cfg.telegram.has_bot_token ? '••••••••（留空保持原值）' : '123456:ABC…'} value={botToken} onChange={(e) => setBotToken(e.target.value)} />
            </Field>
            <Field label="授权 Chat IDs" hint="多个用逗号分隔；给机器人发 /id 可查看">
              <input className="input mono" placeholder="123456789" value={chatIds} onChange={(e) => setChatIds(e.target.value)} />
            </Field>
            <Field label="API 地址" hint="国内机器可替换为自建 Telegram 反代">
              <input className="input mono" value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
            </Field>
            <Field label="每日到期检查时间（0 ~ 23 时）">
              <input className="input" type="number" min={0} max={23} value={notifyHour} onChange={(e) => setNotifyHour(Number(e.target.value))} />
            </Field>
            <Field label="流量提醒阈值（%）" hint="逗号分隔，如 80, 90, 100">
              <input className="input mono" value={trafficPercents} onChange={(e) => setTrafficPercents(e.target.value)} />
            </Field>
            <Field label="到期提前提醒天数" hint="逗号分隔，如 7, 3, 1">
              <input className="input mono" value={expireDays} onChange={(e) => setExpireDays(e.target.value)} />
            </Field>
            <Field label="离线判定秒数" hint="超过该秒数无上报触发离线提醒（≥ 30）">
              <input className="input" type="number" min={30} value={offlineSeconds} onChange={(e) => setOfflineSeconds(Number(e.target.value))} />
            </Field>
            <div className="fld">
              <span>离线 / 恢复通知</span>
              <label className="check" style={{ height: 38 }}>
                <input type="checkbox" checked={notifyOffline} onChange={(e) => setNotifyOffline(e.target.checked)} />
                开启服务器离线与恢复推送
              </label>
            </div>
          </div>
        </section>

        <section className="glass card-pad">
          <h3 className="sec-title">IP 质量 / 流媒体解锁 / 三网回程</h3>
          <div className="form">
            <Field label="自动重测间隔（小时）" hint="Agent 每隔多久自动重新检测一次（1 ~ 720）">
              <input className="input" type="number" min={1} max={720} value={intervalHours} onChange={(e) => setIntervalHours(Number(e.target.value))} />
            </Field>
            <Field
              label={<>IPInfo Token {cfg.quality.has_ipinfo_token && <span className="tag ok" style={{ marginLeft: 6 }}>已配置</span>}</>}
              hint="可选，提供更准确的使用类型与隐私标记；留空保持，- 清空"
            >
              <input className="input mono" type="password" placeholder={cfg.quality.has_ipinfo_token ? '••••••••（留空保持原值）' : '可选'} value={ipinfoToken} onChange={(e) => setIpinfoToken(e.target.value)} />
            </Field>
            <Field
              label={<>AbuseIPDB Key {cfg.quality.has_abuseipdb_key && <span className="tag ok" style={{ marginLeft: 6 }}>已配置</span>}</>}
              hint="可选，提供 IP 滥用评分；留空保持，- 清空"
            >
              <input className="input mono" type="password" placeholder={cfg.quality.has_abuseipdb_key ? '••••••••（留空保持原值）' : '可选'} value={abuseKey} onChange={(e) => setAbuseKey(e.target.value)} />
            </Field>
            <Field
              label={<>IP2Location Key {cfg.quality.has_ip2location_key && <span className="tag ok" style={{ marginLeft: 6 }}>已配置</span>}</>}
              hint="可选，提供欺诈评分；留空保持，- 清空"
            >
              <input className="input mono" type="password" placeholder={cfg.quality.has_ip2location_key ? '••••••••（留空保持原值）' : '可选'} value={ip2locKey} onChange={(e) => setIp2locKey(e.target.value)} />
            </Field>
          </div>
        </section>
      </div>
    </>
  )
}
