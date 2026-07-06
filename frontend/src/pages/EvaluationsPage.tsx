import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload, FileText, Play, CheckCircle2,
  Loader2, ChevronDown, ChevronUp, AlertCircle, FlaskConical,
  BarChart3, WifiOff, History, RefreshCw, RotateCcw,
  ArrowRight, Plus, Trash2,
} from 'lucide-react'
import { api } from '@/src/shared/services/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AgentOption {
  id: string
  name: string
  description?: string
  isDefault: boolean
  /** AWS Bedrock agentId — usado para buscar aliases disponíveis */
  agentId: string
  agentAliasId: string
  region?: string
}

interface AliasOption {
  aliasId: string
  aliasName: string
  aliasStatus: string
}

interface EvalQuestion {
  index: number
  question: string
  referenceResponse?: string
  category?: string
}

type JobStatus = 'pending' | 'running' | 'completed' | 'aborted'

interface EvalJob {
  jobId: string
  agentId: string
  agentName: string
  agentAliasId?: string
  agentAliasName?: string
  totalQuestions: number
  completedQuestions: number
  errorCount: number
  status: JobStatus
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Dataset padrão (perguntas + respostas de referência pré-carregadas)
// ---------------------------------------------------------------------------
const DEFAULT_QUESTIONS: EvalQuestion[] = []

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseFile(content: string, filename: string): EvalQuestion[] {
  const isJsonl = filename.endsWith('.jsonl') || content.trim().startsWith('{')
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
  const questions: EvalQuestion[] = []

  const extractQuestion = (obj: any): string | null => {
    if (typeof obj === 'string') return obj.trim()
    for (const key of ['question', 'prompt', 'input', 'text', 'pergunta', 'query', 'q']) {
      if (typeof obj[key] === 'string' && obj[key].trim()) return obj[key].trim()
    }
    return null
  }

  const extractReferenceResponse = (obj: any): string | undefined => {
    if (typeof obj !== 'object' || !obj) return undefined
    for (const key of ['referenceResponse', 'reference_response', 'reference', 'groundTruth', 'ground_truth', 'expected', 'resposta_referencia']) {
      if (typeof obj[key] === 'string' && obj[key].trim()) return obj[key].trim()
    }
    return undefined
  }

  const extractCategory = (obj: any): string | undefined => {
    if (typeof obj !== 'object' || !obj) return undefined
    for (const key of ['category', 'categoria']) {
      if (typeof obj[key] === 'string' && obj[key].trim()) return obj[key].trim()
    }
    return undefined
  }

  const pushQuestion = (obj: any) => {
    const q = extractQuestion(obj)
    if (!q) return
    questions.push({
      index: questions.length,
      question: q,
      referenceResponse: extractReferenceResponse(obj),
      category: extractCategory(obj),
    })
  }

  if (isJsonl) {
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        pushQuestion(obj)
      } catch {
        if (line.length > 0) questions.push({ index: questions.length, question: line })
      }
    }
    return questions
  }

  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      for (const item of parsed) pushQuestion(item)
    } else if (parsed && typeof parsed === 'object') {
      const arr = parsed.questions ?? parsed.prompts ?? parsed.inputs ?? parsed.data ?? parsed.items
      if (Array.isArray(arr)) {
        for (const item of arr) pushQuestion(item)
      } else {
        pushQuestion(parsed)
      }
    }
  } catch {
    for (const line of lines) {
      if (line.length > 0) questions.push({ index: questions.length, question: line })
    }
  }

  return questions
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}


// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function EvaluationsPage() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [aliases, setAliases] = useState<AliasOption[]>([])
  const [selectedAliasId, setSelectedAliasId] = useState<string>('')
  const [aliasesLoading, setAliasesLoading] = useState(false)
  const [modelIdentifier, setModelIdentifier] = useState<string>('')
  const [questions, setQuestions] = useState<EvalQuestion[]>(DEFAULT_QUESTIONS)
  const [selectedQuestions, setSelectedQuestions] = useState<Set<number>>(new Set())
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set())
  const [jobPage, setJobPage] = useState(0)
  const [deletingJobs, setDeletingJobs] = useState(false)
  const JOBS_PER_PAGE = 10
  const [filename, setFilename] = useState<string>('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [newQuestionText, setNewQuestionText] = useState('')
  const [newReferenceText, setNewReferenceText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Job list state
  const [recentJobs, setRecentJobs] = useState<EvalJob[]>([])
  const [starting, setStarting] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const fetchRecentJobs = useCallback(async () => {
    try {
      const jobs = await api.get<EvalJob[]>('/api/evaluations/jobs')
      setRecentJobs(jobs)
      const hasActive = jobs.some((j: EvalJob) => j.status === 'running' || j.status === 'pending')
      if (!hasActive) stopPolling()
      return jobs
    } catch {
      return null
    }
  }, [stopPolling])

  // -------------------------------------------------------------------------
  // Load agents + recent jobs, polling while there are active jobs
  // -------------------------------------------------------------------------
  useEffect(() => {
    api.get<AgentOption[]>('/api/agents').then((data: AgentOption[]) => {
      setAgents(data)
      const def = data.find((a: AgentOption) => a.isDefault) ?? data[0]
      if (def) setSelectedAgentId(def.id)
    }).catch(() => {})

    fetchRecentJobs().then((jobs) => {
      if (jobs?.some((j) => j.status === 'running' || j.status === 'pending')) {
        pollingRef.current = setInterval(fetchRecentJobs, 5_000)
      }
    })

    return () => stopPolling()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Busca aliases disponíveis na AWS para o agente selecionado
  useEffect(() => {
    if (!selectedAgentId) return
    const agent = agents.find((a) => a.id === selectedAgentId)
    if (!agent) return

    setAliases([])
    setSelectedAliasId(agent.agentAliasId) // padrão = alias armazenado
    setAliasesLoading(true)

    const qs = agent.region ? `?region=${encodeURIComponent(agent.region)}` : ''
    api.get<AliasOption[]>(`/api/agents/bedrock/${agent.agentId}/aliases${qs}`)
      .then((data: AliasOption[]) => {
        setAliases(data)
        // Mantém o alias armazenado selecionado se estiver na lista
        const stored = data.find((a: AliasOption) => a.aliasId === agent.agentAliasId)
        setSelectedAliasId(stored ? stored.aliasId : (data[0]?.aliasId ?? agent.agentAliasId))
      })
      .catch(() => {
        // Se não conseguir listar (sem permissão na conta de dev), usa o alias armazenado
        setSelectedAliasId(agent.agentAliasId)
      })
      .finally(() => setAliasesLoading(false))
  }, [selectedAgentId, agents])

  // -------------------------------------------------------------------------
  // File handling
  // -------------------------------------------------------------------------
  const handleFile = useCallback((file: File) => {
    setParseError(null)
    setFilename(file.name)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const parsed = parseFile(content, file.name)
        if (parsed.length === 0) {
          setParseError(
            'Nenhuma pergunta encontrada. Certifique-se de que o arquivo contém um campo "question", "prompt", "input" ou "text".'
          )
          return
        }
        setQuestions(parsed)
        setShowUpload(false)
      } catch (err: any) {
        setParseError(`Erro ao processar o arquivo: ${err.message}`)
      }
    }
    reader.readAsText(file, 'utf-8')
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  // -------------------------------------------------------------------------
  // Start evaluation — cria o job e enfileira no backend
  // -------------------------------------------------------------------------
  const runEvaluation = async () => {
    if (!questions.length || !selectedAgentId || starting) return
    setStarting(true)

    try {
      const { jobId: newJobId } = await api.post<{ jobId: string }>(
        '/api/evaluations/batch',
        {
          questions: questions.map((q) => ({
            question: q.question,
            referenceResponse: q.referenceResponse || '',
            category: q.category || 'model-inference',
          })),
          agentId: selectedAgentId,
          agentAliasId: selectedAliasId || undefined,
          agentAliasName: aliases.find((a) => a.aliasId === selectedAliasId)?.aliasName,
          modelIdentifier: modelIdentifier.trim() || undefined,
        }
      )

      navigate(`/avaliacoes/${newJobId}`)
    } catch (err: any) {
      setParseError(err.message || 'Erro ao iniciar avaliação.')
    } finally {
      setStarting(false)
    }
  }

  // -------------------------------------------------------------------------
  // Load historical job — navigate to detail page
  // -------------------------------------------------------------------------
  const loadJob = (id: string) => {
    navigate(`/avaliacoes/${id}`)
  }

  // -------------------------------------------------------------------------
  // Reset question list
  // -------------------------------------------------------------------------
  const reset = () => {
    setQuestions(DEFAULT_QUESTIONS)
    setSelectedQuestions(new Set())
    setFilename('')
    setParseError(null)
    setShowUpload(false)
    setAddingQuestion(false)
    setNewQuestionText('')
    setNewReferenceText('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeQuestion = (index: number) => {
    setQuestions((prev) => {
      const filtered = prev.filter((q) => q.index !== index)
      return filtered.map((q, i) => ({ ...q, index: i }))
    })
  }

  const addQuestion = () => {
    const text = newQuestionText.trim()
    if (!text) return
    setQuestions((prev) => [...prev, {
      index: prev.length,
      question: text,
      referenceResponse: newReferenceText.trim() || undefined,
      category: 'model-inference',
    }])
    setNewQuestionText('')
    setNewReferenceText('')
    setAddingQuestion(false)
  }

  const deleteSelectedQuestions = () => {
    setQuestions((prev) => {
      const filtered = prev.filter((q) => !selectedQuestions.has(q.index))
      return filtered.map((q, i) => ({ ...q, index: i }))
    })
    setSelectedQuestions(new Set())
  }

  const toggleQuestion = (index: number) => {
    setSelectedQuestions((prev) => {
      const next = new Set(prev)
      next.has(index) ? next.delete(index) : next.add(index)
      return next
    })
  }

  const toggleAllQuestions = () => {
    if (selectedQuestions.size === questions.length) {
      setSelectedQuestions(new Set())
    } else {
      setSelectedQuestions(new Set(questions.map((q) => q.index)))
    }
  }

  const pagedJobs = recentJobs.slice(jobPage * JOBS_PER_PAGE, (jobPage + 1) * JOBS_PER_PAGE)
  const totalJobPages = Math.ceil(recentJobs.length / JOBS_PER_PAGE)

  const toggleJob = (jobId: string) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev)
      next.has(jobId) ? next.delete(jobId) : next.add(jobId)
      return next
    })
  }

  const toggleAllPageJobs = () => {
    const pageIds = pagedJobs.map((j) => j.jobId)
    const allSelected = pageIds.every((id) => selectedJobs.has(id))
    setSelectedJobs((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id))
      } else {
        pageIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const deleteSelectedJobs = async () => {
    if (!selectedJobs.size || deletingJobs) return
    setDeletingJobs(true)
    try {
      await Promise.all(
        Array.from(selectedJobs).map((id) =>
          api.delete(`/api/evaluations/jobs/${id}?force=true`)
        )
      )
      setRecentJobs((prev) => prev.filter((j) => !selectedJobs.has(j.jobId)))
      setSelectedJobs(new Set())
      // Ajusta página se ficar vazia
      setJobPage((p) => {
        const remaining = recentJobs.length - selectedJobs.size
        const newTotal = Math.ceil(remaining / JOBS_PER_PAGE)
        return Math.max(0, Math.min(p, newTotal - 1))
      })
    } catch (err: any) {
      console.error('Erro ao excluir avaliações:', err.message)
    } finally {
      setDeletingJobs(false)
    }
  }

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {/* Page header */}
      <div className="bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center">
                <FlaskConical className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-neutral-900">Avaliações</h1>
                <p className="text-sm text-neutral-500">
                  Envie um conjunto de perguntas e avalie as respostas do modelo
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">

        <div className="space-y-6">

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Left: question manager */}
              <div className="lg:col-span-2 space-y-4">
                <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
                  {/* Header */}
                  <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={questions.length > 0 && selectedQuestions.size === questions.length}
                        ref={(el) => { if (el) el.indeterminate = selectedQuestions.size > 0 && selectedQuestions.size < questions.length }}
                        onChange={toggleAllQuestions}
                        className="rounded border-neutral-300 text-primary-500 cursor-pointer"
                        title="Selecionar todas"
                      />
                      <h2 className="text-sm font-semibold text-neutral-700 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-neutral-400" />
                        Perguntas
                        <span className="text-xs font-normal text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded-full">
                          {questions.length}
                        </span>
                      </h2>
                      {selectedQuestions.size > 0 && (
                        <button
                          onClick={deleteSelectedQuestions}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Excluir {selectedQuestions.size}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={reset}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"
                        title="Limpar todas as perguntas"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Limpar
                      </button>
                      <button
                        onClick={() => { setAddingQuestion(true); setNewQuestionText('') }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Adicionar questão
                      </button>
                    </div>
                  </div>

                  {/* Add question form */}
                  {addingQuestion && (
                    <div className="px-6 py-4 border-b border-neutral-100 bg-primary-50/40 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-neutral-600 mb-1.5">
                          Pergunta <span className="text-red-400">*</span>
                        </label>
                        <textarea
                          autoFocus
                          value={newQuestionText}
                          onChange={(e) => setNewQuestionText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addQuestion()
                            if (e.key === 'Escape') { setAddingQuestion(false); setNewQuestionText(''); setNewReferenceText('') }
                          }}
                          rows={3}
                          placeholder="Digite a nova questão…"
                          className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2.5 bg-white text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none leading-relaxed"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-600 mb-1.5">
                          Resposta de referência <span className="text-neutral-400">(opcional — usada na avaliação do modelo)</span>
                        </label>
                        <textarea
                          value={newReferenceText}
                          onChange={(e) => setNewReferenceText(e.target.value)}
                          rows={2}
                          placeholder="Resposta esperada / gabarito…"
                          className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2.5 bg-white text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none leading-relaxed"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={addQuestion}
                          disabled={!newQuestionText.trim()}
                          className="px-3 py-1.5 text-xs font-medium bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors disabled:opacity-40"
                        >
                          Salvar
                        </button>
                        <button
                          onClick={() => { setAddingQuestion(false); setNewQuestionText(''); setNewReferenceText('') }}
                          className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
                        >
                          Cancelar
                        </button>
                        <span className="text-xs text-neutral-400 ml-auto">⌘+Enter para salvar · Esc para cancelar</span>
                      </div>
                    </div>
                  )}

                  {/* Question list */}
                  {questions.length === 0 ? (
                    <div className="px-6 py-12 text-center text-sm text-neutral-400">
                      Nenhuma pergunta. Clique em "Adicionar questão" ou carregue um arquivo abaixo.
                    </div>
                  ) : (
                    <div className="overflow-y-auto max-h-[520px] divide-y divide-neutral-50">
                      {questions.map((q) => (
                        <div
                          key={q.index}
                          className={`px-6 py-3 flex items-start gap-3 group hover:bg-neutral-50 transition-colors ${selectedQuestions.has(q.index) ? 'bg-primary-50/40' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedQuestions.has(q.index)}
                            onChange={() => toggleQuestion(q.index)}
                            className="mt-1 rounded border-neutral-300 text-primary-500 cursor-pointer flex-shrink-0"
                          />
                          <span className="w-6 h-6 rounded-md bg-neutral-100 text-neutral-400 text-xs flex items-center justify-center font-mono flex-shrink-0 mt-0.5">
                            {q.index + 1}
                          </span>
                          <p className="text-sm text-neutral-700 leading-relaxed flex-1">
                            {q.question}
                          </p>
                          <button
                            onClick={() => removeQuestion(q.index)}
                            className="flex-shrink-0 p-1 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100 mt-0.5"
                            title="Remover pergunta"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Collapsible upload section */}
                  <div className="border-t border-neutral-100">
                    <button
                      onClick={() => setShowUpload((v) => !v)}
                      className="w-full flex items-center gap-2 px-6 py-3 text-xs font-medium text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Substituir dataset por arquivo
                      {showUpload ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
                    </button>

                    {showUpload && (
                      <div className="px-6 pb-5">
                        <div
                          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                          onDragLeave={() => setIsDragging(false)}
                          onDrop={handleDrop}
                          onClick={() => fileInputRef.current?.click()}
                          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-all py-7 ${
                            isDragging ? 'border-primary-400 bg-primary-50' : 'border-neutral-200 bg-neutral-50 hover:border-primary-300 hover:bg-primary-50/40'
                          }`}
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,.jsonl"
                            className="hidden"
                            onChange={handleInputChange}
                          />
                          <Upload className={`w-7 h-7 ${isDragging ? 'text-primary-500' : 'text-neutral-300'}`} />
                          <div className="text-center">
                            <p className="text-sm font-medium text-neutral-600">Arraste ou clique para selecionar</p>
                            <p className="text-xs text-neutral-400 mt-0.5">JSON ou JSONL — substitui todas as perguntas acima</p>
                          </div>
                        </div>
                        {filename && (
                          <p className="text-xs text-neutral-500 mt-2 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                            {filename} carregado
                          </p>
                        )}
                        {parseError && (
                          <div className="mt-2 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            {parseError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: config */}
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-neutral-200 shadow-sm">
                  <div className="px-5 py-4 border-b border-neutral-100">
                    <h2 className="text-sm font-semibold text-neutral-700 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-neutral-400" />
                      Configuração
                    </h2>
                  </div>
                  <div className="p-5 space-y-4">
                    {/* Agent selector */}
                    <div>
                      <label className="block text-xs font-medium text-neutral-600 mb-1.5">
                        Agente
                      </label>
                      {agents.length === 0 ? (
                        <div className="text-sm text-neutral-400 bg-neutral-50 rounded-lg p-3 border border-neutral-200">
                          Nenhum agente configurado.{' '}
                          <a href="/configuracoes" className="text-primary-600 hover:underline">
                            Configurar agentes →
                          </a>
                        </div>
                      ) : (
                        <select
                          value={selectedAgentId}
                          onChange={(e) => setSelectedAgentId(e.target.value)}
                          className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2.5 bg-white text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
                        >
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}{a.isDefault ? ' (padrão)' : ''}
                            </option>
                          ))}
                        </select>
                      )}
                      {selectedAgent?.description && (
                        <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">
                          {selectedAgent.description}
                        </p>
                      )}
                    </div>

                    {/* Alias selector */}
                    {selectedAgentId && agents.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-xs font-medium text-neutral-600">
                            Alias
                          </label>
                          {aliasesLoading && (
                            <span className="flex items-center gap-1 text-xs text-neutral-400">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Carregando…
                            </span>
                          )}
                          {!aliasesLoading && aliases.length > 0 && (
                            <span className="text-xs text-neutral-400">{aliases.length} disponíveis</span>
                          )}
                        </div>

                        {aliases.length > 0 ? (
                          <select
                            value={selectedAliasId}
                            onChange={(e) => setSelectedAliasId(e.target.value)}
                            className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2.5 bg-white text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent font-mono"
                          >
                            {aliases.map((a) => (
                              <option key={a.aliasId} value={a.aliasId}>
                                {a.aliasName}
                                {a.aliasId === selectedAgent?.agentAliasId ? ' (padrão)' : ''}
                                {' — '}{a.aliasId}
                              </option>
                            ))}
                          </select>
                        ) : !aliasesLoading ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={selectedAliasId}
                              onChange={(e) => setSelectedAliasId(e.target.value)}
                              className="flex-1 text-sm border border-neutral-200 rounded-lg px-3 py-2 bg-white text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-400 font-mono"
                              placeholder="Alias ID"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const a = agents.find((x) => x.id === selectedAgentId)
                                if (!a) return
                                const qs = a.region ? `?region=${encodeURIComponent(a.region)}` : ''
                                setAliasesLoading(true)
                                api.get<AliasOption[]>(`/api/agents/bedrock/${a.agentId}/aliases${qs}`)
                                  .then(setAliases).catch(() => {}).finally(() => setAliasesLoading(false))
                              }}
                              className="p-2 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-lg border border-neutral-200 transition-colors"
                              title="Recarregar aliases"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          </div>
                        ) : null}

                        {selectedAliasId && (
                          <p className="text-xs text-neutral-400 mt-1 font-mono truncate">
                            {selectedAliasId}
                          </p>
                        )}
                      </div>
                    )}

                    {/* modelIdentifier */}
                    <div>
                      <label className="block text-xs font-medium text-neutral-600 mb-1.5">
                        Model Identifier <span className="text-neutral-400">(JSONL)</span>
                      </label>
                      <input
                        type="text"
                        value={modelIdentifier}
                        onChange={(e) => setModelIdentifier(e.target.value)}
                        placeholder="Ex: claude-opus-4-5-supervisor-v1"
                        className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 bg-white text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent font-mono"
                      />
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        Identificador usado no campo <code className="bg-neutral-100 px-1 rounded">modelIdentifier</code> do JSONL. Se vazio, usa o nome do agente.
                      </p>
                    </div>

                    <div className="bg-neutral-50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-neutral-500">Perguntas</span>
                        <span className="font-semibold text-neutral-800">
                          {questions.length > 0 ? questions.length : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-neutral-500">Execução</span>
                        <span className="font-semibold text-neutral-800">Segundo plano</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-neutral-500">Sessão</span>
                        <span className="font-semibold text-neutral-800">Por pergunta</span>
                      </div>
                    </div>

                    <button
                      onClick={runEvaluation}
                      disabled={questions.length === 0 || !selectedAgentId || agents.length === 0 || starting}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {starting
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Play className="w-4 h-4" />
                      }
                      {starting ? 'Iniciando…' : 'Iniciar Avaliação'}
                    </button>
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-xs text-green-800 space-y-1.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <WifiOff className="w-3.5 h-3.5" /> Execução em segundo plano
                  </p>
                  <ul className="space-y-1 text-green-700">
                    <li>• Pode sair da tela sem interromper</li>
                    <li>• O progresso é salvo no servidor</li>
                    <li>• Ao retornar, o status é restaurado</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Recent jobs */}
            {recentJobs.length > 0 && (
              <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={pagedJobs.length > 0 && pagedJobs.every((j) => selectedJobs.has(j.jobId))}
                      ref={(el) => {
                        if (el) {
                          const someSelected = pagedJobs.some((j) => selectedJobs.has(j.jobId))
                          const allSelected = pagedJobs.every((j) => selectedJobs.has(j.jobId))
                          el.indeterminate = someSelected && !allSelected
                        }
                      }}
                      onChange={toggleAllPageJobs}
                      className="rounded border-neutral-300 text-primary-500 cursor-pointer"
                      title="Selecionar todos desta página"
                    />
                    <History className="w-4 h-4 text-neutral-400" />
                    <h2 className="text-sm font-semibold text-neutral-700">Histórico de avaliações</h2>
                    <span className="text-xs text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded-full">
                      {recentJobs.length}
                    </span>
                    {selectedJobs.size > 0 && (
                      <button
                        onClick={deleteSelectedJobs}
                        disabled={deletingJobs}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {deletingJobs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        Excluir {selectedJobs.size}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {totalJobPages > 1 && (
                      <div className="flex items-center gap-1 text-xs text-neutral-500">
                        <button
                          onClick={() => setJobPage((p) => Math.max(0, p - 1))}
                          disabled={jobPage === 0}
                          className="px-2 py-1 rounded border border-neutral-200 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          ‹
                        </button>
                        <span className="px-2">{jobPage + 1} / {totalJobPages}</span>
                        <button
                          onClick={() => setJobPage((p) => Math.min(totalJobPages - 1, p + 1))}
                          disabled={jobPage >= totalJobPages - 1}
                          className="px-2 py-1 rounded border border-neutral-200 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          ›
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => fetchRecentJobs().then((jobs) => {
                        if (jobs?.some((j) => j.status === 'running' || j.status === 'pending') && !pollingRef.current) {
                          pollingRef.current = setInterval(fetchRecentJobs, 5_000)
                        }
                      })}
                      className="p-1.5 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded transition-colors"
                      title="Atualizar lista"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="divide-y divide-neutral-50">
                  {pagedJobs.map((j) => {
                    const pct = j.totalQuestions > 0
                      ? Math.round((j.completedQuestions / j.totalQuestions) * 100)
                      : 0
                    const isActive = j.status === 'running' || j.status === 'pending'
                    const currentAgentName = agents.find((a) => a.id === j.agentId)?.name || j.agentName
                    return (
                      <div key={j.jobId} className={`px-6 py-3.5 flex items-center gap-4 hover:bg-neutral-50 transition-colors ${selectedJobs.has(j.jobId) ? 'bg-primary-50/40' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedJobs.has(j.jobId)}
                          onChange={() => toggleJob(j.jobId)}
                          className="rounded border-neutral-300 text-primary-500 cursor-pointer flex-shrink-0"
                        />
                        {/* Progress ring indicator */}
                        <div className="flex-shrink-0 w-10 h-10 relative flex items-center justify-center">
                          <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                            <circle cx="18" cy="18" r="14" fill="none" stroke="#f3f4f6" strokeWidth="3" />
                            <circle
                              cx="18" cy="18" r="14" fill="none"
                              stroke={j.status === 'completed' ? '#22c55e' : j.status === 'aborted' ? '#f59e0b' : '#6366f1'}
                              strokeWidth="3"
                              strokeDasharray={`${pct * 0.88} 88`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <span className="absolute text-[9px] font-bold text-neutral-600">{pct}%</span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-neutral-800 truncate">
                              {currentAgentName}{j.agentAliasName ? ` — ${j.agentAliasName}` : ''}
                            </span>
                            <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                              j.status === 'completed' ? 'bg-green-100 text-green-700'
                                : isActive ? 'bg-primary-100 text-primary-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              {j.status === 'completed' ? 'Concluído'
                                : isActive ? 'Em andamento'
                                : 'Interrompido'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-neutral-400">{fmtDate(j.createdAt)}</span>
                            <span className="text-xs text-neutral-400">
                              {j.completedQuestions}/{j.totalQuestions} perguntas
                              {j.errorCount > 0 && (
                                <span className="text-red-400"> · {j.errorCount} erro{j.errorCount !== 1 ? 's' : ''}</span>
                              )}
                            </span>
                            {isActive && j.completedQuestions < j.totalQuestions && (
                              <span className="text-xs text-primary-500 flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                pergunta #{j.completedQuestions + 1}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => loadJob(j.jobId)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                            title={isActive ? 'Ver progresso' : 'Ver resultados'}
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                            {isActive ? 'Acompanhar' : 'Ver'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Footer: cross-page select-all + pagination */}
                {(totalJobPages > 1 || selectedJobs.size > 0) && (
                  <div className="px-6 py-3 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500">
                    <div className="flex items-center gap-3">
                      {totalJobPages > 1 && selectedJobs.size === pagedJobs.filter((j) => selectedJobs.has(j.jobId)).length && selectedJobs.size > 0 && selectedJobs.size < recentJobs.length && (
                        <button
                          onClick={() => setSelectedJobs(new Set(recentJobs.map((j) => j.jobId)))}
                          className="text-primary-600 hover:underline"
                        >
                          Selecionar todas as {recentJobs.length} avaliações
                        </button>
                      )}
                      {selectedJobs.size === recentJobs.length && recentJobs.length > 0 && (
                        <button
                          onClick={() => setSelectedJobs(new Set())}
                          className="text-neutral-500 hover:underline"
                        >
                          Limpar seleção
                        </button>
                      )}
                    </div>
                    {totalJobPages > 1 && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setJobPage(0)}
                          disabled={jobPage === 0}
                          className="px-2 py-1 rounded hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          «
                        </button>
                        <button
                          onClick={() => setJobPage((p) => Math.max(0, p - 1))}
                          disabled={jobPage === 0}
                          className="px-2 py-1 rounded hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          ‹
                        </button>
                        <span className="px-3">{jobPage + 1} / {totalJobPages}</span>
                        <button
                          onClick={() => setJobPage((p) => Math.min(totalJobPages - 1, p + 1))}
                          disabled={jobPage >= totalJobPages - 1}
                          className="px-2 py-1 rounded hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          ›
                        </button>
                        <button
                          onClick={() => setJobPage(totalJobPages - 1)}
                          disabled={jobPage >= totalJobPages - 1}
                          className="px-2 py-1 rounded hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          »
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
        </div>

      </div>
    </>
  )
}
