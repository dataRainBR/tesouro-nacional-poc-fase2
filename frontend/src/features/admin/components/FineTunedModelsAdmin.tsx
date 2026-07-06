/**
 * CRUD de Modelos Fine-Tuned — Custom Models Bedrock ou endpoints SageMaker,
 * com fallback configurável para agente base e preço por token (dashboard de custos).
 */

import { useState, useEffect } from 'react'
import { Plus, Trash2, Loader2, X, PlayCircle, DollarSign } from 'lucide-react'
import { api } from '@/src/shared/services/api'
import type { FineTunedModel, FineTunedModelProvider, FineTunedInvokeResponse } from '@tesouro-nacional/shared'

interface AgentOption {
  id: string
  name: string
}

const PROVIDER_LABELS: Record<FineTunedModelProvider, string> = {
  'bedrock-custom-model': 'Bedrock Custom Model',
  'bedrock-provisioned': 'Bedrock Provisioned Throughput',
  'sagemaker-endpoint': 'SageMaker Endpoint',
}

export function FineTunedModelsAdmin() {
  const [models, setModels] = useState<FineTunedModel[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, FineTunedInvokeResponse | { error: string }>>({})

  const [form, setForm] = useState({
    name: '',
    description: '',
    provider: 'bedrock-custom-model' as FineTunedModelProvider,
    modelArn: '',
    region: 'us-east-1',
    fallbackAgentId: '',
    systemPrompt: '',
    pricePerThousandInputTokens: '',
    pricePerThousandOutputTokens: '',
  })

  const fetchAll = () => {
    setLoading(true)
    Promise.all([
      api.get<FineTunedModel[]>('/api/finetuned-models'),
      api.get<AgentOption[]>('/api/agents'),
    ])
      .then(([m, a]) => { setModels(m); setAgents(a) })
      .catch(() => { setModels([]); setAgents([]) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchAll() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.modelArn.trim()) {
      setError('Nome e ARN/ID do modelo são obrigatórios.')
      return
    }

    setError('')
    setSubmitting(true)
    try {
      await api.post('/api/finetuned-models', {
        ...form,
        fallbackAgentId: form.fallbackAgentId || undefined,
        systemPrompt: form.systemPrompt || undefined,
        pricePerThousandInputTokens: form.pricePerThousandInputTokens ? Number(form.pricePerThousandInputTokens) : undefined,
        pricePerThousandOutputTokens: form.pricePerThousandOutputTokens ? Number(form.pricePerThousandOutputTokens) : undefined,
        isActive: true,
      })
      setForm({
        name: '', description: '', provider: 'bedrock-custom-model', modelArn: '', region: 'us-east-1',
        fallbackAgentId: '', systemPrompt: '', pricePerThousandInputTokens: '', pricePerThousandOutputTokens: '',
      })
      setShowForm(false)
      fetchAll()
    } catch (err: any) {
      setError(err.message || 'Erro ao cadastrar modelo.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este modelo fine-tuned?')) return
    try {
      await api.delete(`/api/finetuned-models/${id}`)
      fetchAll()
    } catch (err: any) {
      console.error(err)
    }
  }

  const handleToggleActive = async (model: FineTunedModel) => {
    try {
      await api.put(`/api/finetuned-models/${model.id}`, { isActive: !model.isActive })
      fetchAll()
    } catch (err: any) {
      console.error(err)
    }
  }

  const handleTest = async (model: FineTunedModel) => {
    setTestingId(model.id)
    setTestResult((prev) => ({ ...prev, [model.id]: undefined as any }))
    try {
      const result = await api.post<FineTunedInvokeResponse>(`/api/finetuned-models/${model.id}/invoke`, {
        message: 'Olá! Isto é um teste de conectividade. Responda em uma frase curta.',
      })
      setTestResult((prev) => ({ ...prev, [model.id]: result }))
    } catch (err: any) {
      setTestResult((prev) => ({ ...prev, [model.id]: { error: err.message } }))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-neutral-500">
          Modelos customizados (fine-tuned) com fallback automático para agente base.
        </p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          <Plus className="w-3.5 h-3.5" />
          Novo modelo
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-neutral-200 rounded-lg p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-neutral-800">Novo Modelo Fine-Tuned</h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-neutral-400 hover:text-neutral-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Nome *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input-field w-full text-sm" placeholder="Ex: Parecerista TN v1.0" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Provider *</label>
              <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as FineTunedModelProvider })}
                className="input-field w-full text-sm">
                {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-neutral-500 block mb-1">Descrição</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-field w-full text-sm" placeholder="Descrição opcional" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">ARN / Model ID *</label>
              <input value={form.modelArn} onChange={(e) => setForm({ ...form, modelArn: e.target.value })}
                className="input-field w-full text-sm font-mono" placeholder="arn:aws:bedrock:..." />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Região</label>
              <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}
                className="input-field w-full text-sm" placeholder="us-east-1" />
            </div>
          </div>

          <div>
            <label className="text-xs text-neutral-500 block mb-1">Agente de fallback (opcional)</label>
            <select value={form.fallbackAgentId} onChange={(e) => setForm({ ...form, fallbackAgentId: e.target.value })}
              className="input-field w-full text-sm">
              <option value="">Nenhum</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <p className="text-[11px] text-neutral-400 mt-1">
              Se o modelo fine-tuned falhar ou não responder, a pergunta é roteada automaticamente para este agente.
            </p>
          </div>

          <div>
            <label className="text-xs text-neutral-500 block mb-1">System Prompt (opcional)</label>
            <textarea value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              rows={3} className="input-field w-full text-sm resize-none"
              placeholder="Modelos fine-tuned não têm orquestração de agente — defina aqui o comportamento esperado." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Preço / 1000 tokens input (USD)</label>
              <input type="number" step="0.0001" value={form.pricePerThousandInputTokens}
                onChange={(e) => setForm({ ...form, pricePerThousandInputTokens: e.target.value })}
                className="input-field w-full text-sm" placeholder="0.003" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Preço / 1000 tokens output (USD)</label>
              <input type="number" step="0.0001" value={form.pricePerThousandOutputTokens}
                onChange={(e) => setForm({ ...form, pricePerThousandOutputTokens: e.target.value })}
                className="input-field w-full text-sm" placeholder="0.015" />
            </div>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

          <button type="submit" disabled={submitting} className="btn-primary text-sm disabled:opacity-50">
            {submitting ? 'Salvando…' : 'Cadastrar modelo'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-neutral-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando…
        </div>
      ) : models.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">Nenhum modelo fine-tuned cadastrado.</p>
      ) : (
        <div className="space-y-2">
          {models.map((model) => {
            const result = testResult[model.id]
            const fallbackAgent = agents.find((a) => a.id === model.fallbackAgentId)

            return (
              <div key={model.id} className="border border-neutral-200 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-neutral-800">{model.name}</span>
                      <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                        {PROVIDER_LABELS[model.provider]}
                      </span>
                      {!model.isActive && (
                        <span className="text-[10px] bg-neutral-100 text-neutral-500 px-1.5 py-0.5 rounded font-medium">Inativo</span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 font-mono mt-0.5 truncate max-w-md">{model.modelArn}</p>
                    {fallbackAgent && (
                      <p className="text-[11px] text-neutral-400 mt-0.5">Fallback: {fallbackAgent.name}</p>
                    )}
                    {(model.pricePerThousandInputTokens || model.pricePerThousandOutputTokens) && (
                      <p className="text-[11px] text-neutral-400 mt-0.5 flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        {model.pricePerThousandInputTokens || 0}/1k in · {model.pricePerThousandOutputTokens || 0}/1k out
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleTest(model)} disabled={testingId === model.id} title="Testar conectividade"
                      className="p-1.5 text-neutral-400 hover:text-primary-500 rounded transition-colors disabled:opacity-50">
                      {testingId === model.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                    </button>
                    <button onClick={() => handleToggleActive(model)} title={model.isActive ? 'Desativar' : 'Ativar'}
                      className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                        model.isActive ? 'border-neutral-200 text-neutral-500 hover:bg-neutral-50' : 'border-green-200 text-green-600 hover:bg-green-50'
                      }`}>
                      {model.isActive ? 'Desativar' : 'Ativar'}
                    </button>
                    <button onClick={() => handleDelete(model.id)} title="Remover"
                      className="p-1.5 text-neutral-400 hover:text-red-500 rounded transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {result && (
                  'error' in result ? (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mt-2">{result.error}</p>
                  ) : (
                    <div className="text-xs bg-neutral-50 border border-neutral-200 rounded px-3 py-2 mt-2 space-y-1">
                      {result.usedFallback && (
                        <p className="text-amber-600 font-medium">⚠️ Fallback acionado: {result.fallbackReason}</p>
                      )}
                      <p className="text-neutral-700">{result.response}</p>
                      <p className="text-neutral-400">
                        {result.latencyMs}ms
                        {result.inputTokens != null && ` · ${result.inputTokens} in / ${result.outputTokens} out tokens`}
                        {result.estimatedCostUsd != null && ` · $${result.estimatedCostUsd.toFixed(6)}`}
                      </p>
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
