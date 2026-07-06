/**
 * Lista de pareceres registrados (histórico) com indicadores visuais de status.
 */

import { CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react'
import type { Parecer } from '@tesouro-nacional/shared'

interface ParecerListProps {
  pareceres: Parecer[]
  loading: boolean
  onSelect: (parecer: Parecer) => void
}

const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  aprovado: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', label: 'Aprovado' },
  reprovado: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Reprovado' },
  pendente: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Pendente' },
}

export function ParecerList({ pareceres, loading, onSelect }: ParecerListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-neutral-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Carregando…
      </div>
    )
  }

  if (pareceres.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-neutral-400 text-sm">
        <p>Nenhum parecer encontrado.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {pareceres.map((parecer) => {
        const config = statusConfig[parecer.status] || statusConfig.pendente
        const Icon = config.icon

        return (
          <button
            key={parecer.id}
            onClick={() => onSelect(parecer)}
            className="w-full text-left p-3 rounded-lg border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className={`flex-shrink-0 w-7 h-7 rounded-full ${config.bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${config.color}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                  <span className="text-[11px] text-neutral-400">
                    {new Date(parecer.createdAt).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="text-[11px] text-neutral-400 ml-auto">
                    por {parecer.reviewerName}
                  </span>
                </div>

                <p className="text-xs text-neutral-500 truncate mb-1">
                  Pergunta: {parecer.pergunta.slice(0, 120)}
                </p>
                <p className="text-xs text-neutral-700 line-clamp-2">
                  {parecer.resposta.slice(0, 200)}
                </p>

                {parecer.tags && parecer.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {parecer.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500"
                      >
                        {tag}
                      </span>
                    ))}
                    {parecer.tags.length > 4 && (
                      <span className="text-[10px] text-neutral-400">
                        +{parecer.tags.length - 4}
                      </span>
                    )}
                  </div>
                )}

                {parecer.motivo && (
                  <p className="text-[11px] text-red-500 mt-1 truncate">
                    Motivo: {parecer.motivo}
                  </p>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
