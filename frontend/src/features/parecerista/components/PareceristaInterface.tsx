/**
 * Modo Parecerista — Interface principal
 *
 * Layout dividido: lista de respostas a avaliar à esquerda,
 * painel de avaliação com trace expandido à direita.
 */

import { useState, useEffect, useCallback } from 'react'
import { ClipboardCheck, Filter, BarChart3, FileDown } from 'lucide-react'
import { api } from '@/src/shared/services/api'
import type { Parecer, ParecerStatus, Message } from '@tesouro-nacional/shared'
import { ParecerForm } from './ParecerForm'
import { ParecerList } from './ParecerList'
import { ParecerStats } from './ParecerStats'

type ViewMode = 'avaliar' | 'historico' | 'stats'

export function PareceristaInterface() {
  const [viewMode, setViewMode] = useState<ViewMode>('avaliar')
  const [pareceres, setPareceres] = useState<Parecer[]>([])
  const [filterStatus, setFilterStatus] = useState<ParecerStatus | 'todos'>('todos')
  const [loading, setLoading] = useState(false)

  // Estado para nova avaliação (buscar mensagens de um chat)
  const [chatId, setChatId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)

  const fetchPareceres = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterStatus !== 'todos' ? `?status=${filterStatus}` : ''
      const data = await api.get<Parecer[]>(`/api/pareceres${params}`)
      setPareceres(data)
    } catch (err) {
      console.error('Erro ao buscar pareceres:', err)
    } finally {
      setLoading(false)
    }
  }, [filterStatus])

  useEffect(() => {
    if (viewMode === 'historico') {
      fetchPareceres()
    }
  }, [viewMode, fetchPareceres])

  const handleLoadChat = async () => {
    if (!chatId.trim()) return
    try {
      const msgs = await api.get<Message[]>(`/api/chats/${chatId}/messages`)
      setMessages(msgs)
      setSelectedMessage(null)
    } catch (err) {
      console.error('Erro ao carregar mensagens:', err)
      setMessages([])
    }
  }

  const handleParecerCreated = () => {
    setSelectedMessage(null)
    setMessages([])
    setChatId('')
    if (viewMode === 'historico') fetchPareceres()
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header com tabs */}
      <div className="flex items-center gap-4 pb-4 border-b border-neutral-200 mb-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-primary-600" />
          <h2 className="text-lg font-semibold text-neutral-800">Modo Parecerista</h2>
        </div>

        <div className="flex gap-1 ml-auto bg-neutral-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('avaliar')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'avaliar'
                ? 'bg-white text-primary-700 shadow-sm'
                : 'text-neutral-600 hover:text-neutral-800'
            }`}
          >
            Nova Avaliação
          </button>
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
            Estatísticas
          </button>
        </div>
      </div>

      {/* Conteúdo baseado na tab ativa */}
      {viewMode === 'avaliar' && (
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          {/* Seletor de chat */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-neutral-500 mb-1 block">ID do Chat para avaliar</label>
              <input
                type="text"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="Cole o ID do chat (ex: chat_1719...)"
                className="input-field w-full text-sm"
              />
            </div>
            <button
              onClick={handleLoadChat}
              disabled={!chatId.trim()}
              className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
            >
              Carregar
            </button>
          </div>

          {/* Mensagens do chat carregado */}
          {messages.length > 0 && (
            <div className="flex-1 flex gap-4 overflow-hidden">
              {/* Lista de mensagens (lado esquerdo) */}
              <div className="w-1/2 overflow-y-auto border border-neutral-200 rounded-lg p-3 space-y-2">
                <p className="text-xs text-neutral-500 font-medium mb-2">
                  Selecione uma resposta do assistente para avaliar:
                </p>
                {messages
                  .filter((m) => m.role === 'assistant')
                  .map((msg, idx) => {
                    const userMsg = messages
                      .slice(0, messages.indexOf(msg))
                      .reverse()
                      .find((m) => m.role === 'user')

                    return (
                      <button
                        key={msg.id || idx}
                        onClick={() => setSelectedMessage(msg)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          selectedMessage?.id === msg.id
                            ? 'border-primary-300 bg-primary-50'
                            : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                        }`}
                      >
                        {userMsg && (
                          <p className="text-[11px] text-neutral-400 mb-1 truncate">
                            Pergunta: {userMsg.content.slice(0, 100)}
                          </p>
                        )}
                        <p className="text-xs text-neutral-700 line-clamp-3">
                          {msg.content.slice(0, 200)}…
                        </p>
                      </button>
                    )
                  })}
              </div>

              {/* Formulário de avaliação (lado direito) */}
              <div className="w-1/2 overflow-y-auto">
                {selectedMessage ? (
                  <ParecerForm
                    chatId={chatId}
                    message={selectedMessage}
                    pergunta={
                      messages
                        .slice(0, messages.indexOf(selectedMessage))
                        .reverse()
                        .find((m) => m.role === 'user')?.content || ''
                    }
                    onCreated={handleParecerCreated}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-neutral-400 text-sm">
                    Selecione uma resposta para avaliar
                  </div>
                )}
              </div>
            </div>
          )}

          {messages.length === 0 && chatId && (
            <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
              Nenhuma mensagem encontrada. Verifique o ID do chat.
            </div>
          )}

          {!chatId && (
            <div className="flex-1 flex flex-col items-center justify-center text-neutral-400 text-sm gap-2">
              <ClipboardCheck className="w-10 h-10 text-neutral-300" />
              <p>Insira o ID de um chat para começar a avaliar as respostas.</p>
              <p className="text-xs">
                Você pode copiar o ID do chat na seção de histórico de conversas.
              </p>
            </div>
          )}
        </div>
      )}

      {viewMode === 'historico' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Filtros */}
          <div className="flex items-center gap-3 mb-3">
            <Filter className="w-4 h-4 text-neutral-400" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as ParecerStatus | 'todos')}
              className="text-xs border border-neutral-200 rounded-md px-2 py-1.5 bg-white"
            >
              <option value="todos">Todos</option>
              <option value="aprovado">Aprovados</option>
              <option value="reprovado">Reprovados</option>
              <option value="pendente">Pendentes</option>
            </select>

            <button
              onClick={fetchPareceres}
              className="ml-auto text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              Atualizar
            </button>

            <button
              onClick={() => exportCSV(pareceres)}
              disabled={pareceres.length === 0}
              className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-800 disabled:opacity-40"
            >
              <FileDown className="w-3.5 h-3.5" />
              Exportar CSV
            </button>
          </div>

          {/* Lista de pareceres */}
          <div className="flex-1 overflow-y-auto">
            <ParecerList
              pareceres={pareceres}
              loading={loading}
              onSelect={() => {}}
            />
          </div>
        </div>
      )}

      {viewMode === 'stats' && <ParecerStats />}
    </div>
  )
}

// ─── Utilidade: exportar CSV ─────────────────────────────────────────────────
function exportCSV(pareceres: Parecer[]) {
  const headers = ['ID', 'Status', 'Parecerista', 'Pergunta', 'Motivo', 'Anotações', 'Tags', 'Data']
  const rows = pareceres.map((p) => [
    p.id,
    p.status,
    p.reviewerName,
    `"${p.pergunta.replace(/"/g, '""')}"`,
    `"${(p.motivo || '').replace(/"/g, '""')}"`,
    `"${(p.anotacoes || '').replace(/"/g, '""')}"`,
    (p.tags || []).join('; '),
    p.createdAt,
  ])

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pareceres_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
