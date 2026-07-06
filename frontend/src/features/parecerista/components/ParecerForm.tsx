/**
 * Formulário de avaliação de uma resposta do agente (Modo Parecerista)
 *
 * Permite: aprovar, reprovar (com motivo obrigatório), anotar observações,
 * adicionar tags e visualizar o trace completo da resposta.
 */

import { useState } from 'react'
import { CheckCircle2, XCircle, Clock, Tag, Send } from 'lucide-react'
import { api } from '@/src/shared/services/api'
import { TracePanel } from '@/src/features/chat/components/TracePanel'
import type { Message, ParecerStatus } from '@tesouro-nacional/shared'

interface ParecerFormProps {
  chatId: string
  message: Message
  pergunta: string
  onCreated: () => void
}

const TAGS_DISPONIVEIS = [
  'Dados corretos',
  'Dados parciais',
  'Dados incorretos',
  'Cálculo correto',
  'Cálculo incorreto',
  'Fonte citada',
  'Sem fonte',
  'Resposta completa',
  'Resposta incompleta',
  'Fora de escopo',
  'Alucinação',
  'Formato adequado',
]

export function ParecerForm({ chatId, message, pergunta, onCreated }: ParecerFormProps) {
  const [status, setStatus] = useState<ParecerStatus | null>(null)
  const [motivo, setMotivo] = useState('')
  const [anotacoes, setAnotacoes] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const handleSubmit = async () => {
    if (!status) {
      setError('Selecione um status (Aprovar, Reprovar ou Pendente).')
      return
    }
    if (status === 'reprovado' && !motivo.trim()) {
      setError('Motivo é obrigatório para reprovação.')
      return
    }

    setError('')
    setSubmitting(true)

    try {
      await api.post('/api/pareceres', {
        chatId,
        messageId: message.id,
        status,
        motivo: motivo.trim() || undefined,
        anotacoes: anotacoes.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        pergunta,
        resposta: message.content,
        trace: message.trace,
      })
      onCreated()
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar parecer.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border border-neutral-200 rounded-lg p-4 space-y-4">
      {/* Resposta sendo avaliada */}
      <div>
        <h3 className="text-xs font-semibold text-neutral-500 uppercase mb-2">Resposta do Agente</h3>
        <div className="bg-neutral-50 rounded-lg p-3 max-h-48 overflow-y-auto">
          <p className="text-xs text-neutral-400 mb-1">Pergunta: {pergunta.slice(0, 150)}</p>
          <p className="text-sm text-neutral-700 whitespace-pre-wrap">
            {message.content.slice(0, 800)}
            {message.content.length > 800 && '…'}
          </p>
        </div>
        {message.trace && message.trace.length > 0 && (
          <TracePanel trace={message.trace} />
        )}
      </div>

      {/* Botões de status */}
      <div>
        <h3 className="text-xs font-semibold text-neutral-500 uppercase mb-2">Avaliação</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setStatus('aprovado')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border transition-colors ${
              status === 'aprovado'
                ? 'bg-green-50 border-green-300 text-green-700 font-medium'
                : 'border-neutral-200 text-neutral-600 hover:border-green-200 hover:bg-green-50'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            Aprovar
          </button>
          <button
            onClick={() => setStatus('reprovado')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border transition-colors ${
              status === 'reprovado'
                ? 'bg-red-50 border-red-300 text-red-700 font-medium'
                : 'border-neutral-200 text-neutral-600 hover:border-red-200 hover:bg-red-50'
            }`}
          >
            <XCircle className="w-4 h-4" />
            Reprovar
          </button>
          <button
            onClick={() => setStatus('pendente')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border transition-colors ${
              status === 'pendente'
                ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium'
                : 'border-neutral-200 text-neutral-600 hover:border-amber-200 hover:bg-amber-50'
            }`}
          >
            <Clock className="w-4 h-4" />
            Pendente
          </button>
        </div>
      </div>

      {/* Motivo (obrigatório para reprovação) */}
      {status === 'reprovado' && (
        <div>
          <label className="text-xs font-semibold text-neutral-500 uppercase block mb-1">
            Motivo da reprovação *
          </label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Descreva por que esta resposta foi reprovada…"
            rows={3}
            className="input-field w-full text-sm resize-none"
          />
        </div>
      )}

      {/* Tags */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Tag className="w-3.5 h-3.5 text-neutral-400" />
          <h3 className="text-xs font-semibold text-neutral-500 uppercase">Tags</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TAGS_DISPONIVEIS.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
                tags.includes(tag)
                  ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
                  : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Anotações */}
      <div>
        <label className="text-xs font-semibold text-neutral-500 uppercase block mb-1">
          Anotações (opcional)
        </label>
        <textarea
          value={anotacoes}
          onChange={(e) => setAnotacoes(e.target.value)}
          placeholder="Observações adicionais sobre esta resposta…"
          rows={3}
          className="input-field w-full text-sm resize-none"
        />
      </div>

      {/* Erro */}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {/* Botão enviar */}
      <button
        onClick={handleSubmit}
        disabled={!status || submitting}
        className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Send className="w-4 h-4" />
        {submitting ? 'Salvando…' : 'Registrar Parecer'}
      </button>
    </div>
  )
}
