// 主题仓库：每个主题 = 一组 CSS 变量覆盖（[data-skin="id"]）+ 可选的首页卡片组件。
// 新增主题：在 themes/<id>/ 下放 CSS 和卡片组件，然后在 THEMES 里登记一项。
import type { ComponentType } from 'react'
import type { QualityBrief } from '../lib/api'
import type { CycleTraffic, LatencyLine, LiveServer } from '../lib/hooks'

export interface CardProps {
  s: LiveServer
  traffic?: CycleTraffic
  latency?: LatencyLine[]
  brief?: QualityBrief
}

export interface ThemeDef {
  id: string
  name: string
  desc: string
  author: string
  tags: string[]
  /** 预览用的配色：[背景, 卡片, 强调1, 强调2, 强调3] */
  swatch: { dark: string[]; light: string[] }
  /** 首页卡片使用宽版布局（每行更少卡片） */
  wide?: boolean
}

export const THEMES: ThemeDef[] = [
  {
    id: 'observatory',
    name: '观测台',
    desc: '暖调石墨与纸张底色，等高线背景与雷达概览，克制、像精密仪器面板。',
    author: '内置',
    tags: ['简约', '仪表', '雷达概览'],
    swatch: { dark: ['#0d0d0c', '#171716', '#ff7438', '#6fd39b', '#8fb0e8'], light: ['#efede6', '#fbfaf6', '#e4561b', '#1f8f5a', '#3c65b0'] },
  },
  {
    id: 'matrix',
    name: '矩阵',
    desc: '信息密度最高的彩色仪表卡：分色指标条、流量与周期方块进度、三网去回程与延迟丢包、可展开的 IP 能力与解锁面板。',
    author: '内置',
    tags: ['信息全', '彩色', 'IP 能力'],
    swatch: { dark: ['#0a1120', '#111b2e', '#3b9bff', '#a855f7', '#22c55e'], light: ['#eef3fa', '#ffffff', '#2f7ff0', '#9d4edd', '#16a34a'] },
    wide: true,
  },
]

export const DEFAULT_THEME = 'observatory'

export function findTheme(id?: string | null): ThemeDef {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME)!
}

/** 卡片组件按需注册（避免 registry 与组件互相引用） */
const cards: Record<string, ComponentType<CardProps>> = {}
export function registerCard(id: string, c: ComponentType<CardProps>) { cards[id] = c }
export function cardFor(id: string): ComponentType<CardProps> | undefined { return cards[id] }
