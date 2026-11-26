// 注册所有主题的卡片组件与样式（样式都用 [data-skin] 限定，互不影响）
import ServerCard from '../components/ServerCard'
import MatrixCard from './matrix/MatrixCard'
import './matrix/matrix.css'
import { registerCard } from './registry'

registerCard('observatory', ServerCard)
registerCard('matrix', MatrixCard)

export * from './registry'
