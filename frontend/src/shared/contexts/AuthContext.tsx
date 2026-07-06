import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react'
import { authService, type AuthUser } from '@/src/shared/services/auth'
import { useNavigate, useLocation } from 'react-router-dom'

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  signIn: (usernameOrEmail: string, password: string) => Promise<void>
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<void>
  confirmSignUp: (email: string, code: string) => Promise<void>
  resendCode: (email: string) => Promise<void>
  signOut: () => Promise<void>
  forgotPassword: (email: string) => Promise<void>
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const location = useLocation()

  // ---------------------------------------------------------------------------
  // loadUser — carrega e valida a sessão na inicialização
  // Usa flag de cancelamento para evitar race condition em remontagens
  // ---------------------------------------------------------------------------
  const loadUser = useCallback(async () => {
    let cancelled = false
    setLoading(true)

    try {
      const cachedUser = authService.getUser()
      if (!cachedUser) {
        if (!cancelled) setUser(null)
        return
      }

      if (authService.isAuthenticated()) {
        // Token válido — confirma com o backend para garantir role atualizado
        const freshUser = await authService.getCurrentUser()
        if (!cancelled) setUser(freshUser)
      } else {
        // Token expirado — tenta renovar
        const refreshed = await authService.refreshTokens()
        if (refreshed) {
          const freshUser = await authService.getCurrentUser()
          if (!cancelled) setUser(freshUser)
        } else {
          if (!cancelled) setUser(null)
        }
      }
    } catch {
      // Erro inesperado — mantém o usuário em cache para não deslogar por instabilidade de rede
      if (!cancelled) setUser(authService.getUser())
    } finally {
      if (!cancelled) setLoading(false)
    }

    return () => {
      cancelled = true
    }
  }, [])

  // Carrega usuário na montagem
  useEffect(() => {
    loadUser()
  }, [loadUser])

  // ---------------------------------------------------------------------------
  // Escuta evento de logout disparado pelo api.ts quando o refresh falha
  // Também sincroniza logout entre abas (storage event)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleApiLogout = () => {
      setUser(null)
      navigate('/login', { replace: true })
    }

    const handleStorageLogout = (e: StorageEvent) => {
      // Outra aba limpou o auth_tokens → sincronizar estado
      if (e.key === 'auth_tokens' && e.newValue === null) {
        setUser(null)
        navigate('/login', { replace: true })
      }
    }

    window.addEventListener('auth:logout', handleApiLogout)
    window.addEventListener('storage', handleStorageLogout)

    return () => {
      window.removeEventListener('auth:logout', handleApiLogout)
      window.removeEventListener('storage', handleStorageLogout)
    }
  }, [navigate])

  // ---------------------------------------------------------------------------
  // signIn — preserva a rota de destino original
  // ---------------------------------------------------------------------------
  const signIn = async (usernameOrEmail: string, password: string) => {
    const data = await authService.signIn(usernameOrEmail, password)
    setUser(data.user)
    // Redireciona para a rota que o usuário estava tentando acessar,
    // ou para a home se não houver rota de origem.
    // Evita ficar em /login ou / (raiz) quando logado — vai para home.
    const from = (location.state as any)?.from?.pathname
    const destination = from && from !== '/' && from !== '/login' ? from : '/'
    navigate(destination, { replace: true })
  }

  const signUp = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string
  ) => {
    await authService.signUp(email, password, firstName, lastName)
  }

  const confirmSignUp = async (email: string, code: string) => {
    await authService.confirmSignUp(email, code)
  }

  const resendCode = async (email: string) => {
    await authService.resendCode(email)
  }

  // ---------------------------------------------------------------------------
  // signOut — limpa localmente primeiro, depois invalida no servidor
  // ---------------------------------------------------------------------------
  const signOut = async () => {
    setUser(null) // atualiza UI imediatamente
    await authService.signOut() // limpa localStorage + chama servidor
    navigate('/login', { replace: true })
  }

  const forgotPassword = async (email: string) => {
    await authService.forgotPassword(email)
  }

  const resetPassword = async (email: string, code: string, newPassword: string) => {
    await authService.resetPassword(email, code, newPassword)
  }

  const refreshUser = async () => {
    await loadUser()
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signUp,
        confirmSignUp,
        resendCode,
        signOut,
        forgotPassword,
        resetPassword,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider')
  }
  return context
}
