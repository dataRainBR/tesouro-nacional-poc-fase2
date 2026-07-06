import { User, LogOut, TrendingUp, Settings, MessageSquare, FlaskConical, History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/src/shared/contexts/AuthContext'
import { api } from '@/src/shared/services/api'

interface HeaderConfig {
  orgName?: string
  orgLogo?: string
}

// Cache em memória do módulo — persiste entre re-renders e navegações
let orgConfigCache: HeaderConfig | null = null

export function Header() {
  const { user, signOut, loading } = useAuth()
  const navigate = useNavigate()
  const [config, setConfig] = useState<HeaderConfig | null>(orgConfigCache)

  useEffect(() => {
    if (!user || orgConfigCache) return   // já temos cache, não buscar de novo
    const loadConfig = async () => {
      try {
        const { authService } = await import('@/src/shared/services/auth')
        const accessToken = authService.getAccessToken()
        if (!accessToken) return
        const configData = await api.get<{ orgName: string; orgLogo?: string } | null>(
          '/api/organization',
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
        if (configData) {
          const cfg = { orgName: configData.orgName, orgLogo: configData.orgLogo } as HeaderConfig
          orgConfigCache = cfg
          setConfig(cfg)
          if (configData.orgName) localStorage.setItem('orgName', configData.orgName)
        }
      } catch {}
    }
    loadConfig()
  }, [user])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? 'bg-primary-50 text-primary-600'
        : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
    }`

  return (
    <header className="bg-white border-b border-neutral-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-14 gap-6">

          {/* Branding */}
          <Link to="/" className="flex items-center gap-2.5 flex-shrink-0 group">
            {config?.orgLogo ? (
              <img
                src={config.orgLogo}
                alt={config.orgName || 'Logo'}
                className="w-8 h-8 rounded-full object-cover border border-neutral-200"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <div className="w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-sm">
                  {config?.orgName ? config.orgName.substring(0, 2).toUpperCase() : 'TN'}
                </span>
              </div>
            )}
            <span className="text-sm font-semibold text-neutral-900 group-hover:text-primary-600 transition-colors hidden sm:block">
              {config?.orgName || 'Tesouro Nacional'}
            </span>
          </Link>

          {/* Nav central */}
          {user && (
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={navLinkClass}>
                <MessageSquare className="w-4 h-4" />
                Chat
              </NavLink>
              {user.role === 'admin' && (
                <>
                  <NavLink to="/avaliacoes" className={navLinkClass}>
                    <FlaskConical className="w-4 h-4" />
                    Avaliações
                  </NavLink>
                  <NavLink to="/dashboard" className={navLinkClass}>
                    <TrendingUp className="w-4 h-4" />
                    Dashboard
                  </NavLink>
                  <NavLink to="/historico" className={navLinkClass}>
                    <History className="w-4 h-4" />
                    Histórico
                  </NavLink>
                  <NavLink to="/configuracoes" className={navLinkClass}>
                    <Settings className="w-4 h-4" />
                    Configurações
                  </NavLink>
                </>
              )}
            </nav>
          )}

          {/* User / actions */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {loading ? (
              <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            ) : user ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 bg-primary-500 rounded-full flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span className="text-sm text-neutral-700 hidden sm:block">{user.name || user.email}</span>
                </div>
                <button
                  onClick={async () => { await signOut(); navigate('/login') }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-md transition-colors"
                  title="Sair"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:block">Sair</span>
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-2 px-4 py-1.5 bg-primary-500 text-white text-sm font-medium rounded-md hover:bg-primary-600 transition-colors"
              >
                <User className="w-4 h-4" />
                Entrar
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
