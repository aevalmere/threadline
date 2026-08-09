import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import AppShell from '@/components/layout/AppShell'
import { AuthProvider } from '@/lib/auth'
import AuthCallback from '@/routes/AuthCallback'
import ChannelView from '@/routes/ChannelView'
import Channels from '@/routes/Channels'
import Docs from '@/routes/Docs'
import Forums from '@/routes/Forums'
import Login from '@/routes/Login'
import RequireAuth from '@/routes/RequireAuth'
import Tasks from '@/routes/Tasks'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/channels" replace />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/channels/:channelId" element={<ChannelView />} />
              <Route path="/forums" element={<Forums />} />
              <Route path="/forums/:channelId" element={<Forums />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/tasks" element={<Tasks />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
