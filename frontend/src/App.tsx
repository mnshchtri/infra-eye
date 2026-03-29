import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Servers } from './pages/Servers'
import { ServerDetail } from './pages/ServerDetail'
import { AIAssistant } from './pages/AIAssistant'
import { AlertRules } from './pages/AlertRules'
import { useAuthStore } from './store/authStore'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="servers" element={<Servers />} />
          <Route path="servers/:id" element={<ServerDetail />} />
          <Route path="logs" element={<Navigate to="/" />} /> {/* Redirects to select a server */}
          <Route path="terminal" element={<Navigate to="/" />} />
          <Route path="kubectl" element={<Navigate to="/" />} />
          <Route path="ai" element={<AIAssistant />} />
          <Route path="alerts" element={<AlertRules />} />
          <Route path="settings" element={<div className="page"><div className="empty-state">Settings coming soon</div></div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
