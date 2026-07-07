/**
 * Modo Comparativo — Interface principal
 *
 * Envia a mesma pergunta para múltiplos agentes em paralelo e exibe
 * respostas lado a lado para avaliação A/B.
 */

import { useState, useEffect } from 'react'
import { GitCompare, Send, Loader2, BarChart3 } from 'lucide-react'
import { api } from '@/src/shared/services/api'
import { useAuth } from '@/src/shared/contexts/AuthContext'
import { ComparativoResult } from './ComparativoResult'
import { ComparativoStats } from './ComparativoStats'
import { ComparativoHistory } from './ComparativoHistory'

interface AgentOption {
  id: string
  name: string
  description?: string
  isDefault: boolean
}

interface ComparativoResposta {
  agentId: string
  agentName: string
  response: string
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  trace?: any[]
}

interface Comparativo {
  id: string
  pergunta: string
  respostas: ComparativoResposta[]
  voto?: string
  voterId: string
  voterName: string
  createdAt: string
}

type ViewMode = 'comparar' | 'historico' | 'stats'

export function ComparativoInterface() {
  const [viewMode, setViewMode] = useState<ViewMode>('comparar')
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Comparativo | null>(null)
  const [error, setError] = useState('')
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // Carregar agentes disponíveis
  useEffect(() => {
    api.get<AgentOption[]>('/api/agents')
      .then((data) => {
        setAgents(data)
        // Pré-selecionar os 2 primeiros
        if (data.length >= 2) {
          setSelectedAgentIds([data[0].id, data[1].id])
        }
      })
      .catch(() => {})
  }, [])

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 4) return prev // máximo 4
      return [...prev, id]
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || selectedAgentIds.length < 2 || loading) return

    setError('')
    setLoading(true)
    setResult(null)

    try {
      const data = await api.post<Comparativo>('/api/comparativos/invoke', {
        message: message.trim(),
        agentIds: selectedAgentIds,
      })
      setResult(data)
    } catch (err: any) {
      setError(err.message || 'Erro ao executar comparação.')
    } finally {
      setLoading(false)
    }
  }

  const handleVote = async (voto: string) => {
    if (!result) return
    try {
      const updated = await api.post<Comparativo>(`/api/comparativos/${result.id}/vote`, { voto })
      setResult(updated)
    } catch (err: any) {
      console.error('Erro ao votar:', err)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 pb-4 border-b border-neutral-200 mb-4">
        <div className="flex items-center gap-2">
          <GitCompare className="w-5 h-5 text-primary-600" />
          <h2 className="text-lg font-semibold text-neutral-800">Modo Comparativo</h2>
        </div>

        <div className="flex gap-1 ml-auto bg-neutral-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('comparar')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'comparar'
                ? 'bg-white text-primary-700 shadow-sm'
                : 'text-neutral-600 hover:text-neutral-800'
            }`}
          >
            Nova Comparação
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => setViewMode('historico')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'historico'
                    ? 'bg-white text-primary-700 shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-800'
                }`}
              >
                Histórico
              </button>
              <button
                onClick={() => setViewMode('stats')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'stats'
                    ? 'bg-white text-primary-700 shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-800'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 inline mr-1" />
                Métricas
              </button>
            </>
          )}
        </div>
      </div>

      {viewMode === 'comparar' && (
        <div className="flex-1 flex flex-col overflow-hidden gap-4">
          {/* Seleção de agentes */}
          <div>
            <p className="text-xs text-neutral-500 mb-2">
              Selecione 2 a 4 agentes para comparar ({selectedAgentIds.length} selecionado{selectedAgentIds.length !== 1 ? 's' : ''}):
            </p>
            <div className="flex flex-wrap gap-2">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => toggleAgent(agent.id)}
                  disabled={loading}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    selectedAgentIds.includes(agent.id)
                      ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
                      : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                  } disabled:opacity-50`}
                >
                  {agent.name}
                  {agent.isDefault && <span className="ml-1 text-neutral-400">(padrão)</span>}
                </button>
              ))}
              {agents.length < 2 && (
                <p className="text-xs text-amber-500">
                  Cadastre pelo menos 2 agentes nas Configurações para usar o modo comparativo.
                </p>
              )}
            </div>
          </div>

          {/* Campo de pergunta */}
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <div className="flex-1 relative">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (message.trim() && selectedAgentIds.length >= 2 && !loading) handleSubmit(e)
                  }
                }}
                placeholder="Digite a pergunta para enviar aos agentes selecionados…"
                className="input-field w-full min-h-[42px] max-h-[120px] resize-none pr-4 text-sm"
                rows={2}
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={!message.trim() || selectedAgentIds.length < 2 || loading}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed h-[42px]"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              Comparar
            </button>
          </form>

          {/* Erro */}
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto mb-2" />
                <p className="text-sm text-neutral-600">
                  Invocando {selectedAgentIds.length} agentes em paralelo…
                </p>
                <p className="text-xs text-neutral-400 mt-1">Isso pode levar alguns segundos</p>
              </div>
            </div>
          )}

          {/* Resultado */}
          {result && !loading && (
            <div className="flex-1 overflow-y-auto">
              <ComparativoResult comparativo={result} onVote={handleVote} />
            </div>
          )}

          {/* Estado vazio */}
          {!result && !loading && !error && (
            <div className="flex-1 flex flex-col items-center justify-center text-neutral-400 text-sm gap-2">
              <GitCompare className="w-10 h-10 text-neutral-300" />
              <p>Selecione agentes e envie uma pergunta para comparar respostas.</p>
            </div>
          )}
        </div>
      )}

      {viewMode === 'historico' && <ComparativoHistory />}
      {viewMode === 'stats' && <ComparativoStats />}
    </div>
  )
}
