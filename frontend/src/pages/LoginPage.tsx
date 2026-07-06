import { useState, useEffect } from 'react'
import { useAuth } from '@/src/shared/contexts/AuthContext'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { authService } from '@/src/shared/services/auth'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Estado do challenge NEW_PASSWORD_REQUIRED
  const [challengeState, setChallengeState] = useState<{ session: string; username: string } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)

  const { signIn, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Redirecionar se já estiver logado (aguarda o carregamento inicial)
  useEffect(() => {
    if (!authLoading && user) {
      const from = (location.state as any)?.from?.pathname || '/'
      navigate(from, { replace: true })
    }
  }, [user, authLoading, navigate, location.state])

  // Não renderiza o formulário enquanto o estado de auth não é conhecido
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return // evita duplo submit
    setError('')
    setLoading(true)

    try {
      await signIn(username, password)
      // navegação feita dentro do signIn (preserva rota de origem)
    } catch (err: any) {
      if (err.code === 'NEW_PASSWORD_REQUIRED') {
        setChallengeState({ session: err.session, username: err.username })
        setError('')
        setLoading(false)
        return
      }
      if (err.code === 'PASSWORD_RESET_REQUIRED') {
        navigate('/forgot-password', { state: { email: username } })
        return
      }
      if (err.code === 'USER_NOT_CONFIRMED') {
        navigate('/signup', { state: { email: username, step: 'confirm' } })
        return
      }
      setError(err.message || 'Usuário ou senha inválidos')
    } finally {
      setLoading(false)
    }
  }

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')

    if (newPassword !== confirmNewPassword) {
      setError('As senhas não coincidem.')
      return
    }
    if (newPassword.length < 8) {
      setError('A senha deve ter no mínimo 8 caracteres.')
      return
    }

    setLoading(true)
    try {
      await authService.completeNewPassword(
        challengeState!.username,
        newPassword,
        challengeState!.session
      )
      // Login completo — navegar
      const from = (location.state as any)?.from?.pathname || '/'
      navigate(from, { replace: true })
      // Forçar reload do estado de auth
      window.location.reload()
    } catch (err: any) {
      setError(err.message || 'Erro ao definir nova senha.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-base">TN</span>
            </div>
            <div>
              <h1 className="text-base font-semibold text-neutral-900 leading-tight">
                Tesouro Nacional
              </h1>
              <p className="text-xs text-neutral-600 leading-tight mt-0.5">
                Assistente Virtual
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-md">
        <div className="bg-white border border-neutral-200 rounded-md shadow-sm">
          {/* Challenge: Definir nova senha */}
          {challengeState ? (
            <>
              <div className="border-b border-neutral-200 px-6 py-4">
                <h2 className="text-xl font-semibold text-neutral-900">Definir nova senha</h2>
                <p className="text-sm text-neutral-600 mt-1">
                  Sua conta foi criada por um administrador. Defina uma nova senha para continuar.
                </p>
              </div>

              <form onSubmit={handleNewPassword} className="px-6 py-6 space-y-4">
                {error && (
                  <div className="bg-error/10 border-l-4 border-error p-4 rounded-r-md" role="alert" aria-live="polite">
                    <div className="flex items-start gap-3">
                      <svg className="h-5 w-5 text-error flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm text-error font-medium">{error}</p>
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium text-neutral-900 mb-1.5">
                    Nova senha
                  </label>
                  <div className="relative">
                    <input
                      id="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setError('') }}
                      className="w-full px-3 py-2.5 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-base pr-10"
                      placeholder="Mínimo 8 caracteres"
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-700"
                      aria-label={showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {showNewPassword ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.29 3.29m0 0L3 3m3.29 3.29L12 12m-5.71-5.71L12 12" /></svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="confirmNewPassword" className="block text-sm font-medium text-neutral-900 mb-1.5">
                    Confirmar nova senha
                  </label>
                  <input
                    id="confirmNewPassword"
                    type={showNewPassword ? 'text' : 'password'}
                    value={confirmNewPassword}
                    onChange={(e) => { setConfirmNewPassword(e.target.value); setError('') }}
                    className="w-full px-3 py-2.5 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-base"
                    placeholder="Repita a nova senha"
                    required
                    minLength={8}
                  />
                </div>

                <p className="text-xs text-neutral-500">
                  A senha deve ter no mínimo 8 caracteres, incluindo letras maiúsculas, minúsculas, números e símbolos.
                </p>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-primary-500 text-white px-4 py-2.5 rounded-md font-medium hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Salvando...</span>
                      </>
                    ) : (
                      <span>Definir senha e entrar</span>
                    )}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
          <div className="border-b border-neutral-200 px-6 py-4">
            <h2 className="text-xl font-semibold text-neutral-900">Entrar</h2>
            <p className="text-sm text-neutral-600 mt-1">Acesse sua conta para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">
            {error && (
              <div
                className="bg-error/10 border-l-4 border-error p-4 rounded-r-md"
                role="alert"
                aria-live="polite"
              >
                <div className="flex items-start gap-3">
                  <svg className="h-5 w-5 text-error flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-error font-medium">{error}</p>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-neutral-900 mb-1.5">
                Usuário ou E-mail
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError('') }}
                className="w-full px-3 py-2.5 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-base"
                placeholder="seu@email.gov.br ou seu_usuario"
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-neutral-900 mb-1.5">
                Senha
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                  className="w-full px-3 py-2.5 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-base pr-10"
                  placeholder="Digite sua senha"
                  required
                  aria-required="true"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-700 focus:outline-none"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.29 3.29m0 0L3 3m3.29 3.29L12 12m-5.71-5.71L12 12" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <Link
                to="/forgot-password"
                className="text-sm text-primary-600 hover:text-primary-700 underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded"
              >
                Esqueceu sua senha?
              </Link>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-500 text-white px-4 py-2.5 rounded-md font-medium hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                aria-busy={loading}
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Entrando...</span>
                  </>
                ) : (
                  <span>Entrar</span>
                )}
              </button>
            </div>
          </form>

          <div className="border-t border-neutral-200 px-6 py-4 bg-neutral-50">
            <p className="text-sm text-neutral-600 text-center">
              Não tem uma conta?{' '}
              <Link
                to="/signup"
                className="text-primary-600 hover:text-primary-700 underline font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded"
              >
                Criar conta
              </Link>
            </p>
          </div>
            </>
          )}
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-neutral-500">
            Ao entrar, você concorda com nossos{' '}
            <Link to="/termos" className="text-primary-600 hover:text-primary-700 underline">
              termos de uso
            </Link>
            {' '}e{' '}
            <Link to="/privacidade" className="text-primary-600 hover:text-primary-700 underline">
              política de privacidade
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
