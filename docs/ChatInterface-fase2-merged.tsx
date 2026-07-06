'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Loader2, ChevronDown, ThumbsDown, X, MessageSquare, FileText, Paperclip, Upload, ArrowLeftRight, Sparkles } from 'lucide-react'
import { MessageBubble } from './MessageBubble'
import type { Message } from '@tesouro-nacional/shared'
import { api } from '@/src/shared/services/api'

type ActiveMode = 'comum' | 'parecerista'

const MAX_INPUT_LENGTH = 2000

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
  const [thinking, setThinking] = useState(false)
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [dislikeModal, setDislikeModal] = useState<{ messageId: string; comment: string } | null>(null)
  const [activeMode, setActiveMode] = useState<ActiveMode>('comum')
  const [isCompareMode, setIsCompareMode] = useState(false)
  const [messagesComum, setMessagesComum] = useState<Message[]>([])
  const [messagesParecerista, setMessagesParecerista] = useState<Message[]>([])
  const [thinkingComum, setThinkingComum] = useState(false)
  const [thinkingParecerista, setThinkingParecerista] = useState(false)
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

  useEffect(() => {
    return onLoadingChange(() => {
      const stillLoading = isChatLoading(currentChatRef.current)
      setThinking(stillLoading)
      if (!stillLoading && currentChatRef.current) {
        fetchMessages(currentChatRef.current)
      }
    })
  }, [])

  useEffect(() => {
    const el = messagesContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, thinking, messagesComum, messagesParecerista])

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
      if (currentChatRef.current === cid) {
        setMessages(data)
      }
    } catch (error) {
      console.error('Erro ao buscar mensagens:', error)
    }
  }, [])

  // Identificar agentes por tipo (comum vs parecerista/fine-tuning)
  const comunAgents = agents.filter(a => !a.name.includes('FINE-TUNING') && !a.name.includes('Parecerista'))
  const pareceristAgents = agents.filter(a => a.name.includes('FINE-TUNING') || a.name.includes('Parecerista'))

  // Agentes de exemplo fine-tuning (para demonstração enquanto não há cadastrados)
  const fineTuningExamples: AgentOption[] = pareceristAgents.length > 0 ? pareceristAgents : [
    { id: 'ft-parecerista-v1', name: '[FINE-TUNING] Parecerista TN v1.0', description: 'Modelo base treinado com pareceres técnicos históricos da STN', isDefault: false },
    { id: 'ft-parecerista-v2', name: '[FINE-TUNING] Parecerista TN v2.0', description: 'Versão aprimorada com notas técnicas e jurisprudência', isDefault: false },
  ]

  // Agentes visíveis no seletor dependem do modo ativo
  const visibleAgents = activeMode === 'parecerista' ? fineTuningExamples : comunAgents.length > 0 ? comunAgents : agents

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || input.length > MAX_INPUT_LENGTH || thinking || (isCompareMode && (thinkingComum || thinkingParecerista))) return

    const currentInput = input
    setInput('')

    if (isCompareMode) {
      await handleComparisonSend(currentInput)
    } else {
      await handleNormalSend(currentInput)
    }
  }

  const handleNormalSend = async (currentInput: string) => {
    const sendChatId = chatId

    const userMessage: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      chatId: sendChatId || '',
      role: 'user',
      content: currentInput,
      timestamp: new Date().toISOString(),
    }

    setThinking(true)
    setMessages((prev) => [...prev, userMessage])

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

      if (!sendChatId && data.chatId) {
        loadingChats.add(resolvedChatId)
        window.dispatchEvent(new CustomEvent('chatCreated', { detail: { chatId: data.chatId } }))
      }

      loadingChats.delete(resolvedChatId)
      notify()

      const viewingThis = currentChatRef.current === resolvedChatId
        || currentChatRef.current === sendChatId
        || currentChatRef.current === null

      if (viewingThis) {
        setThinking(false)
        await fetchMessages(resolvedChatId)
        setTimeout(() => window.dispatchEvent(new CustomEvent('chatTitleUpdated')), 3000)
      }
    } catch (error: any) {
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

  const handleComparisonSend = async (currentInput: string) => {
    const userMessage: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      chatId: '',
      role: 'user',
      content: currentInput,
      timestamp: new Date().toISOString(),
    }

    setMessagesComum((prev) => [...prev, userMessage])
    setMessagesParecerista((prev) => [...prev, userMessage])
    setThinkingComum(true)
    setThinkingParecerista(true)

    // Enviar para agente comum
    const comunAgent = comunAgents.find(a => a.isDefault) || comunAgents[0]
    if (comunAgent) {
      api.post<{ response: string }>('/api/chat', { message: currentInput, agentId: comunAgent.id })
        .then((data) => {
          setMessagesComum((prev) => [...prev, {
            id: `comum-${Date.now()}`,
            chatId: '',
            role: 'assistant',
            content: data.response,
            timestamp: new Date().toISOString(),
          }])
        })
        .catch((err) => {
          setMessagesComum((prev) => [...prev, {
            id: `comum-err-${Date.now()}`,
            chatId: '',
            role: 'assistant',
            content: `Erro: ${err.message}`,
            timestamp: new Date().toISOString(),
          }])
        })
        .finally(() => setThinkingComum(false))
    }

    // Enviar para agente parecerista
    const parecAgent = pareceristAgents[0] || comunAgents[0]
    if (parecAgent) {
      api.post<{ response: string }>('/api/chat', { message: currentInput, agentId: parecAgent.id })
        .then((data) => {
          setMessagesParecerista((prev) => [...prev, {
            id: `parec-${Date.now()}`,
            chatId: '',
            role: 'assistant',
            content: data.response,
            timestamp: new Date().toISOString(),
          }])
        })
        .catch((err) => {
          setMessagesParecerista((prev) => [...prev, {
            id: `parec-err-${Date.now()}`,
            chatId: '',
            role: 'assistant',
            content: `Erro: ${err.message}`,
            timestamp: new Date().toISOString(),
          }])
        })
        .finally(() => setThinkingParecerista(false))
    }
  }

  const handleEdit = async (message: Message, messageIndex: number, newContent: string) => {
    if (thinking) return
    if (chatId && message.timestamp) {
      try {
        await api.post(`/api/chats/${chatId}/delete-messages-after`, { afterTimestamp: message.timestamp })
      } catch (error) {
        console.error('Erro ao deletar mensagens anteriores:', error)
      }
    }
    setMessages((prev) => prev.slice(0, messageIndex))
    setInput(newContent)
    setTimeout(() => {
      const form = document.querySelector('form') as HTMLFormElement
      if (form) form.requestSubmit()
    }, 0)
  }

  const handleRetry = (errorIndex: number) => {
    if (thinking) return
    let lastUserMsg: Message | null = null
    for (let i = errorIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserMsg = messages[i]; break }
    }
    if (!lastUserMsg) return
    setMessages((prev) => prev.filter((_, i) => i !== errorIndex))
    setInput(lastUserMsg.content)
    setTimeout(() => {
      const form = document.querySelector('form') as HTMLFormElement
      if (form) form.requestSubmit()
    }, 0)
  }

  const handleFeedback = async (messageId: string, feedback: 'like' | 'dislike') => {
    if (feedback === 'dislike') { setDislikeModal({ messageId, comment: '' }); return }
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

  const toggleCompareMode = () => {
    setIsCompareMode(!isCompareMode)
    setMessagesComum([])
    setMessagesParecerista([])
  }

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)
  void selectedAgent // usado no template

  // Exemplos contextualizados ao Tesouro Nacional (tela de nova conversa - modo Comum)
  const EXAMPLES = [
    'Qual foi o Resultado Primário do Governo Central em 2024 comparado a 2023?',
    'Mostre a evolução mensal da Receita Líquida em 2025 a preços de dez/25.',
    'Quanto foi gasto com Benefícios Previdenciários no acumulado de janeiro a agosto de 2024?',
  ]
  const CAPABILITIES = [
    'Consulta a série histórica completa do Resultado do Tesouro Nacional (1997–2025) com dados de receitas, despesas e indicadores fiscais.',
    'Realiza cálculos de deflação pelo IPCA, agregações por período e comparações entre exercícios.',
    'Acessa documentos oficiais (Apresentações, Boletins e Relatórios) para análises qualitativas e metodológicas.',
  ]
  const LIMITATIONS = [
    'Pode apresentar valores imprecisos ou incompletos — sempre confira com as publicações oficiais da STN.',
    'Os dados fiscais cobrem até agosto/2025 e o IPCA até março/2026. Períodos fora dessa janela não estão disponíveis.',
    'Não substitui análises técnicas, pareceres contábeis ou interpretações oficiais do Tesouro Nacional.',
  ]

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
          <p className="text-xs text-neutral-500 mb-3">Deixe um comentário explicando o problema com a resposta (opcional).</p>
          <textarea
            autoFocus rows={4}
            value={dislikeModal.comment}
            onChange={(e) => setDislikeModal((m) => m ? { ...m, comment: e.target.value } : null)}
            placeholder="Ex: A resposta está incorreta, incompleta ou fora de contexto…"
            className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300 resize-none"
          />
          <div className="flex items-center justify-end gap-2 mt-4">
            <button onClick={() => setDislikeModal(null)} className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors">Cancelar</button>
            <button
              onClick={async () => { const { messageId, comment } = dislikeModal; setDislikeModal(null); await sendFeedback(messageId, 'dislike', comment) }}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium"
            >
              <ThumbsDown className="w-4 h-4" /> Confirmar
            </button>
          </div>
        </div>
      </div>
    )}
    <div className="card h-[calc(100vh-12rem)] flex flex-col">
      {/* Header: Agent selector + Mode toggle + Compare button */}
      <div className="flex items-center gap-3 pb-3 border-b border-neutral-100 mb-3 flex-wrap">
        {!isCompareMode ? (
          <>
            {/* Seletor de agente */}
            {(visibleAgents.length > 0 || agents.length > 0) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500 flex-shrink-0">Agente:</span>
                <div className="relative">
                  <select value={selectedAgentId || ''} onChange={(e) => setSelectedAgentId(e.target.value)}
                    className="appearance-none pl-2 pr-7 py-1 text-xs border border-neutral-200 rounded bg-white text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer">
                    {visibleAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}{agent.isDefault ? ' (padrão)' : ''}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-neutral-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                {activeMode === 'parecerista' && (
                  <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">Fine-Tuning</span>
                )}
              </div>
            )}

            <div className="h-5 w-px bg-neutral-200" />

            {/* Toggle Modo */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">Modo:</span>
              <div className="flex gap-0.5 p-0.5 bg-neutral-100 rounded-lg">
                <button
                  onClick={() => setActiveMode('comum')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-all ${
                    activeMode === 'comum' ? 'bg-white shadow-sm font-medium text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Comum
                </button>
                <button
                  onClick={() => setActiveMode('parecerista')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-all ${
                    activeMode === 'parecerista' ? 'bg-white shadow-sm font-medium text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Parecerista
                </button>
              </div>
            </div>

            <div className="h-5 w-px bg-neutral-200" />

            <button
              onClick={toggleCompareMode}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-primary-500 to-purple-500 text-white rounded-lg hover:from-primary-600 hover:to-purple-600 transition-all text-xs font-medium"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Modo Comparação
            </button>
          </>
        ) : (
          <>
            <span className="px-2.5 py-1.5 bg-gradient-to-r from-primary-500 to-purple-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5">
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Modo Comparação Ativo
            </span>
            <div className="h-5 w-px bg-neutral-200" />
            <div className="flex items-center gap-1.5 text-xs text-neutral-500">
              <MessageSquare className="w-3.5 h-3.5 text-primary-500" />
              Comum:
              <div className="relative">
                <select value={selectedAgentId || ''} onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="appearance-none pl-1 pr-5 py-0.5 text-[10px] border border-neutral-200 rounded bg-white text-neutral-700 focus:outline-none cursor-pointer">
                  {comunAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-2.5 h-2.5 text-neutral-400 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-neutral-500">
              <FileText className="w-3.5 h-3.5 text-purple-500" />
              Parecerista:
              <div className="relative">
                <select
                  className="appearance-none pl-1 pr-5 py-0.5 text-[10px] border border-neutral-200 rounded bg-white text-neutral-700 focus:outline-none cursor-pointer">
                  {fineTuningExamples.length > 0 ? (
                    fineTuningExamples.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))
                  ) : (
                    comunAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))
                  )}
                </select>
                <ChevronDown className="w-2.5 h-2.5 text-neutral-400 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
            <button
              onClick={toggleCompareMode}
              className="ml-auto px-3 py-1.5 bg-neutral-500 text-white rounded-lg hover:bg-neutral-600 transition-colors text-xs"
            >
              Sair do Modo Comparação
            </button>
          </>
        )}
      </div>

      {/* Messages Area */}
      {isCompareMode ? (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto mb-4">
          {messagesComum.length === 0 && messagesParecerista.length === 0 && (
            <div className="bg-gradient-to-r from-primary-50 to-purple-50 border border-neutral-200 rounded-lg p-5 mb-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-gradient-to-r from-primary-500 to-purple-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <ArrowLeftRight className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-neutral-900 text-sm mb-1">Modo Comparação Ativo</h3>
                  <p className="text-xs text-neutral-600 mb-3">
                    Envie uma pergunta ou documento e veja as respostas lado a lado dos dois agentes simultaneamente.
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-white rounded p-2.5 border border-primary-200">
                      <div className="flex items-center gap-1.5 mb-1">
                        <MessageSquare className="w-3.5 h-3.5 text-primary-600" />
                        <span className="font-medium text-primary-900">Agente Comum</span>
                      </div>
                      <p className="text-neutral-600">Resposta conversacional e informativa</p>
                    </div>
                    <div className="bg-white rounded p-2.5 border border-purple-200">
                      <div className="flex items-center gap-1.5 mb-1">
                        <FileText className="w-3.5 h-3.5 text-purple-600" />
                        <span className="font-medium text-purple-900">Agente Parecerista</span>
                      </div>
                      <p className="text-neutral-600">Parecer técnico estruturado e formal</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 h-full min-h-0">
            {/* Painel Comum */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="bg-primary-50 border-2 border-primary-200 rounded-t-lg px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-primary-600" />
                  <span className="font-semibold text-primary-900 text-xs">Agente Comum</span>
                </div>
                <p className="text-[10px] text-primary-700 mt-0.5">{comunAgents[0]?.name || 'N/A'}</p>
              </div>
              <div className="flex-1 border-x-2 border-b-2 border-primary-200 rounded-b-lg bg-white p-3 overflow-y-auto space-y-3">
                {messagesComum.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-neutral-400">
                    <MessageSquare className="w-10 h-10 text-primary-200 mb-2" />
                    <p className="text-xs">Resposta aparecerá aqui</p>
                  </div>
                ) : (
                  messagesComum.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs ${
                        msg.role === 'user' ? 'bg-primary-500 text-white' : 'bg-neutral-100 text-neutral-800 border border-neutral-200'
                      }`}>
                        <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                      </div>
                    </div>
                  ))
                )}
                {thinkingComum && (
                  <div className="flex items-center gap-1.5 text-neutral-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Pensando...</span>
                  </div>
                )}
              </div>
            </div>

            <div className="w-px bg-neutral-200 my-4" />

            {/* Painel Parecerista */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="bg-purple-50 border-2 border-purple-200 rounded-t-lg px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-purple-600" />
                  <span className="font-semibold text-purple-900 text-xs">Agente Parecerista</span>
                  <span className="px-1.5 py-0.5 bg-purple-200 text-purple-800 rounded text-[10px] font-medium">Fine-Tuning</span>
                </div>
                <p className="text-[10px] text-purple-700 mt-0.5">{fineTuningExamples[0]?.name || 'N/A'}</p>
              </div>
              <div className="flex-1 border-x-2 border-b-2 border-purple-200 rounded-b-lg bg-white p-3 overflow-y-auto space-y-3">
                {messagesParecerista.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-neutral-400">
                    <FileText className="w-10 h-10 text-purple-200 mb-2" />
                    <p className="text-xs">Parecer aparecerá aqui</p>
                  </div>
                ) : (
                  messagesParecerista.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs ${
                        msg.role === 'user' ? 'bg-purple-500 text-white' : 'bg-neutral-100 text-neutral-800 border border-neutral-200'
                      }`}>
                        <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                      </div>
                    </div>
                  ))
                )}
                {thinkingParecerista && (
                  <div className="flex items-center gap-1.5 text-neutral-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Pensando...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
          {messages.length === 0 && !thinking ? (
            activeMode === 'comum' ? (
              // ── Tela de nova conversa (Fase 1): Exemplos / Capacidades / Limitações ──
              <div className="flex flex-col items-center justify-start h-full py-4 px-4 overflow-y-auto">
                <p className="text-primary-500 text-sm font-medium mb-1">Olá! Eu sou o</p>
                <h2 className="text-2xl font-bold text-primary-600 mb-6">Assistente Digital Fiscal</h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-700 mb-3">Exemplos</h3>
                    <div className="space-y-2">
                      {EXAMPLES.map((text, i) => (
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
                      {CAPABILITIES.map((text, i) => (
                        <div key={i} className="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-4 py-3">
                          {text}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-neutral-700 mb-3">Limitações</h3>
                    <div className="space-y-2">
                      {LIMITATIONS.map((text, i) => (
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
              // ── Tela vazia do modo Parecerista (mantida do commit 355689e) ──
              <div className="flex flex-col items-center justify-center h-full text-center">
                <FileText className="w-14 h-14 text-neutral-200 mb-4" />
                <p className="text-lg mb-2 text-neutral-600">Bem-vindo ao Parecerista Técnico</p>
                <p className="text-sm text-neutral-500">Envie um documento para receber um parecer técnico especializado</p>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-left mt-6 max-w-lg">
                  <div className="flex items-start gap-2.5 mb-3">
                    <div className="w-7 h-7 bg-purple-500 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-neutral-900 text-sm">Agentes Fine-Tuning Especializados</h3>
                      <p className="text-xs text-neutral-600 mt-0.5">
                        Treinados para análise técnica e elaboração de pareceres no contexto do Tesouro Nacional
                      </p>
                    </div>
                  </div>
                  {fineTuningExamples.length > 0 ? (
                    <div className="space-y-2">
                      {fineTuningExamples.map((agent) => (
                        <div key={agent.id} className="bg-white rounded-lg p-3 border border-purple-100">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-purple-500 rounded-full" />
                            <span className="text-xs font-medium text-neutral-800">{agent.name}</span>
                          </div>
                          {agent.description && <p className="text-[10px] text-neutral-500 mt-1 ml-4">{agent.description}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-500 italic">Nenhum agente fine-tuning cadastrado ainda.</p>
                  )}
                </div>
                {agents.length === 0 && (
                  <p className="text-xs text-amber-500 mt-3 bg-amber-50 border border-amber-200 rounded px-3 py-2 inline-block">
                    Nenhum agente configurado. Um administrador precisa cadastrar um agente em Configurações.
                  </p>
                )}
              </div>
            )
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
      )}

      {/* Input Area */}
      <form onSubmit={handleSend} className="flex gap-2 items-end">
        <div className="flex-1 relative">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.length <= MAX_INPUT_LENGTH) handleSend(e) } }}
            placeholder={
              isCompareMode
                ? 'Digite sua pergunta ou documento para comparar as respostas...'
                : activeMode === 'comum'
                  ? 'Digite sua pergunta...'
                  : 'Cole o texto do documento ou descreva o que precisa analisar...'
            }
            className={`input-field w-full min-h-[42px] max-h-[200px] resize-none overflow-y-auto pr-16 ${input.length > MAX_INPUT_LENGTH ? 'border-error focus:ring-error' : ''}`}
            rows={1}
            disabled={thinking || (isCompareMode && (thinkingComum || thinkingParecerista))}
            style={{ height: `${Math.min(200, Math.max(42, (input.split('\n').length) * 24 + 18))}px` }}
          />
          {activeMode === 'parecerista' && !isCompareMode && (
            <button type="button" className="absolute right-9 top-1/2 -translate-y-1/2 p-1 hover:bg-neutral-100 rounded text-neutral-400 hover:text-neutral-600" title="Anexar documento">
              <Paperclip className="w-4 h-4" />
            </button>
          )}
          {input.length > MAX_INPUT_LENGTH * 0.75 && (
            <span className={`absolute right-2 bottom-2 text-[10px] ${input.length > MAX_INPUT_LENGTH ? 'text-error font-medium' : 'text-neutral-400'}`}>
              {input.length}/{MAX_INPUT_LENGTH}
            </span>
          )}
        </div>
        <button type="submit" disabled={!input.trim() || input.length > MAX_INPUT_LENGTH || thinking || (isCompareMode && (thinkingComum || thinkingParecerista))}
          className={`flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed h-[42px] px-4 rounded-lg text-white text-sm font-medium transition-colors ${
            isCompareMode
              ? 'bg-gradient-to-r from-primary-500 to-purple-500 hover:from-primary-600 hover:to-purple-600'
              : 'btn-primary'
          }`}>
          {(thinking || thinkingComum || thinkingParecerista) ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          {isCompareMode ? 'Comparar' : 'Enviar'}
        </button>
      </form>

      {activeMode === 'parecerista' && !isCompareMode && messages.length === 0 && (
        <div className="mt-2 text-[10px] text-neutral-400 flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5" />
          <span>Você pode colar texto diretamente ou fazer upload de documentos PDF, DOCX, TXT</span>
        </div>
      )}
      {isCompareMode && messagesComum.length === 0 && (
        <div className="mt-2 text-[10px] text-neutral-400 flex items-center gap-1.5">
          <ArrowLeftRight className="w-3.5 h-3.5" />
          <span>A mesma mensagem será enviada para ambos os agentes simultaneamente</span>
        </div>
      )}

      {/* Disclaimer (Fase 1) */}
      <p className="text-[11px] text-neutral-400 text-center mt-2 leading-tight">
        As respostas podem conter erros, a STN não se responsabiliza nem as endossa como oficiais. Sempre confira com fontes originais.
      </p>
    </div>
    </>
  )
}
