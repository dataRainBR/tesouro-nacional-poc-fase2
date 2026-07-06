/**
 * HomePage — Página principal que integra os 3 modos de operação.
 *
 * Renderiza o Mode Switcher no topo e alterna entre Chat, Parecerista e Comparativo.
 */

import { useState, useEffect } from 'react'
import { Terminal, ChevronDown, ChevronUp } from 'lucide-react'
import { ModeSwitcher, type AppMode } from '@/src/shared/components/ModeSwitcher'
import { ChatInterface } from '@/src/features/chat/components/ChatInterface'
import { ChatHistory } from '@/src/features/chat/components/ChatHistory'
import { PareceristaInterface } from '@/src/features/parecerista/components/PareceristaInterface'
import { ComparativoInterface } from '@/src/features/comparativo/components/ComparativoInterface'
import { LogsPanel } from '@/src/shared/components/LogsPanel'
import { useAuth } from '@/src/shared/contexts/AuthContext'

const LOGS_HEIGHT = 280

export function HomePage() {
  const [mode, setMode] = useState<AppMode>('chat')
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // Escutar evento de novo chat criado pelo ChatInterface
  useEffect(() => {
    const handleChatCreated = (event: CustomEvent) => {
      setSelectedChatId(event.detail.chatId)
    }
    window.addEventListener('chatCreated', handleChatCreated as EventListener)
    return () => window.removeEventListener('chatCreated', handleChatCreated as EventListener)
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      {/* Header interno — troca de modo dentro do Chat (Comum / Parecerista / Comparativo) */}
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-neutral-200">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-primary-700">Assistente Digital Fiscal</h1>
          <span className="text-[10px] bg-primary-100 text-primary-600 px-1.5 py-0.5 rounded font-medium">
            Fase 2
          </span>
        </div>
        <ModeSwitcher currentMode={mode} onModeChange={setMode} />
      </header>

      {/* Conteúdo */}
      <div className="flex-1 flex overflow-hidden">
        {mode === 'chat' && (
          <>
            {/* Sidebar de histórico */}
            <aside className="w-72 border-r border-neutral-200 bg-white overflow-y-auto hidden md:block">
              <ChatHistory
                selectedChatId={selectedChatId}
                onSelectChat={setSelectedChatId}
              />
            </aside>

            {/* Chat principal */}
            <main className="flex-1 p-4 overflow-hidden">
              <ChatInterface chatId={selectedChatId} />
            </main>
          </>
        )}

        {mode === 'parecerista' && (
          <main className="flex-1 p-6 overflow-hidden">
            <PareceristaInterface />
          </main>
        )}

        {mode === 'comparativo' && (
          <main className="flex-1 p-6 overflow-hidden">
            <ComparativoInterface />
          </main>
        )}
      </div>

      {/* Logs drawer — somente admin, sempre visível na página de Chat */}
      {isAdmin && (
        <div className="rounded-xl border border-neutral-800 overflow-hidden shadow-lg mx-6 mb-4">
          <button
            onClick={() => setLogsOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-2 bg-neutral-900 hover:bg-neutral-800 transition-colors text-left"
          >
            <Terminal className="w-4 h-4 text-green-400 flex-shrink-0" />
            <span className="text-xs font-mono text-neutral-300 flex-1">Logs do backend</span>
            {logsOpen
              ? <ChevronDown className="w-4 h-4 text-neutral-500" />
              : <ChevronUp className="w-4 h-4 text-neutral-500" />}
          </button>
          {logsOpen && (
            <div style={{ height: LOGS_HEIGHT }}>
              <LogsPanel />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
