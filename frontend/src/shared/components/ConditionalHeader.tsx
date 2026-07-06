import { useLocation } from 'react-router-dom'
import { useAuth } from '@/src/shared/contexts/AuthContext'
import { Header } from './Header'

export function ConditionalHeader() {
  const location = useLocation()
  const { user } = useAuth()
  const isAuthPage = ['/login', '/signup', '/forgot-password'].includes(location.pathname)

  // Não mostra header em páginas de auth ou na raiz quando não autenticado
  if (isAuthPage || (location.pathname === '/' && !user)) {
    return null
  }

  return <Header />
}
