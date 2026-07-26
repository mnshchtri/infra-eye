import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Servers } from './pages/Servers'
import { ServerDetail } from './pages/ServerDetail'
import { AIAssistant } from './pages/AIAssistant'
import { AlertRules } from './pages/AlertRules'
import { Settings } from './pages/Settings'
import { Resources } from './pages/Resources'
import { ResourceDetail } from './pages/ResourceDetail'
import { Kubernetes } from './pages/Kubernetes'
import { DevTools } from './pages/DevTools'
import { VPN } from './pages/VPN'
import { Networking } from './pages/Networking'
import { Audit } from './pages/Audit'
import { AuditHardening } from './pages/AuditHardening'
import { AuditCluster } from './pages/AuditCluster'
import { AuditResources } from './pages/AuditResources'
import { IacSync } from './pages/IacSync'
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
          <Route path="servers/:id/networking" element={<Networking />} />
          <Route path="resources" element={<Resources />} />
          <Route path="resources/:id" element={<ResourceDetail />} />
          <Route path="logs" element={<Navigate to="/" />} /> {/* Redirects to select a server */}
          <Route path="terminal" element={<Navigate to="/" />} />
          <Route path="kubectl" element={<Navigate to="/" />} />
          <Route path="ai" element={<AIAssistant />} />
          <Route path="alerts" element={<AlertRules />} />
          <Route path="settings" element={<Settings />} />
          <Route path="kubernetes" element={<Kubernetes />} />
          <Route path="devtools" element={<DevTools />} />
          <Route path="iac-sync" element={<IacSync />} />
          <Route path="vpn" element={<VPN />} />
          <Route path="audit/kernel" element={<Audit />} />
          <Route path="audit/hardening" element={<AuditHardening />} />
          <Route path="audit/cluster" element={<AuditCluster />} />
          <Route path="audit/resources" element={<AuditResources />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
