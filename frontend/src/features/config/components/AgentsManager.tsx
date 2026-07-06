'use client'

import { useState, useEffect } from 'react'
import {
  Plus, Trash2, Pencil, Check, X, Star, Loader2, Search,
  ChevronRight, ChevronDown, ArrowLeft, RefreshCw, DownloadCloud,
} from 'lucide-react'
import { api } from '@/src/shared/services/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AgentConfig {
  id: string
  name: string
  description?: string
  agentId: string
  agentAliasId: string
  region?: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

interface BedrockAgentInfo {
  agentId: string
  agentName: string
  agentStatus: string
  description?: string
  updatedAt?: string
}

interface BedrockAliasInfo {
  aliasId: string
  aliasName: string
  aliasStatus: string
  description?: string
  updatedAt?: string
}

const EMPTY_FORM = {
  name: '',
  description: '',
  agentId: '',
  agentAliasId: '',
  region: '',
  isDefault: false,
}

// ---------------------------------------------------------------------------
// AgentsManager
// ---------------------------------------------------------------------------
export function AgentsManager() {
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Browse mode
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseRegion, setBrowseRegion] = useState('')
  const [browseAgents, setBrowseAgents] = useState<BedrockAgentInfo[]>([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [selectedBrowseAgent, setSelectedBrowseAgent] = useState<BedrockAgentInfo | null>(null)
  const [browseAliases, setBrowseAliases] = useState<BedrockAliasInfo[]>([])
  const [aliasLoading, setAliasLoading] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.get<AgentConfig[]>('/api/agents')
      setAgents(data)
    } catch {
      showMsg('error', 'Erro ao carregar agentes.')
    } finally {
      setLoading(false)
    }
  }

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
    setBrowseOpen(false)
  }

  const openEdit = (agent: AgentConfig) => {
    setEditingId(agent.id)
    setForm({
      name: agent.name,
      description: agent.description || '',
      agentId: agent.agentId,
      agentAliasId: agent.agentAliasId,
      region: agent.region || '',
      isDefault: agent.isDefault,
    })
    setShowForm(true)
    setBrowseOpen(false)
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setBrowseOpen(false)
    resetBrowse()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editingId) {
        const updated = await api.put<AgentConfig>(`/api/agents/${editingId}`, form)
        setAgents((prev) => prev.map((a) => (a.id === editingId ? updated : a)))
        showMsg('success', 'Agente atualizado com sucesso.')
      } else {
        const created = await api.post<AgentConfig>('/api/agents', form)
        setAgents((prev) => [...prev, created])
        showMsg('success', 'Agente criado com sucesso.')
      }
      cancelForm()
    } catch (err: any) {
      showMsg('error', err.message || 'Erro ao salvar agente.')
    } finally {
      setSaving(false)
    }
  }

  const handleSetDefault = async (agent: AgentConfig) => {
    try {
      await api.put<AgentConfig>(`/api/agents/${agent.id}`, { isDefault: true })
      setAgents((prev) => prev.map((a) => ({ ...a, isDefault: a.id === agent.id })))
      showMsg('success', `"${agent.name}" definido como padrão.`)
    } catch {
      showMsg('error', 'Erro ao definir agente padrão.')
    }
  }

  const handleDelete = async (agent: AgentConfig) => {
    if (!confirm(`Remover o agente "${agent.name}"?`)) return
    try {
      await api.delete(`/api/agents/${agent.id}`)
      setAgents((prev) => prev.filter((a) => a.id !== agent.id))
      showMsg('success', 'Agente removido.')
    } catch {
      showMsg('error', 'Erro ao remover agente.')
    }
  }

  // -------------------------------------------------------------------------
  // Browse from AWS
  // -------------------------------------------------------------------------
  const resetBrowse = () => {
    setBrowseAgents([])
    setBrowseError(null)
    setSelectedBrowseAgent(null)
    setBrowseAliases([])
  }

  const fetchBedrockAgents = async () => {
    setBrowseLoading(true)
    setBrowseError(null)
    setSelectedBrowseAgent(null)
    setBrowseAliases([])
    try {
      const region = browseRegion.trim() || undefined
      const qs = region ? `?region=${encodeURIComponent(region)}` : ''
      const data = await api.get<BedrockAgentInfo[]>(`/api/agents/bedrock/list${qs}`)
      setBrowseAgents(data)
      if (data.length === 0) setBrowseError('Nenhum agente encontrado nesta região.')
    } catch (err: any) {
      setBrowseError(err.message || 'Erro ao buscar agentes.')
    } finally {
      setBrowseLoading(false)
    }
  }

  const selectBrowseAgent = async (agent: BedrockAgentInfo) => {
    setSelectedBrowseAgent(agent)
    setBrowseAliases([])
    setAliasLoading(true)
    try {
      const region = browseRegion.trim() || undefined
      const qs = region ? `?region=${encodeURIComponent(region)}` : ''
      const data = await api.get<BedrockAliasInfo[]>(
        `/api/agents/bedrock/${agent.agentId}/aliases${qs}`
      )
      setBrowseAliases(data)
    } catch (err: any) {
      setBrowseError(err.message || 'Erro ao carregar aliases.')
    } finally {
      setAliasLoading(false)
    }
  }

  const importAlias = (alias: BedrockAliasInfo) => {
    if (!selectedBrowseAgent) return
    setForm((f) => ({
      ...f,
      agentId: selectedBrowseAgent.agentId,
      agentAliasId: alias.aliasId,
      region: browseRegion.trim() || f.region,
      // Pré-preenche nome se estiver vazio
      name: f.name || `${selectedBrowseAgent.agentName} — ${alias.aliasName}`,
      description: f.description || selectedBrowseAgent.description || '',
    }))
    setBrowseOpen(false)
    resetBrowse()
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const statusColor = (status: string) => {
    if (status === 'PREPARED') return 'text-green-600 bg-green-50 border-green-200'
    if (status === 'ACTIVE') return 'text-green-600 bg-green-50 border-green-200'
    if (status === 'CREATING' || status === 'UPDATING') return 'text-amber-600 bg-amber-50 border-amber-200'
    return 'text-neutral-500 bg-neutral-50 border-neutral-200'
  }

  const inputClass =
    'w-full px-3 py-2 border border-neutral-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent'
  const monoInputClass = inputClass + ' font-mono'
  const labelClass = 'block text-xs font-medium text-neutral-600 mb-1 uppercase tracking-wide'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Agentes Bedrock</h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Gerencie os agentes disponíveis para os usuários no chat.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-primary-500 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-primary-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo agente
          </button>
        )}
      </div>

      {/* Feedback */}
      {message && (
        <div
          className={`p-3 rounded-md text-sm font-medium ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Formulário de criação/edição */}
      {showForm && (
        <div className="border border-primary-200 rounded-lg bg-primary-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-primary-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-900">
              {editingId ? 'Editar agente' : 'Novo agente'}
            </h3>
            <button
              type="button"
              onClick={() => { setBrowseOpen((v) => !v); if (browseAgents.length === 0 && !browseOpen) fetchBedrockAgents() }}
              className="flex items-center gap-1.5 text-xs text-primary-700 hover:text-primary-900 border border-primary-300 hover:border-primary-400 bg-white hover:bg-primary-50 px-2.5 py-1.5 rounded transition-colors font-medium"
            >
              <DownloadCloud className="w-3.5 h-3.5" />
              Buscar na AWS
              {browseOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          </div>

          {/* Browse panel */}
          {browseOpen && (
            <div className="border-b border-primary-100 bg-white px-4 py-4">
              {/* Region input + search */}
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="text"
                  value={browseRegion}
                  onChange={(e) => setBrowseRegion(e.target.value)}
                  placeholder="Região (ex: us-east-1)"
                  className={`${inputClass} max-w-[180px] font-mono`}
                />
                <button
                  type="button"
                  onClick={fetchBedrockAgents}
                  disabled={browseLoading}
                  className="flex items-center gap-1.5 px-3 py-2 bg-primary-500 text-white text-sm rounded hover:bg-primary-600 disabled:opacity-50 transition-colors"
                >
                  {browseLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Buscar
                </button>
                {browseAgents.length > 0 && !selectedBrowseAgent && (
                  <button
                    type="button"
                    onClick={fetchBedrockAgents}
                    className="p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded transition-colors"
                    title="Recarregar"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
              </div>

              {browseError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
                  {browseError}
                </p>
              )}

              {/* Agent list */}
              {!selectedBrowseAgent && browseAgents.length > 0 && (
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  <p className="text-xs text-neutral-500 mb-1.5 font-medium">
                    {browseAgents.length} agente{browseAgents.length !== 1 ? 's' : ''} encontrado{browseAgents.length !== 1 ? 's' : ''} — clique para ver os aliases
                  </p>
                  {browseAgents.map((a) => (
                    <button
                      key={a.agentId}
                      type="button"
                      onClick={() => selectBrowseAgent(a)}
                      className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded border border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 transition-colors group"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-neutral-800">{a.agentName}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase ${statusColor(a.agentStatus)}`}>
                            {a.agentStatus}
                          </span>
                        </div>
                        <span className="text-xs text-neutral-400 font-mono">{a.agentId}</span>
                        {a.description && (
                          <p className="text-xs text-neutral-400 truncate mt-0.5">{a.description}</p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-primary-400 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {/* Alias list */}
              {selectedBrowseAgent && (
                <div>
                  <button
                    type="button"
                    onClick={() => { setSelectedBrowseAgent(null); setBrowseAliases([]) }}
                    className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 mb-3 font-medium"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Voltar para agentes
                  </button>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-neutral-800">{selectedBrowseAgent.agentName}</span>
                    <span className="text-xs text-neutral-400 font-mono">{selectedBrowseAgent.agentId}</span>
                  </div>

                  {aliasLoading ? (
                    <div className="flex items-center gap-2 text-neutral-400 text-sm py-3">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Carregando aliases…
                    </div>
                  ) : browseAliases.length === 0 ? (
                    <p className="text-xs text-neutral-400 py-2">Nenhum alias encontrado para este agente.</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      <p className="text-xs text-neutral-500 mb-1.5 font-medium">
                        {browseAliases.length} alias{browseAliases.length !== 1 ? 'es' : ''} — clique para importar
                      </p>
                      {browseAliases.map((alias) => (
                        <button
                          key={alias.aliasId}
                          type="button"
                          onClick={() => importAlias(alias)}
                          className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded border border-neutral-200 hover:border-green-300 hover:bg-green-50/50 transition-colors group"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-neutral-800">{alias.aliasName}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase ${statusColor(alias.aliasStatus)}`}>
                                {alias.aliasStatus}
                              </span>
                            </div>
                            <span className="text-xs text-neutral-400 font-mono">{alias.aliasId}</span>
                            {alias.description && (
                              <p className="text-xs text-neutral-400 truncate mt-0.5">{alias.description}</p>
                            )}
                          </div>
                          <span className="text-xs text-green-600 font-medium opacity-0 group-hover:opacity-100 flex-shrink-0">
                            Importar →
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Form fields */}
          <form onSubmit={handleSubmit} className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Nome *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputClass}
                  placeholder="Ex: Agente Geral TN"
                  required
                />
              </div>
              <div>
                <label className={labelClass}>Região AWS</label>
                <input
                  type="text"
                  value={form.region}
                  onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                  className={monoInputClass}
                  placeholder="us-east-1"
                />
              </div>
              <div>
                <label className={labelClass}>Agent ID *</label>
                <input
                  type="text"
                  value={form.agentId}
                  onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}
                  className={monoInputClass}
                  placeholder="AAYYDRTVTV"
                  required
                />
              </div>
              <div>
                <label className={labelClass}>Agent Alias ID *</label>
                <input
                  type="text"
                  value={form.agentAliasId}
                  onChange={(e) => setForm((f) => ({ ...f, agentAliasId: e.target.value }))}
                  className={monoInputClass}
                  placeholder="GHVFECZ0X5"
                  required
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Descrição</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className={inputClass}
                placeholder="Descrição opcional para os usuários"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                className="rounded border-neutral-300 text-primary-500"
              />
              <span className="text-sm text-neutral-700">Definir como agente padrão nos chats</span>
            </label>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 bg-primary-500 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-primary-600 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                className="flex items-center gap-2 border border-neutral-300 text-neutral-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-neutral-50"
              >
                <X className="w-4 h-4" />
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista de agentes */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-neutral-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Carregando…
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-neutral-200 rounded-md">
          <p className="text-neutral-500 text-sm">Nenhum agente configurado.</p>
          <p className="text-neutral-400 text-xs mt-1">
            Clique em "Novo agente" para adicionar. Use "Buscar na AWS" para facilitar a configuração.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className={`border rounded-md p-4 flex items-start justify-between gap-4 ${
                agent.isDefault
                  ? 'border-primary-300 bg-primary-50'
                  : 'border-neutral-200 bg-white'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-neutral-900 text-sm">{agent.name}</span>
                  {agent.isDefault && (
                    <span className="flex items-center gap-1 text-xs text-primary-600 bg-primary-100 px-1.5 py-0.5 rounded-full">
                      <Star className="w-3 h-3" />
                      Padrão
                    </span>
                  )}
                </div>
                {agent.description && (
                  <p className="text-xs text-neutral-500 mt-0.5">{agent.description}</p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                  <span className="text-xs text-neutral-400 font-mono">ID: {agent.agentId}</span>
                  <span className="text-xs text-neutral-400 font-mono">Alias: {agent.agentAliasId}</span>
                  <span className="text-xs text-neutral-400">Região: {agent.region || 'us-east-1'}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {!agent.isDefault && (
                  <button
                    onClick={() => handleSetDefault(agent)}
                    title="Definir como padrão"
                    className="p-1.5 text-neutral-400 hover:text-primary-500 hover:bg-primary-50 rounded transition-colors"
                  >
                    <Star className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => openEdit(agent)}
                  title="Editar"
                  className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(agent)}
                  title="Remover"
                  className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                >
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
