'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Loader2, ChevronDown, ThumbsDown, X } from 'lucide-react'
import { MessageBubble } from './MessageBubble'
import type { Message } from '@tesouro-nacional/shared'
import { api } from '@/src/shared/services/api'

interface AgentOption {
  id: string
  name: string
  description?: string
  isDefault: boolean
}

interface ChatInterfaceProps {
  chatId: string | null
}

// ── Estado global: quais chatIds estão processando (para sidebar) ──
const loadingChats = new Set<string>()
const listeners = new Set<() => void>()

function notify() { listeners.forEach((fn) => fn()) }

export function isChatLoading(cid: string | null): boolean {
  return cid ? loadingChats.has(cid) : false
}

export function onLoadingChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function ChatInterface({ chatId }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false) // loading LOCAL desta instância
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [dislikeModal, setDislikeModal] = useState<{ messageId: string; reasons: string[]; comment: string } | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const currentChatRef = useRef<string | null>(chatId)

  currentChatRef.current = chatId

  // Ao trocar de chat: verificar se o novo chat tem loading pendente
  useEffect(() => {
    setThinking(isChatLoading(chatId))
    if (chatId) {
      fetchMessages(chatId)
    } else {
      setMessages([])
    }
  }, [chatId])

  // Escutar mudanças globais de loading (para quando resposta chega em background)
  useEffect(() => {
    return onLoadingChange(() => {
      // Se o chat atual parou de carregar, atualizar
      const stillLoading = isChatLoading(currentChatRef.current)
      setThinking(stillLoading)
      // Se parou de carregar, recarregar mensagens (resposta chegou)
      if (!stillLoading && currentChatRef.current) {
        fetchMessages(currentChatRef.current)
      }
    })
  }, [])

  // Auto-scroll
  useEffect(() => {
    const el = messagesContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, thinking])

  // Carregar agentes
  useEffect(() => {
    api.get<AgentOption[]>('/api/agents')
      .then((data: AgentOption[]) => {
        setAgents(data)
        const def = data.find((a: AgentOption) => a.isDefault) ?? data[0]
        if (def) setSelectedAgentId(def.id)
      })
      .catch(() => {})
  }, [])

  const fetchMessages = useCallback(async (cid: string) => {
    try {
      const data = await api.get<Message[]>(`/api/chats/${cid}/messages`)
      // Só atualizar se ainda estamos neste chat
      if (currentChatRef.current === cid) {
        setMessages(data)
      }
    } catch (error) {
      console.error('Erro ao buscar mensagens:', error)
    }
  }, [])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || thinking) return

    const sendChatId = chatId
    const currentInput = input

    const userMessage: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      chatId: sendChatId || '',
      role: 'user',
      content: currentInput,
      timestamp: new Date().toISOString(),
    }

    // 1. Mostrar loading IMEDIATAMENTE (síncrono, antes de qualquer await)
    setThinking(true)
    setMessages((prev) => [...prev, userMessage])
    setInput('')

    // 2. Registrar no global (para sidebar) — se temos chatId
    if (sendChatId) {
      loadingChats.add(sendChatId)
      notify()
    }

    try {
      const data = await api.post<{ chatId: string; messageId: string; response: string }>(
        '/api/chat',
        {
          chatId: sendChatId || undefined,
          message: currentInput,
          agentId: selectedAgentId || undefined,
        }
      )

      const resolvedChatId = data.chatId || sendChatId || ''

      // Novo chat criado — registrar no global e notificar sidebar
      if (!sendChatId && data.chatId) {
        loadingChats.add(resolvedChatId)
        window.dispatchEvent(new CustomEvent('chatCreated', { detail: { chatId: data.chatId } }))
      }

      // 3. Remover loading global
      loadingChats.delete(resolvedChatId)
      notify()

      // 4. Se o usuário ainda está neste chat, atualizar UI
      const viewingThis = currentChatRef.current === resolvedChatId
        || currentChatRef.current === sendChatId
        || currentChatRef.current === null

      if (viewingThis) {
        setThinking(false)
        await fetchMessages(resolvedChatId)
        // Atualizar sidebar após delay (title-summarizer roda em paralelo)
        setTimeout(() => window.dispatchEvent(new CustomEvent('chatTitleUpdated')), 2000)
      }
    } catch (error: any) {
      // Limpar loading global
      if (sendChatId) loadingChats.delete(sendChatId)
      notify()

      const viewingThis = currentChatRef.current === sendChatId || currentChatRef.current === null

      if (viewingThis) {
        setThinking(false)
        setMessages((prev) => [...prev, {
          id: `error-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          chatId: sendChatId || '',
          role: 'assistant',
          content: `Desculpe, ocorreu um erro:\n\n${error.message || 'Erro desconhecido'}`,
          timestamp: new Date().toISOString(),
        }])
      }
    }
  }

  // Editar uma mensagem do usuário: deleta do banco tudo a partir dela e reenvia
  const handleEdit = async (message: Message, messageIndex: number, newContent: string) => {
    if (thinking) return

    // Se o chat existe no backend, deletar mensagens a partir desta (inclusive)
    if (chatId && message.timestamp) {
      try {
        await api.post(`/api/chats/${chatId}/delete-messages-after`, {
          afterTimestamp: message.timestamp,
        })
      } catch (error) {
        console.error('Erro ao deletar mensagens anteriores:', error)
      }
    }

    // Remover mensagens a partir desta (inclusive) na UI
    setMessages((prev) => prev.slice(0, messageIndex))

    // Reenviar com o novo conteúdo
    setInput(newContent)
    setTimeout(() => {
      const form = document.querySelector('form') as HTMLFormElement
      if (form) form.requestSubmit()
    }, 0)
  }

  // Retry: encontra a última mensagem do user antes do erro e reenvia
  const handleRetry = (errorIndex: number) => {
    if (thinking) return

    // Encontrar a última mensagem do user antes do erro
    let lastUserMsg: Message | null = null
    for (let i = errorIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMsg = messages[i]
        break
      }
    }

    if (!lastUserMsg) return

    // Remover a mensagem de erro
    setMessages((prev) => prev.filter((_, i) => i !== errorIndex))

    // Reenviar a mensagem
    setInput(lastUserMsg.content)
    setTimeout(() => {
      const form = document.querySelector('form') as HTMLFormElement
      if (form) form.requestSubmit()
    }, 0)
  }

  const handleFeedback = async (messageId: string, feedback: 'like' | 'dislike') => {
    if (feedback === 'dislike') {
      setDislikeModal({ messageId, reasons: [], comment: '' })
      return
    }
    await sendFeedback(messageId, 'like')
  }

  const sendFeedback = async (messageId: string, feedback: 'like' | 'dislike', comment?: string) => {
    if (!chatId) return
    try {
      await api.post(`/api/messages/${messageId}/feedback`, { chatId, feedback, comment })
      setMessages((prev) => prev.map((msg) => (msg.id === messageId ? { ...msg, feedback } : msg)))
    } catch (error) {
      console.error('Erro ao enviar feedback:', error)
    }
  }

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)

  return (
    <>
    {dislikeModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
                <ThumbsDown className="w-4 h-4 text-red-500" />
              </div>
              <h3 className="text-sm font-semibold text-neutral-800">O que houve de errado?</h3>
            </div>
            <button onClick={() => setDislikeModal(null)} className="text-neutral-400 hover:text-neutral-600 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-neutral-500 mb-3">Selecione o(s) motivo(s):</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {['Resposta errada', 'Informação imprecisa', 'Cálculo incorreto', 'Fora de contexto', 'Formato inadequado', 'Outro'].map((reason) => (
              <button
                key={reason}
                onClick={() => setDislikeModal((m) => m ? {
                  ...m,
                  reasons: m.reasons.includes(reason)
                    ? m.reasons.filter(r => r !== reason)
                    : [...m.reasons, reason]
                } : null)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  dislikeModal.reasons.includes(reason)
                    ? 'bg-red-50 border-red-300 text-red-700 font-medium'
                    : 'border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                {reason}
              </button>
            ))}
          </div>

          <p className="text-xs text-neutral-500 mb-2">
            Comentário {dislikeModal.reasons.includes('Outro') ? '(obrigatório)' : '(opcional)'}:
          </p>
          <textarea
            rows={3}
            value={dislikeModal.comment}
            onChange={(e) => setDislikeModal((m) => m ? { ...m, comment: e.target.value } : null)}
            placeholder="Descreva o problema com mais detalhes…"
            className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300 resize-none"
          />

          <div className="flex items-center justify-end gap-2 mt-4">
            <button onClick={() => setDislikeModal(null)} className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors">Cancelar</button>
            <button
              disabled={dislikeModal.reasons.length === 0 || (dislikeModal.reasons.includes('Outro') && !dislikeModal.comment.trim())}
              onClick={async () => {
                const { messageId, reasons, comment } = dislikeModal
                setDislikeModal(null)
                await sendFeedback(messageId, 'dislike', [reasons.join(', '), comment].filter(Boolean).join(' — '))
              }}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ThumbsDown className="w-4 h-4" /> Confirmar
            </button>
          </div>
        </div>
      </div>
    )}
    <div className="card h-[calc(100vh-12rem)] flex flex-col">
      {agents.length > 0 && (
        <div className="flex items-center gap-2 pb-3 border-b border-neutral-100 mb-3">
          <span className="text-xs text-neutral-500 flex-shrink-0">Agente:</span>
          {agents.length === 1 ? (
            <span className="text-xs font-medium text-neutral-700">
              {agents[0].name}{agents[0].isDefault && <span className="ml-1 text-neutral-400">(padrão)</span>}
            </span>
          ) : (
            <div className="relative">
              <select value={selectedAgentId || ''} onChange={(e) => setSelectedAgentId(e.target.value)}
                className="appearance-none pl-2 pr-7 py-1 text-xs border border-neutral-200 rounded bg-white text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer">
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}{agent.isDefault ? ' (padrão)' : ''}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-neutral-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
          {selectedAgent?.description && (
            <span className="text-xs text-neutral-400 truncate hidden sm:block">{selectedAgent.description}</span>
          )}
        </div>
      )}

      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
        {messages.length === 0 && !thinking ? (
          <div className="flex flex-col items-center justify-start h-full py-4 px-4 overflow-y-auto">
            <p className="text-primary-500 text-sm font-medium mb-1">Olá! Eu sou o</p>
            <h2 className="text-2xl font-bold text-primary-600 mb-6">Assistente Digital Fiscal</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl mb-4">
              <div>
                <h3 className="text-sm font-semibold text-neutral-700 mb-3">Exemplos</h3>
                <div className="space-y-2">
                  {[
                    'Qual foi o Resultado Primário do Governo Central em 2024 comparado a 2023?',
                    'Mostre a evolução mensal da Receita Líquida em 2025 a preços de dez/25.',
                    'Quanto foi gasto com Benefícios Previdenciários no acumulado de janeiro a agosto de 2024?',
                  ].map((text, i) => (
                    <button key={i} onClick={() => setInput(text)}
                      className="w-full text-left text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-4 py-3 hover:bg-primary-50 hover:border-primary-200 transition-colors">
                      {text}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-neutral-700 mb-3">Capacidades</h3>
                <div className="space-y-2">
                  {[
                    'Consulta a série histórica completa do Resultado do Tesouro Nacional (1997–2025) com dados de receitas, despesas e indicadores fiscais.',
                    'Realiza cálculos de deflação pelo IPCA, agregações por período e comparações entre exercícios.',
                    'Acessa documentos oficiais (Apresentações, Boletins e Relatórios) para análises qualitativas e metodológicas.',
                  ].map((text, i) => (
                    <div key={i} className="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-4 py-3">
                      {text}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-neutral-700 mb-3">Limitações</h3>
                <div className="space-y-2">
                  {[
                    'Pode apresentar valores imprecisos ou incompletos — sempre confira com as publicações oficiais da STN.',
                    'Os dados fiscais cobrem até agosto/2025 e o IPCA até março/2026. Períodos fora dessa janela não estão disponíveis.',
                    'Não substitui análises técnicas, pareceres contábeis ou interpretações oficiais do Tesouro Nacional.',
                  ].map((text, i) => (
                    <div key={i} className="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-4 py-3">
                      {text}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {agents.length === 0 && (
              <p className="text-xs text-amber-500 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Nenhum agente configurado. Um administrador precisa cadastrar um agente em Configurações.
              </p>
            )}
          </div>
        ) : (
          messages.map((message, index) => {
            const isLastUser = message.role === 'user' && messages.slice(index + 1).every((m: Message) => m.role !== 'user')
            return (
              <MessageBubble
                key={message.id || `msg-${index}`}
                message={message}
                onCopy={() => navigator.clipboard.writeText(message.content)}
                onFeedback={(feedback) => handleFeedback(message.id, feedback)}
                onEdit={message.role === 'user' && !thinking ? (newContent) => handleEdit(message, index, newContent) : undefined}
                onRetry={message.role === 'assistant' && message.content.startsWith('Desculpe, ocorreu um erro') && !thinking ? () => handleRetry(index) : undefined}
                isLastUserMessage={isLastUser}
              />
            )
          })
        )}
        {thinking && (
          <div className="flex items-center gap-2 text-neutral-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Pensando...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="flex gap-2 items-end">
        <div className="flex-1 relative">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.length <= 2000) handleSend(e) } }}
            placeholder="Digite sua pergunta..."
            className={`input-field w-full min-h-[42px] max-h-[200px] resize-none overflow-y-auto pr-16 ${input.length > 2000 ? 'border-error focus:ring-error' : ''}`}
            rows={1}
            disabled={thinking}
            style={{ height: `${Math.min(200, Math.max(42, (input.split('\n').length) * 24 + 18))}px` }}
          />
          {input.length > 1500 && (
            <span className={`absolute right-2 bottom-2 text-[10px] ${input.length > 2000 ? 'text-error font-medium' : 'text-neutral-400'}`}>
              {input.length}/2000
            </span>
          )}
        </div>
        <button type="submit" disabled={!input.trim() || thinking || input.length > 2000}
          className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed h-[42px]">
          {thinking ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          Enviar
        </button>
      </form>

      <p className="text-[11px] text-neutral-400 text-center mt-2 leading-tight">
        As respostas são geradas por inteligência artificial e podem conter erros. A STN não se responsabiliza por elas nem as endossa oficialmente. Sempre verifique as fontes originais.
      </p>
    </div>
    </>
  )
}
