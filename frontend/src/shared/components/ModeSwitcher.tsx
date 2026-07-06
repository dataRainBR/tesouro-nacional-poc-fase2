/**
 * Mode Switcher — alternador de modos no header da aplicação.
 *
 * Modos disponíveis:
 * - Chat: chat normal com o agente (Fase 1)
 * - Parecerista: avaliação e auditoria de respostas
 * - Comparativo: comparação A/B entre agentes
 */

import { MessageSquare, ClipboardCheck, GitCompare } from 'lucide-react'

export type AppMode = 'chat' | 'parecerista' | 'comparativo'

interface ModeSwitcherProps {
  currentMode: AppMode
  onModeChange: (mode: AppMode) => void
}

const modes: { key: AppMode; label: string; icon: typeof MessageSquare }[] = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'parecerista', label: 'Parecerista', icon: ClipboardCheck },
  { key: 'comparativo', label: 'Comparativo', icon: GitCompare },
]

export function ModeSwitcher({ currentMode, onModeChange }: ModeSwitcherProps) {
  return (
    <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
      {modes.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => onModeChange(key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            currentMode === key
              ? 'bg-white text-primary-700 shadow-sm'
              : 'text-neutral-600 hover:text-neutral-800'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}
