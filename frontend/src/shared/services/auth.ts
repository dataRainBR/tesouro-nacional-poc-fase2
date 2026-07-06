// URL base da API — string vazia usa o proxy do Vite em dev; em prod definir VITE_API_URL
const API_URL = import.meta.env.VITE_API_URL ?? ''

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export interface AuthTokens {
  accessToken: string
  idToken: string
  refreshToken: string
  expiresIn: number
}

export interface AuthUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
}

// ---------------------------------------------------------------------------
// Chaves do localStorage
// ---------------------------------------------------------------------------
const TOKEN_KEY = 'auth_tokens'
const USER_KEY = 'auth_user'

// ---------------------------------------------------------------------------
// Helpers de base64url → base64 (JWT usa base64url, atob() espera base64 padrão)
// ---------------------------------------------------------------------------
function parseJwtPayload(token: string): Record<string, any> | null {
  try {
    const segment = token.split('.')[1]
    if (!segment) return null
    // base64url → base64 + padding
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// authService
// ---------------------------------------------------------------------------
export const authService = {
  // Salvar tokens e usuário no localStorage
  saveAuth(tokens: AuthTokens, user: AuthUser): void {
    if (typeof window === 'undefined') return
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  },

  // Obter tokens
  getTokens(): AuthTokens | null {
    if (typeof window === 'undefined') return null
    try {
      const raw = localStorage.getItem(TOKEN_KEY)
      return raw ? (JSON.parse(raw) as AuthTokens) : null
    } catch {
      return null
    }
  },

  // Obter dados do usuário (com fallback seguro de role)
  getUser(): AuthUser | null {
    if (typeof window === 'undefined') return null
    try {
      const raw = localStorage.getItem(USER_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return { role: 'user', ...parsed } as AuthUser
    } catch {
      return null
    }
  },

  // Obter access token
  getAccessToken(): string | null {
    return this.getTokens()?.accessToken ?? null
  },

  // Limpar toda a autenticação do localStorage
  clearAuth(): void {
    if (typeof window === 'undefined') return
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  },

  // Verificar se o access token ainda não expirou (verificação local, sem rede)
  isAuthenticated(): boolean {
    const tokens = this.getTokens()
    if (!tokens?.accessToken) return false
    const payload = parseJwtPayload(tokens.accessToken)
    if (!payload?.exp) return false
    // Margem de 30 segundos para evitar race condition entre check e uso
    return payload.exp - 30 > Math.floor(Date.now() / 1000)
  },

  // Renovar tokens usando o refresh token
  async refreshTokens(): Promise<boolean> {
    const tokens = this.getTokens()
    const user = this.getUser()

    if (!tokens?.refreshToken || !user?.email) return false

    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: tokens.refreshToken,
          username: user.email,
        }),
      })

      if (!response.ok) {
        this.clearAuth()
        return false
      }

      const data = await response.json()

      // Manter refreshToken existente (não é retornado no refresh flow do Cognito)
      this.saveAuth(
        {
          ...tokens,
          accessToken: data.accessToken,
          idToken: data.idToken,
          expiresIn: data.expiresIn,
        },
        user
      )
      return true
    } catch {
      // Falha de rede — não desloga, mantém o estado atual
      return false
    }
  },

  // Registrar novo usuário
  async signUp(email: string, password: string, firstName: string, lastName: string) {
    const response = await fetch(`${API_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, firstName, lastName }),
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Erro ao registrar usuário')
    return data
  },

  // Confirmar registro
  async confirmSignUp(email: string, code: string) {
    const response = await fetch(`${API_URL}/api/auth/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Erro ao confirmar registro')
    return data
  },

  // Reenviar código de confirmação
  async resendCode(email: string) {
    const response = await fetch(`${API_URL}/api/auth/resend-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Erro ao reenviar código')
    return data
  },

  // Autenticar usuário
  async signIn(usernameOrEmail: string, password: string) {
    const response = await fetch(`${API_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(usernameOrEmail.includes('@')
          ? { email: usernameOrEmail }
          : { username: usernameOrEmail }),
        password,
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      const err = new Error(data.error || 'Usuário ou senha inválidos') as any
      err.code = data.code
      throw err
    }

    // Challenge: nova senha necessária (usuário criado pelo admin)
    if (data.challenge === 'NEW_PASSWORD_REQUIRED') {
      const err = new Error(data.message || 'É necessário definir uma nova senha.') as any
      err.code = 'NEW_PASSWORD_REQUIRED'
      err.session = data.session
      err.username = usernameOrEmail
      throw err
    }

    this.saveAuth(data.tokens, data.user)
    return data
  },

  // Completar challenge NEW_PASSWORD_REQUIRED
  async completeNewPassword(username: string, newPassword: string, session: string) {
    const response = await fetch(`${API_URL}/api/auth/new-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, newPassword, session }),
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Erro ao definir nova senha')

    this.saveAuth(data.tokens, data.user)
    return data
  },

  // Obter usuário atual (confirma com o backend — role sempre atualizado)
  async getCurrentUser(): Promise<AuthUser | null> {
    const token = this.getAccessToken()
    if (!token) return null

    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        if (response.status === 401) this.clearAuth()
        return null
      }

      const user = await response.json() as AuthUser
      const tokens = this.getTokens()
      if (tokens) this.saveAuth(tokens, user)
      return user
    } catch {
      // Erro de rede — não desloga, pode ser instabilidade
      return this.getUser()
    }
  },

  // Solicitar redefinição de senha
  async forgotPassword(email: string) {
    const response = await fetch(`${API_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Erro ao solicitar redefinição')
    return data
  },

  // Redefinir senha com código
  async resetPassword(email: string, code: string, newPassword: string) {
    const response = await fetch(`${API_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword }),
    })

    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Erro ao redefinir senha')
    return data
  },

  // Logout — invalida a sessão no Cognito e limpa o localStorage
  async signOut() {
    const token = this.getAccessToken()

    // Limpa localmente ANTES de qualquer chamada de rede
    // Isso garante que mesmo se o servidor falhar, o usuário é deslogado localmente
    this.clearAuth()

    if (token) {
      try {
        await fetch(`${API_URL}/api/auth/signout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch {
        // Ignorar erros de rede no logout — já limpou localmente
      }
    }
  },
}
