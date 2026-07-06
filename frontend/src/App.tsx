import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './shared/contexts/AuthContext'
import { ConditionalHeader } from './shared/components/ConditionalHeader'
import { ProtectedRoute, AdminRoute } from './features/auth/components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import ConfiguracoesPage from './pages/ConfiguracoesPage'
import DashboardPage from './pages/DashboardPage'
import HistoryPage from './pages/HistoryPage'
import EvaluationsPage from './pages/EvaluationsPage'
import EvaluationDetailPage from './pages/EvaluationDetailPage'

function AppRoutes() {
  return (
    <>
      <ConditionalHeader />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/configuracoes"
          element={
            <AdminRoute>
              <ConfiguracoesPage />
            </AdminRoute>
          }
        />
        {/* Alias legado — mesma tela de configurações */}
        <Route path="/settings" element={<Navigate to="/configuracoes" replace />} />
        <Route
          path="/dashboard"
          element={
            <AdminRoute>
              <DashboardPage />
            </AdminRoute>
          }
        />
        <Route
          path="/historico"
          element={
            <AdminRoute>
              <HistoryPage />
            </AdminRoute>
          }
        />
        <Route
          path="/avaliacoes"
          element={
            <AdminRoute>
              <EvaluationsPage />
            </AdminRoute>
          }
        />
        <Route
          path="/avaliacoes/:jobId"
          element={
            <AdminRoute>
              <EvaluationDetailPage />
            </AdminRoute>
          }
        />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
