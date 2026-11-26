// 首页大数字旁的「矩阵徽记」：4×4 方格，一格一台服务器（多于 16 台按比例），
// 在线为蓝、离线为红，一道对角线的光波周期性扫过
import { clsx } from '../../lib/format'
import type { LiveServer } from '../../lib/hooks'

const N = 16

export default function MatrixEmblem({ servers }: { servers: LiveServer[] }) {
  const total = servers.length
  const online = servers.filter((s) => s.online).length
  let on = online, off = total - online
  if (total > N) { on = Math.round((online / total) * N); off = N - on }
  const cells = Array.from({ length: N }, (_, i) => (i < on ? 'on' : i < on + off ? 'off' : ''))
  return (
    <span className="mx-emblem" aria-hidden="true" title={`${online} 台在线 / 共 ${total} 台`}>
      {cells.map((c, i) => (
        <i key={i} className={clsx(c)} style={{ ['--d' as string]: `${((i % 4) + Math.floor(i / 4)) * 0.11}s` }} />
      ))}
    </span>
  )
}
