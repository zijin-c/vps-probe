import { useRef, useState } from 'react'
import { IDownload, IUpload } from '../components/icons'
import { useToast } from '../components/ui'
import { clsx, fmtBytes } from '../lib/format'
import { PageHead, useConfirm } from './common'

function csrf() {
  const m = document.cookie.match(/(?:^|; )nz-csrf=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export async function downloadBackupFile(includeHistory: boolean): Promise<{ name: string; size: number }> {
  const r = await fetch(`/api/v1/probe/backup?history=${includeHistory ? 1 : 0}`, { credentials: 'same-origin' })
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
  return { name, size: blob.size }
}

export default function Backup() {
  const toast = useToast()
  const confirm = useConfirm()
  const [history, setHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const downloadNow = async () => {
    setBusy(true)
    try {
      const { name, size } = await downloadBackupFile(history)
      toast(`已下载 ${name}（${fmtBytes(size)}）`, 'ok')
    } catch (e) {
      toast(`下载失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  const restoreUpload = async () => {
    const f = pickedFile || file.current?.files?.[0]
    if (!f) return toast('请先选择备份文件', 'err')
    const ok = await confirm({
      title: '上传并恢复备份',
      message: (
        <>
          确定用 <b>{f.name}</b>（{fmtBytes(f.size)}）覆盖当前全部数据吗？
          <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>旧数据会另存到 <code>data/backups/pre-restore-时间/</code>，上传后面板会自动重启。</div>
        </>
      ),
      confirmText: '上传并恢复',
      danger: true,
    })
    if (!ok) return
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
      <PageHead title="备份与恢复" desc="手动打包并通过浏览器下载备份，包含服务器与 Agent 密钥、账单、分组、监控、告警、通知、流量记录、用户及面板配置。重新部署后导入，Agent 不用重装。" />

      <div style={{ display: 'grid', gap: 16, maxWidth: 820 }}>
        <section className="glass card-pad">
          <h3 className="sec-title">手动下载备份</h3>
          <label className="check" style={{ marginBottom: 14 }}>
            <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
            同时包含监控历史（TSDB，体积较大）
          </label>
          <div>
            <button className="btn primary" onClick={downloadNow} disabled={busy}>
              <IDownload />{busy ? '打包生成中…' : '立即备份并下载'}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: '12px 0 0' }}>
            点击后会实时打包并通过浏览器下载 <code>.tar.gz</code> 文件。备份包含 Agent 与面板密钥，请妥善保管。
          </p>
        </section>

        <section className="glass card-pad">
          <h3 className="sec-title">上传备份恢复</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            会<b>整体替换</b>当前数据。上传后面板自动重启以应用（需要 docker <code>restart: always</code> 或 systemd <code>Restart=always</code>）。
          </p>
          <input
            ref={file}
            type="file"
            accept=".gz,.tar.gz,application/gzip"
            style={{ display: 'none' }}
            onChange={(e) => setPickedFile(e.target.files?.[0] || null)}
          />
          <div
            className={clsx('dropzone', drag && 'drag')}
            onClick={() => file.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              const f = e.dataTransfer.files?.[0]
              if (f) setPickedFile(f)
            }}
          >
            <IUpload style={{ width: 22, height: 22, color: 'var(--muted)' }} />
            <div style={{ fontSize: 13.5, fontWeight: 550 }}>
              {pickedFile ? `${pickedFile.name}（${fmtBytes(pickedFile.size)}）` : '点击选择或拖拽 .tar.gz 备份文件到这里'}
            </div>
            <div className="faint" style={{ fontSize: 12 }}>支持本探针导出的 probe-backup-*.tar.gz</div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="btn danger solid" onClick={restoreUpload} disabled={restoring || !pickedFile}>
              {restoring ? '恢复中，面板重启后自动刷新…' : '上传并恢复'}
            </button>
            {pickedFile && <button className="btn ghost" onClick={() => { setPickedFile(null); if (file.current) file.current.value = '' }}>清除选择</button>}
          </div>
        </section>
      </div>
    </>
  )
}
