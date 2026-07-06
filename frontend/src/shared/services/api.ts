// URL base da API — string vazia usa o proxy do Vite em dev; em prod definir VITE_API_URL
// Mesma lógica de auth.ts para garantir consistência
const API_URL = import.meta.env.VITE_API_URL ?? ''

// Importação lazy para evitar dependência circular
async function tryRefreshTokens(): Promise<boolean> {
  const { authService } = await import('./auth')
  return authService.refreshTokens()
}

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('auth_tokens')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.accessToken ?? null
  } catch {
    return null
  }
}

// Dispara evento para que o AuthContext saiba que o usuário foi deslogado
function dispatchLogout() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth:logout'))
  }
}

export const api = {
  baseURL: API_URL,

  async request<T>(endpoint: string, options?: RequestInit, _retry = false): Promise<T> {
    const token = getAuthToken()

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>),
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      // Config não encontrada em GET — retorna null sem lançar erro (ausência é válida)
      // IMPORTANTE: só em GET — POST/PUT com 404 deve lançar erro normalmente
      if (
        response.status === 404 &&
        endpoint.includes('/api/config') &&
        options?.method === undefined  // undefined = GET (default)
      ) {
        return null as T
      }

      // Token expirado — tenta renovar uma única vez
      if (response.status === 401 && !_retry) {
        const refreshed = await tryRefreshTokens()
        if (refreshed) {
          return this.request<T>(endpoint, options, true)
        }
        // Refresh falhou — dispara evento de logout (AuthContext vai redirecionar via React Router)
        dispatchLogout()
        throw new Error('Sessão expirada. Por favor, faça login novamente.')
      }

      const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }))
      throw new Error(errorData.error || `Erro HTTP ${response.status}`)
    }

    return response.json()
  },

  get<T>(endpoint: string, options?: { headers?: Record<string, string> }): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', headers: options?.headers })
  },

  post<T>(endpoint: string, data?: any, options?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: options?.headers,
      signal: options?.signal,
    })
  },

  put<T>(endpoint: string, data?: any, options?: { headers?: Record<string, string> }): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: options?.headers,
    })
  },

  delete<T>(endpoint: string, options?: { headers?: Record<string, string> }): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE', headers: options?.headers })
  },
}
