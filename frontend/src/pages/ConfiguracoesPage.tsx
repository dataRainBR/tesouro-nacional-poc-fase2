/**
 * Página de Configurações (admin) — gerencia Agentes Bedrock e Modelos Fine-Tuned.
 *
 * Usa o AgentsManager (portado da Fase 1, com browse AWS) na tab de Agentes
 * e o FineTunedModelsAdmin (Fase 2) na tab de Modelos Fine-Tuned.
 */

import { useState } from 'react'
import { Bot, Sparkles } from 'lucide-react'
import { AgentsManager } from '@/src/features/config/components/AgentsManager'
import { FineTunedModelsAdmin } from '@/src/features/admin/components/FineTunedModelsAdmin'

type SettingsTab = 'agents' | 'finetuned'

export default function ConfiguracoesPage() {
  const [tab, setTab] = useState<SettingsTab>('agents')

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-lg font-semibold text-neutral-800 mb-4">Configurações</h1>

      <div className="flex gap-1 bg-neutral-100 rounded-lg p-1 mb-6 w-fit">
        <button
          onClick={() => setTab('agents')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            tab === 'agents' ? 'bg-white text-primary-700 shadow-sm' : 'text-neutral-600 hover:text-neutral-800'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          Agentes Bedrock
        </button>
        <button
          onClick={() => setTab('finetuned')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            tab === 'finetuned' ? 'bg-white text-primary-700 shadow-sm' : 'text-neutral-600 hover:text-neutral-800'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Modelos Fine-Tuned
        </button>
      </div>

      {tab === 'agents' && <AgentsManager />}
      {tab === 'finetuned' && <FineTunedModelsAdmin />}
    </div>
  )
}
