/**
 * Dashboard de estatísticas dos pareceres — visão geral de qualidade das respostas.
 */

import { useState, useEffect } from 'react'
import { CheckCircle2, XCircle, Clock, Activity, Loader2 } from 'lucide-react'
import { api } from '@/src/shared/services/api'

interface Stats {
  total: number
  aprovados: number
  reprovados: number
  pendentes: number
}

export function ParecerStats() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<Stats>('/api/pareceres/stats')
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-neutral-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Carregando estatísticas…
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="text-center py-12 text-neutral-400 text-sm">
        Erro ao carregar estatísticas.
      </div>
    )
  }

  const approvalRate = stats.total > 0
    ? Math.round((stats.aprovados / (stats.aprovados + stats.reprovados || 1)) * 100)
    : 0

  return (
    <div className="space-y-6">
      {/* Cards de métricas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Activity className="w-5 h-5 text-primary-600" />}
          label="Total de Pareceres"
          value={stats.total}
          color="bg-primary-50 border-primary-200"
        />
        <StatCard
          icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
          label="Aprovados"
          value={stats.aprovados}
          color="bg-green-50 border-green-200"
        />
        <StatCard
          icon={<XCircle className="w-5 h-5 text-red-600" />}
          label="Reprovados"
          value={stats.reprovados}
          color="bg-red-50 border-red-200"
        />
        <StatCard
          icon={<Clock className="w-5 h-5 text-amber-600" />}
          label="Pendentes"
          value={stats.pendentes}
          color="bg-amber-50 border-amber-200"
        />
      </div>

      {/* Barra de aprovação */}
      <div className="bg-white border border-neutral-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-neutral-700">Taxa de Aprovação</h3>
          <span className="text-lg font-bold text-primary-700">{approvalRate}%</span>
        </div>
        <div className="w-full h-3 bg-neutral-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-400 to-green-500 rounded-full transition-all duration-500"
            style={{ width: `${approvalRate}%` }}
          />
        </div>
        <p className="text-xs text-neutral-400 mt-2">
          Baseado em {stats.aprovados + stats.reprovados} respostas avaliadas
          ({stats.pendentes} ainda pendentes)
        </p>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
}) {
  return (
    <div className={`border rounded-lg p-4 ${color}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-neutral-600">{label}</span>
      </div>
      <p className="text-2xl font-bold text-neutral-800">{value}</p>
    </div>
  )
}
