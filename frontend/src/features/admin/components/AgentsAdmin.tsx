/**
 * CRUD de Agentes Bedrock — cadastro manual de Agent ID / Alias ID.
 */

import { useState, useEffect } from 'react'
import { Plus, Trash2, Star, Loader2, X } from 'lucide-react'
import { api } from '@/src/shared/services/api'

interface AgentConfig {
  id: string
  name: string
  description?: string
  agentId: string
  agentAliasId: string
  region?: string
  isDefault: boolean
}

export function AgentsAdmin() {
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', agentId: '', agentAliasId: '', region: 'us-east-1', isDefault: false })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchAgents = () => {
    setLoading(true)
    api.get<AgentConfig[]>('/api/agents')
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchAgents() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.agentId.trim() || !form.agentAliasId.trim()) {
      setError('Nome, Agent ID e Agent Alias ID são obrigatórios.')
      return
    }

    setError('')
    setSubmitting(true)
    try {
      await api.post('/api/agents', form)
      setForm({ name: '', description: '', agentId: '', agentAliasId: '', region: 'us-east-1', isDefault: false })
      setShowForm(false)
      fetchAgents()
    } catch (err: any) {
      setError(err.message || 'Erro ao cadastrar agente.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este agente?')) return
    try {
      await api.delete(`/api/agents/${id}`)
      fetchAgents()
    } catch (err: any) {
      console.error(err)
    }
  }

  const handleSetDefault = async (agent: AgentConfig) => {
    try {
      await api.put(`/api/agents/${agent.id}`, { isDefault: true })
      fetchAgents()
    } catch (err: any) {
      console.error(err)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-neutral-500">
          Agentes Bedrock disponíveis para o Chat, Comparativo e Parecerista.
        </p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          <Plus className="w-3.5 h-3.5" />
          Novo agente
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-neutral-200 rounded-lg p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-neutral-800">Novo Agente</h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-neutral-400 hover:text-neutral-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Nome *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input-field w-full text-sm" placeholder="Ex: Agente Fiscal Base" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Região</label>
              <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}
                className="input-field w-full text-sm" placeholder="us-east-1" />
            </div>
          </div>

          <div>
            <label className="text-xs text-neutral-500 block mb-1">Descrição</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-field w-full text-sm" placeholder="Descrição opcional" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Agent ID *</label>
              <input value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}
                className="input-field w-full text-sm font-mono" placeholder="XXXXXXXXXX" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Agent Alias ID *</label>
              <input value={form.agentAliasId} onChange={(e) => setForm({ ...form, agentAliasId: e.target.value })}
                className="input-field w-full text-sm font-mono" placeholder="XXXXXXXXXX" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-neutral-600">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
            Definir como agente padrão
          </label>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

          <button type="submit" disabled={submitting} className="btn-primary text-sm disabled:opacity-50">
            {submitting ? 'Salvando…' : 'Cadastrar agente'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-neutral-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando…
        </div>
      ) : agents.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">Nenhum agente cadastrado.</p>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <div key={agent.id} className="flex items-center justify-between border border-neutral-200 rounded-lg px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-800">{agent.name}</span>
                  {agent.isDefault && (
                    <span className="text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded font-medium">Padrão</span>
                  )}
                </div>
                <p className="text-xs text-neutral-400 font-mono mt-0.5">
                  {agent.agentId} / {agent.agentAliasId} · {agent.region}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!agent.isDefault && (
                  <button onClick={() => handleSetDefault(agent)} title="Definir como padrão"
                    className="p-1.5 text-neutral-400 hover:text-amber-500 rounded transition-colors">
                    <Star className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => handleDelete(agent.id)} title="Remover"
                  className="p-1.5 text-neutral-400 hover:text-red-500 rounded transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
