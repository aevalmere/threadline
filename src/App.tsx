import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import AppShell from '@/components/layout/AppShell'
import { AuthProvider } from '@/lib/auth'
import AuthCallback from '@/routes/AuthCallback'
import ChannelView from '@/routes/ChannelView'
import Channels from '@/routes/Channels'
import Docs from '@/routes/Docs'
import ForumView from '@/routes/ForumView'
import Forums from '@/routes/Forums'
import Login from '@/routes/Login'
import PostView from '@/routes/PostView'
import Register from '@/routes/Register'
import RequireAuth from '@/routes/RequireAuth'
import ResetPassword from '@/routes/ResetPassword'
import Settings from '@/routes/Settings'
import Tasks from '@/routes/Tasks'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* Public: requesting a link needs no session. With one, the same
              route sets the new password. */}
          <Route path="/reset" element={<ResetPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/channels" replace />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/channels/:channelId" element={<ChannelView />} />
              <Route path="/forums" element={<Forums />} />
              <Route path="/forums/:channelId" element={<ForumView />} />
              {/* Flat, not nested under the forum: the two places that link
                  to a post — the task SourceChip and the bell — know only a
                  post id; the post row carries channel_id for the breadcrumb
                  back. */}
              <Route path="/posts/:postId" element={<PostView />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
