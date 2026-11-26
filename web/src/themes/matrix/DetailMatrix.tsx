// 详情页「三网延迟」：每条线路一行的热力矩阵，右侧给出当前 / 平均 / 丢包
import { CARRIERS } from '../../components/ServerCard'
import { clsx } from '../../lib/format'
import type { LatencyLine } from '../../lib/hooks'
import LatencyMatrix, { type MatrixRow } from './LatencyMatrix'
import { CARRIER_CLS, regionBaseline, toneOfMs } from './shared'

export default function DetailMatrix({ lines, cc, spanHours = 24 }: { lines: LatencyLine[]; cc?: string; spanHours?: number }) {
  const base = regionBaseline(cc).base
  const rows: MatrixRow[] = lines.map((l) => {
    const carrier = CARRIERS.find((c) => l.name.includes(c))
    const extra = carrier ? l.name.replace(carrier, '').replace(/^[\s(（:：-]+|[\s)）]+$/g, '') : ''
    return {
      key: l.serviceId,
      base,
      values: l.delays,
      title: l.name,
      label: (
        <span className={clsx('lm-carrier', carrier && CARRIER_CLS[carrier])}>
          <i />{carrier || l.name}{extra && <em>{extra}</em>}
        </span>
      ),
      stat: (
        <span className="lm-trio">
          <b className={toneOfMs(l.latest, base)}>{l.latest != null ? Math.round(l.latest) : '超时'}{l.latest != null && <small>ms</small>}</b>
          <span>均 {Math.round(l.avg)}</span>
          <span className={l.loss >= 1 ? 'bad' : ''}>丢 {l.loss.toFixed(1)}%</span>
        </span>
      ),
    }
  })
  return <div className="lm-detail"><LatencyMatrix rows={rows} spanHours={spanHours} /></div>
}
