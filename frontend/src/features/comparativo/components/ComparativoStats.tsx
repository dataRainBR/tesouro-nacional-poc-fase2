/**
 * Dashboard de métricas do Modo Comparativo — win-rate por agente.
 */

import { useState, useEffect } from 'react'
import { Trophy, Activity, Loader2 } from 'lucide-react'
import { api } from '@/src/shared/services/api'

interface WinRateEntry {
  wins: number
  total: number
  rate: number
}

interface Stats {
  total: number
  votados: number
  winRateByAgent: Record<string, WinRateEntry>
}

export function ComparativoStats() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<Stats>('/api/comparativos/stats')
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-neutral-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Carregando métricas…
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="text-center py-12 text-neutral-400 text-sm">
        Erro ao carregar métricas.
      </div>
    )
  }

  const agentEntries = Object.entries(stats.winRateByAgent).sort(
    (a, b) => b[1].rate - a[1].rate
  )

  return (
    <div className="space-y-6">
      {/* Resumo geral */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border border-primary-200 bg-primary-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-5 h-5 text-primary-600" />
            <span className="text-xs text-neutral-600">Comparações realizadas</span>
          </div>
          <p className="text-2xl font-bold text-neutral-800">{stats.total}</p>
        </div>
        <div className="border border-green-200 bg-green-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-5 h-5 text-green-600" />
            <span className="text-xs text-neutral-600">Com voto registrado</span>
          </div>
          <p className="text-2xl font-bold text-neutral-800">{stats.votados}</p>
        </div>
      </div>

      {/* Win-rate por agente */}
      <div className="bg-white border border-neutral-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-neutral-700 mb-4">Win-Rate por Agente</h3>

        {agentEntries.length === 0 ? (
          <p className="text-xs text-neutral-400 text-center py-4">
            Nenhuma comparação realizada ainda.
          </p>
        ) : (
          <div className="space-y-3">
            {agentEntries.map(([name, entry], idx) => (
              <div key={name} className="flex items-center gap-3">
                <span className="text-xs font-medium text-neutral-500 w-5">
                  {idx + 1}.
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-neutral-800 font-medium">{name}</span>
                    <span className="text-xs text-neutral-500">
                      {entry.wins}/{entry.total} ({entry.rate}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary-400 to-primary-500 rounded-full transition-all duration-500"
                      style={{ width: `${entry.rate}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
