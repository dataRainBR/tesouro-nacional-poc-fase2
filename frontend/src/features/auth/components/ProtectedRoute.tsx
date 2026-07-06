import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/src/shared/contexts/AuthContext'

interface RouteProps {
  children: React.ReactNode
}

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
  </div>
)

export function ProtectedRoute({ children }: RouteProps) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner />

  // Passa a rota de origem no state para que após o login o usuário seja
  // redirecionado de volta para onde estava tentando ir
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

export function AdminRoute({ children }: RouteProps) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner />

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Role vem do backend (via /api/auth/me + localStorage),
  // validado com JWT assinado pelo Cognito no carregamento da sessão
  if (user.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
