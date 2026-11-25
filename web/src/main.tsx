import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from './components/ui'
import Home from './pages/Home'
import ServerDetail from './pages/ServerDetail'
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/instrument-serif/latin-400-italic.css'
import { Backdrop } from './components/art'
import './styles.css'

// 后台单独分包，访客只加载前台代码
const Admin = lazy(() => import('./admin/Admin'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Backdrop />
    <ToastProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Suspense fallback={<div className="empty">加载中…</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/server/:id" element={<ServerDetail />} />
            <Route path="/dashboard/*" element={<Admin />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
)
