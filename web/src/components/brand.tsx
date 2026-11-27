import { useEffect, useState } from 'react'

// 国旗：按需加载 flag-icons 的 SVG（Windows 不支持旗帜 emoji，所以用图片）。
// glob 是懒加载的：只有页面上真正出现的国家才会请求对应文件。
const flagLoaders = import.meta.glob('../../node_modules/flag-icons/flags/4x3/*.svg', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>
const flagCache = new Map<string, string>()

/** CSS background-image 用的 url()：小图会被内联成含引号的 data: 地址，必须加引号 */
export const cssUrl = (u: string) => `url("${u.replace(/"/g, '%22')}")`

/** 在 SVG 里用 <image> 画国旗时使用：返回国旗图片地址（按需加载） */
export function useFlagUrls(codes: string[]): Record<string, string> {
  const key = [...new Set(codes.map((c) => c.toLowerCase()).filter(Boolean))].sort().join(',')
  const [urls, setUrls] = useState<Record<string, string>>(() => Object.fromEntries([...flagCache.entries()]))
  useEffect(() => {
    let alive = true
    for (const cc of key ? key.split(',') : []) {
      if (flagCache.has(cc)) continue
      const load = flagLoaders[`../../node_modules/flag-icons/flags/4x3/${cc}.svg`]
      if (!load) continue
      load().then((u) => {
        flagCache.set(cc, u)
        if (alive) setUrls(Object.fromEntries([...flagCache.entries()]))
      }).catch(() => {})
    }
    setUrls(Object.fromEntries([...flagCache.entries()]))
    return () => { alive = false }
  }, [key])
  return urls
}

export function Flag({ code, className = 'flag' }: { code?: string; className?: string }) {
  const cc = (code || '').toLowerCase()
  const key = `../../node_modules/flag-icons/flags/4x3/${cc}.svg`
  const [src, setSrc] = useState<string | undefined>(() => flagCache.get(cc))
  useEffect(() => {
    if (!cc || flagCache.has(cc)) { setSrc(flagCache.get(cc)); return }
    const load = flagLoaders[key]
    if (!load) return
    let alive = true
    load().then((u) => { flagCache.set(cc, u); if (alive) setSrc(u) }).catch(() => {})
    return () => { alive = false }
  }, [cc, key])
  if (!cc || !flagLoaders[key]) {
    // 没有国家信息：画一个小地球
    return (
      <span className={`${className} flag-none`} title="未知地区" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" /></svg>
      </span>
    )
  }
  return <span className={className} title={cc.toUpperCase()} style={src ? { backgroundImage: cssUrl(src) } : undefined} aria-label={cc.toUpperCase()} />
}

// 系统图标：简化后的品牌标识，只用于识别，不追求还原
export function OsLogo({ os, className = 'oslogo' }: { os?: string; className?: string }) {
  const s = (os || '').toLowerCase()
  let body: JSX.Element
  let color = '#8a96ad'
  if (s.includes('debian')) {
    color = '#d70a53'
    body = <path d="M13.6 4.2c-4.7-.3-8 3.4-7.8 7.6.2 3.9 3.4 6.8 7.2 6.7 2.4-.1 4.2-1.3 5-3.2-1 1.4-2.8 2.2-4.7 2.1-3-.1-5.3-2.6-5.2-5.6.1-2.7 2.3-4.8 5-4.7 2.2.1 3.9 1.9 3.8 4.1-.1 1.7-1.5 3-3.2 2.9-1.3-.1-2.3-1.1-2.3-2.4 0-1 .8-1.8 1.8-1.8" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
  } else if (s.includes('ubuntu')) {
    color = '#e95420'
    body = <><circle cx="12" cy="12" r="5.2" fill="none" stroke={color} strokeWidth="2" /><circle cx="6.2" cy="12" r="2" fill={color} /><circle cx="14.9" cy="7" r="2" fill={color} /><circle cx="14.9" cy="17" r="2" fill={color} /></>
  } else if (s.includes('windows')) {
    color = '#0a84d8'
    body = <><rect x="4.5" y="4.5" width="6.6" height="6.6" fill={color} /><rect x="12.9" y="4.5" width="6.6" height="6.6" fill={color} /><rect x="4.5" y="12.9" width="6.6" height="6.6" fill={color} /><rect x="12.9" y="12.9" width="6.6" height="6.6" fill={color} /></>
  } else if (s.includes('centos') || s.includes('rocky') || s.includes('alma') || s.includes('fedora') || s.includes('red hat')) {
    color = s.includes('rocky') ? '#10b981' : s.includes('fedora') ? '#3c6eb4' : '#932279'
    body = <g transform="rotate(45 12 12)"><rect x="5.5" y="5.5" width="5.8" height="5.8" fill="#efa724" /><rect x="12.7" y="5.5" width="5.8" height="5.8" fill="#262577" /><rect x="5.5" y="12.7" width="5.8" height="5.8" fill="#9ccd2a" /><rect x="12.7" y="12.7" width="5.8" height="5.8" fill={color} /></g>
  } else if (s.includes('alpine')) {
    color = '#0d597f'
    body = <path d="M3.5 17.5l5.5-8 3.2 4.4 2.3-3 5.9 6.6z" fill={color} />
  } else if (s.includes('arch')) {
    color = '#1793d1'
    body = <path d="M12 4l7 15c-2.2-1.4-4.4-2.2-7-2.2S7.2 17.6 5 19z" fill={color} />
  } else if (s.includes('freebsd')) {
    color = '#ab2b28'
    body = <circle cx="12" cy="12.5" r="6.5" fill={color} />
  } else {
    body = <><rect x="5" y="6" width="14" height="12" rx="2" fill="none" stroke={color} strokeWidth="1.8" /><path d="M8 10l2.5 2L8 14M12 14.5h4" stroke={color} strokeWidth="1.8" strokeLinecap="round" fill="none" /></>
  }
  return (
    <span className={className} title={os || '未知系统'} style={{ ['--os' as string]: color }}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{body}</svg>
    </span>
  )
}
