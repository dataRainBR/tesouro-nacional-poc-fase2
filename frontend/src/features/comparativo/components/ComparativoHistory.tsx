/**
 * Histórico de comparações realizadas.
 */

import { useState, useEffect } from 'react'
import { Loader2, Trophy, Equal, GitCompare } from 'lucide-react'
import { api } from '@/src/shared/services/api'

interface ComparativoResposta {
  agentId: string
  agentName: string
  response: string
  latencyMs?: number
}

interface Comparativo {
  id: string
  pergunta: string
  respostas: ComparativoResposta[]
  voto?: string
  voterName: string
  createdAt: string
}

export function ComparativoHistory() {
  const [items, setItems] = useState<Comparativo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<Comparativo[]>('/api/comparativos')
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-neutral-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Carregando histórico…
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-neutral-400 text-sm gap-2">
        <GitCompare className="w-8 h-8 text-neutral-300" />
        <p>Nenhuma comparação realizada ainda.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-2">
      {items.map((comp) => {
        const winner = comp.voto && comp.voto !== 'empate'
          ? comp.respostas.find((r) => r.agentId === comp.voto)
          : null

        return (
          <div
            key={comp.id}
            className="p-3 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-neutral-700 font-medium truncate mb-1">
                  {comp.pergunta}
                </p>
                <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                  <span>
                    {comp.respostas.map((r) => r.agentName).join(' vs ')}
                  </span>
                  <span>•</span>
                  <span>
                    {new Date(comp.createdAt).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              <div className="flex-shrink-0">
                {comp.voto ? (
                  comp.voto === 'empate' ? (
                    <span className="flex items-center gap-1 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                      <Equal className="w-3 h-3" />
                      Empate
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] text-green-600 bg-green-50 border border-green-200 rounded px-2 py-0.5">
                      <Trophy className="w-3 h-3" />
                      {winner?.agentName || 'Vencedor'}
                    </span>
                  )
                ) : (
                  <span className="text-[11px] text-neutral-400 bg-neutral-100 rounded px-2 py-0.5">
                    Sem voto
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
