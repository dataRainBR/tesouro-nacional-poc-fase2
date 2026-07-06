/**
 * Página de Configurações (admin) — gerencia Agentes Bedrock e Modelos Fine-Tuned.
 */

import { useState } from 'react'
import { Bot, Sparkles, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AgentsAdmin } from '@/src/features/admin/components/AgentsAdmin'
import { FineTunedModelsAdmin } from '@/src/features/admin/components/FineTunedModelsAdmin'

type SettingsTab = 'agents' | 'finetuned'

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('agents')

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" />
        Voltar
      </Link>
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

      {tab === 'agents' && <AgentsAdmin />}
      {tab === 'finetuned' && <FineTunedModelsAdmin />}
    </div>
  )
}
