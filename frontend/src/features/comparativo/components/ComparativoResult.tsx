/**
 * Exibe respostas de múltiplos agentes lado a lado para votação A/B.
 */

import { Trophy, Timer, Coins, CheckCircle2, Equal } from 'lucide-react'
import { TracePanel } from '@/src/features/chat/components/TracePanel'

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
  createdAt: string
}

interface ComparativoResultProps {
  comparativo: Comparativo
  onVote: (voto: string) => void
}

export function ComparativoResult({ comparativo, onVote }: ComparativoResultProps) {
  const { respostas, voto, pergunta } = comparativo
  const cols = respostas.length <= 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'

  return (
    <div className="space-y-4">
      {/* Pergunta */}
      <div className="bg-neutral-50 rounded-lg px-4 py-3 border border-neutral-200">
        <p className="text-xs text-neutral-500 mb-1">Pergunta enviada:</p>
        <p className="text-sm text-neutral-800">{pergunta}</p>
      </div>

      {/* Respostas side by side */}
      <div className={`grid ${cols} gap-4`}>
        {respostas.map((resp) => {
          const isWinner = voto === resp.agentId
          const isEmpate = voto === 'empate'

          return (
            <div
              key={resp.agentId}
              className={`border rounded-lg overflow-hidden transition-colors ${
                isWinner
                  ? 'border-green-300 bg-green-50/30'
                  : isEmpate && voto
                  ? 'border-amber-200 bg-amber-50/20'
                  : 'border-neutral-200'
              }`}
            >
              {/* Header do agente */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-100 bg-white">
                <div className="flex items-center gap-2">
                  {isWinner && <Trophy className="w-4 h-4 text-green-600" />}
                  <span className="text-sm font-medium text-neutral-800">
                    {resp.agentName}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-neutral-400">
                  {resp.latencyMs && (
                    <span className="flex items-center gap-0.5">
                      <Timer className="w-3 h-3" />
                      {(resp.latencyMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  {(resp.inputTokens || resp.outputTokens) && (
                    <span className="flex items-center gap-0.5">
                      <Coins className="w-3 h-3" />
                      {(resp.inputTokens || 0) + (resp.outputTokens || 0)} tokens
                    </span>
                  )}
                </div>
              </div>

              {/* Resposta */}
              <div className="px-3 py-3 max-h-80 overflow-y-auto">
                <p className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">
                  {resp.response}
                </p>
              </div>

              {/* Trace (se disponível) */}
              {resp.trace && resp.trace.length > 0 && (
                <div className="px-3 pb-3">
                  <TracePanel trace={resp.trace} />
                </div>
              )}

              {/* Botão de voto */}
              {!voto && (
                <div className="px-3 py-2 border-t border-neutral-100 bg-neutral-50">
                  <button
                    onClick={() => onVote(resp.agentId)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-md transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Esta resposta é melhor
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Botão de empate */}
      {!voto && (
        <div className="flex justify-center">
          <button
            onClick={() => onVote('empate')}
            className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-600 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors"
          >
            <Equal className="w-4 h-4" />
            Empate — respostas equivalentes
          </button>
        </div>
      )}

      {/* Voto registrado */}
      {voto && (
        <div className="flex items-center justify-center gap-2 text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <CheckCircle2 className="w-4 h-4" />
          <span>
            Voto registrado:{' '}
            {voto === 'empate'
              ? 'Empate'
              : respostas.find((r) => r.agentId === voto)?.agentName || voto}
          </span>
        </div>
      )}
    </div>
  )
}
