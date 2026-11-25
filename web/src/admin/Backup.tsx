import { useRef, useState } from 'react'
import { IArchive } from '../components/icons'
import { useToast } from '../components/ui'
import { PageHead } from './common'

function csrf() {
  const m = document.cookie.match(/(?:^|; )nz-csrf=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export default function Backup() {
  const toast = useToast()
  const [history, setHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const download = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/v1/probe/backup?history=${history ? 1 : 0}`, { credentials: 'same-origin' })
      if (!r.ok || !(r.headers.get('content-type') || '').includes('gzip')) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const name = r.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'probe-backup.tar.gz'
      const blob = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
      toast(`已下载 ${name}（${(blob.size / 1048576).toFixed(2)} MB）`, 'ok')
    } catch (e) {
      toast(`下载失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    const f = file.current?.files?.[0]
    if (!f) return toast('请先选择备份文件', 'err')
    if (!confirm(`确定用 ${f.name} 覆盖当前全部数据吗？旧数据会另存到 data/backups/pre-restore-时间/`)) return
    setRestoring(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await fetch('/api/v1/probe/restore', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf() } })
      const j = await r.json().catch(() => ({}))
      if (!j.success) throw new Error(j.error || `HTTP ${r.status}`)
      toast(j.data, 'ok')
      setTimeout(() => location.reload(), 12000)
    } catch (e) {
      toast(`恢复失败：${(e as Error).message}`, 'err')
      setRestoring(false)
    }
  }

  return (
    <>
      <PageHead title="备份与恢复" desc="备份包含服务器与 Agent 密钥、账单、分组、监控、告警、通知、流量记录、用户、面板配置与 TG 机器人配置。重新部署后导入，Agent 不用重装。" />
      <div style={{ display: 'grid', gap: 14, maxWidth: 820 }}>
        <section className="glass card-pad">
          <h3 className="sec-title">下载备份</h3>
          <label className="check" style={{ marginBottom: 14 }}><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />同时包含监控历史（TSDB，体积较大）</label>
          <div><button className="btn primary" onClick={download} disabled={busy}><IArchive />{busy ? '生成中…' : '下载备份'}</button></div>
          <p className="muted" style={{ fontSize: 12.5, margin: '12px 0 0' }}>面板每天还会自动备份到 <code>data/backups/</code>（保留 7 份），可在 <code>data/probe.yaml</code> 调整，或设置为同时发到 Telegram。备份文件含密钥，请妥善保管。</p>
        </section>
        <section className="glass card-pad">
          <h3 className="sec-title">从备份恢复</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>会<b>整体替换</b>当前数据。上传后面板自动重启以应用（需要 docker <code>restart: always</code> 或 systemd <code>Restart=always</code>）。</p>
          <input ref={file} type="file" accept=".gz,.tar.gz,application/gzip" style={{ display: 'block', marginBottom: 12 }} />
          <button className="btn danger solid" onClick={restore} disabled={restoring}>{restoring ? '恢复中，面板重启后自动刷新…' : '上传并恢复'}</button>
        </section>
      </div>
    </>
  )
}
