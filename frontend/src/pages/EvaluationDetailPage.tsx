import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Download, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp,
  AlertCircle, FlaskConical, RotateCcw, Clock, Zap, X, WifiOff,
  UploadCloud, ArrowLeft, Copy, Check, Filter, ThumbsUp, ThumbsDown,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '@/src/shared/services/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type QuestionStatus = 'pending' | 'running' | 'done' | 'error'
type JobStatus = 'pending' | 'running' | 'completed' | 'aborted'
type FeedbackVote = 'up' | 'down'

interface EvalJob {
  jobId: string
  agentId: string
  agentName: string
  agentAliasId?: string
  agentAliasName?: string
  modelIdentifier?: string
  totalQuestions: number
  completedQuestions: number
  errorCount: number
  status: JobStatus
  createdAt: string
  updatedAt: string
}

interface EvalResult {
  jobId: string
  questionIndex: number
  question: string
  referenceResponse?: string | null
  category?: string | null
  answer: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  status: QuestionStatus
  error: string | null
}

interface EvalFeedback {
  jobId: string
  questionIndex: number
  vote: FeedbackVote
  comment?: string
  userId: string
  createdAt: string
  updatedAt: string
}

interface ThumbsDownModal {
  questionIndex: number
  comment: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtMs(ms: number | null) {
  if (ms === null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function fmtNum(n: number | null) {
  if (n === null) return '—'
  return n.toLocaleString('pt-BR')
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function buildJsonl(job: EvalJob, results: EvalResult[]): string {
  const modelIdentifier = job.modelIdentifier || [job.agentName, job.agentAliasName].filter(Boolean).join(' — ')
  return results
    .filter((r) => r.status === 'done' && r.answer)
    .map((r) => JSON.stringify({
      prompt: r.question,
      referenceResponse: r.referenceResponse || '',
      category: r.category || 'model-inference',
      modelResponses: [{ response: r.answer!, modelIdentifier }],
    }))
    .join('\n')
}

function computeStats(results: EvalResult[]) {
  const done = results.filter((r) => r.status === 'done' || r.status === 'error').length
  const errors = results.filter((r) => r.status === 'error').length
  const doneOk = results.filter((r) => r.status === 'done')
  const avgLatency = doneOk.length > 0
    ? Math.round(doneOk.reduce((s, r) => s + (r.latencyMs ?? 0), 0) / doneOk.length)
    : null
  const totalTokensIn = results.filter((r) => r.inputTokens !== null).reduce((s, r) => s + r.inputTokens!, 0)
  const totalTokensOut = results.filter((r) => r.outputTokens !== null).reduce((s, r) => s + r.outputTokens!, 0)
  return { done, errors, avgLatency, totalTokensIn, totalTokensOut }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function StatusIcon({ status }: { status: QuestionStatus }) {
  if (status === 'pending')
    return <span className="w-5 h-5 rounded-full border-2 border-neutral-300 inline-block flex-shrink-0" />
  if (status === 'running')
    return <Loader2 className="w-5 h-5 text-primary-500 animate-spin flex-shrink-0" />
  if (status === 'done')
    return <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
  return <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
}

function StatCard({
  icon: Icon, label, value, color = 'primary', active = false, onClick,
}: {
  icon: any; label: string; value: string; color?: 'primary' | 'green' | 'amber' | 'red'
  active?: boolean; onClick?: () => void
}) {
  const colors = {
    primary: 'bg-primary-50 text-primary-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  }
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`bg-white rounded-xl border p-5 flex items-center gap-4 shadow-sm text-left w-full transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      } ${active ? 'border-primary-400 ring-2 ring-primary-200' : 'border-neutral-200'}`}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-neutral-500 font-medium uppercase tracking-wide flex items-center gap-1">
          {label}
          {onClick && <Filter className="w-3 h-3 opacity-40" />}
        </p>
        <p className="text-xl font-bold text-neutral-900 leading-tight mt-0.5">{value}</p>
      </div>
    </Tag>
  )
}

const POLL_INTERVAL_MS = 5_000

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function EvaluationDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()

  const [job, setJob] = useState<EvalJob | null>(null)
  const [results, setResults] = useState<EvalResult[]>([])
  const [feedbacks, setFeedbacks] = useState<Record<number, EvalFeedback>>({})
  const [thumbsDownModal, setThumbsDownModal] = useState<ThumbsDownModal | null>(null)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState<number | null>(null)
  const [expandedResult, setExpandedResult] = useState<number | null>(null)
  const [s3Exporting, setS3Exporting] = useState(false)
  const [s3Result, setS3Result] = useState<{ s3Url: string; lines: number } | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [filter, setFilter] = useState<'all' | 'done' | 'error'>('all')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const fetchJobStatus = useCallback(async () => {
    if (!jobId) return
    try {
      const data = await api.get<{ job: EvalJob; results: EvalResult[]; feedbacks: EvalFeedback[] }>(
        `/api/evaluations/jobs/${jobId}`
      )
      setJob(data.job)
      setResults(data.results)
      const feedbackMap: Record<number, EvalFeedback> = {}
      for (const fb of data.feedbacks ?? []) {
        feedbackMap[fb.questionIndex] = fb
      }
      setFeedbacks(feedbackMap)
      if (data.job.status === 'completed' || data.job.status === 'aborted') {
        stopPolling()
      }
    } catch (err: any) {
      if (err?.status === 404 || err?.message?.includes('404')) {
        setNotFound(true)
        stopPolling()
      }
    }
  }, [jobId, stopPolling])

  const submitFeedback = useCallback(async (questionIndex: number, vote: FeedbackVote, comment?: string) => {
    if (!jobId) return
    setFeedbackSubmitting(questionIndex)
    try {
      const fb = await api.post<EvalFeedback>(
        `/api/evaluations/jobs/${jobId}/results/${questionIndex}/feedback`,
        { vote, comment }
      )
      setFeedbacks((prev) => ({ ...prev, [questionIndex]: fb }))
    } catch (err: any) {
      console.error('feedback error:', err.message)
    } finally {
      setFeedbackSubmitting(null)
    }
  }, [jobId])

  useEffect(() => {
    void fetchJobStatus()
    pollingRef.current = setInterval(fetchJobStatus, POLL_INTERVAL_MS)
    return () => stopPolling()
  }, [fetchJobStatus, stopPolling])

  // Stop polling when job is done
  useEffect(() => {
    if (job && (job.status === 'completed' || job.status === 'aborted')) {
      stopPolling()
    }
  }, [job, stopPolling])

  const abortJob = async () => {
    if (!jobId) return
    try {
      await api.delete(`/api/evaluations/jobs/${jobId}`)
      stopPolling()
      await fetchJobStatus()
    } catch (err: any) {
      console.error('abort error:', err.message)
    }
  }

  const exportToS3 = async () => {
    if (!jobId || s3Exporting) return
    setS3Exporting(true)
    setS3Result(null)
    try {
      const data = await api.post<{ s3Url: string; lines: number }>(
        `/api/evaluations/jobs/${jobId}/export`
      )
      setS3Result(data)
    } catch (err: any) {
      alert(err.message || 'Erro ao exportar para S3.')
    } finally {
      setS3Exporting(false)
    }
  }

  const downloadJsonl = () => {
    if (!job) return
    const content = buildJsonl(job, results)
    const blob = new Blob([content], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `evaluation_${job.jobId.slice(0, 8)}_${job.createdAt.slice(0, 10)}.jsonl`
    a.click()
    URL.revokeObjectURL(url)
  }

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------
  const { done, errors, avgLatency, totalTokensIn, totalTokensOut } = computeStats(results)
  const total = job?.totalQuestions ?? results.length
  const progress = total > 0 ? Math.round((done / total) * 100) : 0
  const isRunning = job?.status === 'running' || job?.status === 'pending'
  const isCompleted = job?.status === 'completed' || job?.status === 'aborted'

  // -------------------------------------------------------------------------
  // Render — not found
  // -------------------------------------------------------------------------
  if (notFound) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-16 text-center">
        <AlertCircle className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
        <p className="text-neutral-500 mb-4">Avaliação não encontrada.</p>
        <button
          onClick={() => navigate('/avaliacoes')}
          className="flex items-center gap-2 mx-auto px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Avaliações
        </button>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render — loading
  // -------------------------------------------------------------------------
  if (!job) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-16 flex items-center justify-center gap-3 text-neutral-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Carregando avaliação…</span>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {/* Page header */}
      <div className="bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/avaliacoes')}
              className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Avaliações
            </button>
            <span className="text-neutral-300">/</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center">
                <FlaskConical className="w-4 h-4 text-primary-600" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-neutral-900">
                  {job.agentName}{job.agentAliasName ? ` — ${job.agentAliasName}` : ''}
                </h1>
                <p className="text-xs text-neutral-400">{fmtDate(job.createdAt)}</p>
              </div>
            </div>
            <span className={`ml-auto text-xs px-2.5 py-1 rounded-full font-medium ${
              job.status === 'completed' ? 'bg-green-100 text-green-700'
              : isRunning ? 'bg-primary-100 text-primary-700'
              : 'bg-amber-100 text-amber-700'
            }`}>
              {job.status === 'completed' ? 'Concluído' : isRunning ? 'Em andamento' : 'Interrompido'}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Background notice (only while running) */}
        {isRunning && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3 text-sm text-green-800">
            <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Rodando em segundo plano.</strong> Você pode fechar esta aba ou navegar para
              outras páginas — o servidor continuará processando. Ao retornar, o progresso será
              restaurado automaticamente.
            </div>
          </div>
        )}

        {/* Header card */}
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-neutral-800 flex items-center gap-2">
                {job.status === 'aborted' ? (
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                ) : isRunning ? (
                  <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                )}
                {job.status === 'aborted'
                  ? 'Avaliação interrompida'
                  : isRunning
                  ? 'Avaliação em andamento…'
                  : 'Avaliação concluída'}
              </h2>
              <p className="text-sm text-neutral-500 mt-0.5">
                Agente: <span className="font-medium text-neutral-700">{job.agentName}</span>
                {job.agentAliasName && (
                  <> · Alias: <span className="font-medium text-neutral-700">{job.agentAliasName}</span></>
                )}
                {' · '}
                {job.completedQuestions} de {job.totalQuestions} perguntas processadas
                {job.errorCount > 0 && (
                  <span className="text-red-500"> · {job.errorCount} erro{job.errorCount !== 1 ? 's' : ''}</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isRunning && (
                <button
                  onClick={abortJob}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <X className="w-4 h-4" />
                  Interromper
                </button>
              )}
              {isCompleted && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate('/avaliacoes')}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm border border-neutral-200 text-neutral-600 rounded-lg hover:bg-neutral-50 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Nova Avaliação
                  </button>
                  <button
                    onClick={downloadJsonl}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm border border-neutral-200 text-neutral-600 rounded-lg hover:bg-neutral-50 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Baixar JSONL
                  </button>
                  <button
                    onClick={exportToS3}
                    disabled={s3Exporting}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors font-medium"
                  >
                    {s3Exporting
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <UploadCloud className="w-4 h-4" />
                    }
                    {s3Exporting ? 'Enviando…' : 'Exportar para S3'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-2">
            <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-2.5 rounded-full transition-all duration-500 ${
                  job.status === 'aborted' ? 'bg-amber-400' : 'bg-primary-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>{progress}% concluído</span>
              {avgLatency !== null && <span>Latência média: {fmtMs(avgLatency)}</span>}
            </div>
          </div>
        </div>

        {/* S3 export success banner */}
        {s3Result && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-3.5 flex items-center gap-3 text-sm text-green-800">
            <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-medium">Exportado com sucesso!</span>
              {' '}
              <span className="font-mono text-xs text-green-700 break-all">{s3Result.s3Url}</span>
              <span className="text-xs text-green-600 ml-2">· {s3Result.lines} linhas</span>
            </div>
            <button onClick={() => setS3Result(null)} className="text-green-400 hover:text-green-600 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Metrics — clicáveis para filtrar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={CheckCircle2} label="Concluídas" value={`${done - errors} / ${total}`} color="green"
            active={filter === 'done'}
            onClick={() => setFilter(filter === 'done' ? 'all' : 'done')}
          />
          <StatCard
            icon={XCircle} label="Erros" value={String(errors)} color={errors > 0 ? 'red' : 'primary'}
            active={filter === 'error'}
            onClick={errors > 0 ? () => setFilter(filter === 'error' ? 'all' : 'error') : undefined}
          />
          <StatCard icon={Clock} label="Latência média" value={fmtMs(avgLatency)} color="amber" />
          <StatCard icon={Zap} label="Tokens (in/out)" value={`${fmtNum(totalTokensIn)} / ${fmtNum(totalTokensOut)}`} color="primary" />
        </div>

        {/* Questions / results list */}
        {results.length > 0 && (() => {
          const filtered = filter === 'done'
            ? results.filter((r) => r.status === 'done')
            : filter === 'error'
            ? results.filter((r) => r.status === 'error')
            : results
          return (
          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="px-6 py-3 border-b border-neutral-100 flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide flex items-center gap-2">
                {isRunning ? 'Progresso por pergunta' : 'Respostas detalhadas'}
                {filter !== 'all' && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary-100 text-primary-700">
                    filtro: {filter === 'done' ? 'concluídas' : 'erros'}
                    <button onClick={() => setFilter('all')} className="ml-1 hover:text-primary-900">×</button>
                  </span>
                )}
              </span>
              <span className="text-xs text-neutral-400">{filtered.length} de {results.length}</span>
            </div>

            <div className="divide-y divide-neutral-50 max-h-[600px] overflow-y-auto">
              {filtered.map((r) => (
                <div key={r.questionIndex}>
                  <div className="flex items-start gap-3 px-5 py-4 hover:bg-neutral-50 transition-colors">
                    <div
                      className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer"
                      onClick={() =>
                        setExpandedResult(expandedResult === r.questionIndex ? null : r.questionIndex)
                      }
                    >
                      <StatusIcon status={r.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-neutral-800 line-clamp-1">{r.question}</p>
                        <div className="flex items-center gap-3 mt-1">
                          {r.status === 'done' && (
                            <>
                              {r.latencyMs !== null && (
                                <span className="text-xs text-neutral-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3" /> {fmtMs(r.latencyMs)}
                                </span>
                              )}
                              {r.inputTokens !== null && (
                                <span className="text-xs text-neutral-400 flex items-center gap-1">
                                  <Zap className="w-3 h-3" />
                                  {fmtNum(r.inputTokens)} in / {fmtNum(r.outputTokens ?? 0)} out
                                </span>
                              )}
                            </>
                          )}
                          {r.status === 'error' && (
                            <span className="text-xs text-red-500 line-clamp-1">{r.error}</span>
                          )}
                          {r.status === 'running' && (
                            <span className="text-xs text-primary-500 animate-pulse">Aguardando resposta…</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-neutral-300 font-mono">#{r.questionIndex + 1}</span>
                      {r.status === 'done' && (
                        <div className="flex items-center gap-1">
                          <button
                            disabled={feedbackSubmitting === r.questionIndex}
                            onClick={() => submitFeedback(r.questionIndex, 'up')}
                            title="Boa resposta"
                            className={`p-1 rounded transition-colors ${
                              feedbacks[r.questionIndex]?.vote === 'up'
                                ? 'text-green-600 bg-green-50'
                                : 'text-neutral-300 hover:text-green-500 hover:bg-green-50'
                            }`}
                          >
                            <ThumbsUp className="w-4 h-4" />
                          </button>
                          <button
                            disabled={feedbackSubmitting === r.questionIndex}
                            onClick={() => setThumbsDownModal({ questionIndex: r.questionIndex, comment: '' })}
                            title="Resposta ruim"
                            className={`p-1 rounded transition-colors ${
                              feedbacks[r.questionIndex]?.vote === 'down'
                                ? 'text-red-600 bg-red-50'
                                : 'text-neutral-300 hover:text-red-500 hover:bg-red-50'
                            }`}
                          >
                            <ThumbsDown className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                      {(r.status === 'done' || r.status === 'error') && (
                        <div
                          className="cursor-pointer"
                          onClick={() =>
                            setExpandedResult(expandedResult === r.questionIndex ? null : r.questionIndex)
                          }
                        >
                          {expandedResult === r.questionIndex
                            ? <ChevronUp className="w-4 h-4 text-neutral-400" />
                            : <ChevronDown className="w-4 h-4 text-neutral-400" />
                          }
                        </div>
                      )}
                    </div>
                  </div>

                  {expandedResult === r.questionIndex && (r.status === 'done' || r.status === 'error') && (
                    <div className="px-5 pb-5 bg-neutral-50 border-t border-neutral-100">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                            Pergunta
                          </p>
                          <div className="bg-white rounded-lg border border-neutral-200 p-4 text-sm text-neutral-700 leading-relaxed">
                            {r.question}
                          </div>
                          {r.referenceResponse && (
                            <div className="mt-3">
                              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                                Resposta de referência
                              </p>
                              <div className="bg-green-50 rounded-lg border border-green-200 p-4 text-sm text-neutral-700 leading-relaxed">
                                {r.referenceResponse}
                              </div>
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                              Resposta do modelo
                            </p>
                            {r.status === 'done' && r.answer && (
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(r.answer!)
                                  setCopiedIndex(r.questionIndex)
                                  setTimeout(() => setCopiedIndex(null), 2000)
                                }}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 rounded transition-colors"
                                title="Copiar resposta"
                              >
                                {copiedIndex === r.questionIndex
                                  ? <><Check className="w-3 h-3 text-green-500" /> Copiado</>
                                  : <><Copy className="w-3 h-3" /> Copiar</>
                                }
                              </button>
                            )}
                          </div>
                          <div className="bg-white rounded-lg border border-neutral-200 p-4 text-sm text-neutral-700 leading-relaxed max-h-96 overflow-y-auto">
                            {r.status === 'error' ? (
                              <span className="text-red-500">{r.error}</span>
                            ) : r.answer ? (
                              <div className="prose prose-sm max-w-none prose-neutral prose-headings:font-semibold prose-headings:text-neutral-800 prose-p:text-neutral-700 prose-table:text-xs prose-th:bg-neutral-50 prose-td:border-neutral-200 prose-th:border-neutral-200">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {r.answer}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <span className="text-neutral-300">Sem resposta</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {r.status === 'done' && (r.latencyMs !== null || r.inputTokens !== null) && (
                        <div className="flex items-center gap-6 mt-3 text-xs text-neutral-400">
                          {r.latencyMs !== null && (
                            <span>Latência: <strong className="text-neutral-600">{fmtMs(r.latencyMs)}</strong></span>
                          )}
                          {r.inputTokens !== null && (
                            <span>Tokens entrada: <strong className="text-blue-600">{fmtNum(r.inputTokens)}</strong></span>
                          )}
                          {r.outputTokens !== null && (
                            <span>Tokens saída: <strong className="text-green-600">{fmtNum(r.outputTokens)}</strong></span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          )
        })()}
      </div>

      {/* Modal thumbs down */}
      {thumbsDownModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
                  <ThumbsDown className="w-4 h-4 text-red-500" />
                </div>
                <h3 className="text-sm font-semibold text-neutral-800">O que houve de errado?</h3>
              </div>
              <button
                onClick={() => setThumbsDownModal(null)}
                className="text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-neutral-500 mb-3">
              Pergunta #{thumbsDownModal.questionIndex + 1} — Deixe um comentário explicando o problema (opcional).
            </p>
            <textarea
              autoFocus
              rows={4}
              value={thumbsDownModal.comment}
              onChange={(e) => setThumbsDownModal((m) => m ? { ...m, comment: e.target.value } : null)}
              placeholder="Ex: A resposta está incorreta, incompleta ou fora de contexto…"
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300 resize-none"
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setThumbsDownModal(null)}
                className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
              >
                Cancelar
              </button>
              <button
                disabled={feedbackSubmitting === thumbsDownModal.questionIndex}
                onClick={async () => {
                  const { questionIndex, comment } = thumbsDownModal
                  setThumbsDownModal(null)
                  await submitFeedback(questionIndex, 'down', comment)
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors font-medium"
              >
                {feedbackSubmitting === thumbsDownModal.questionIndex
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ThumbsDown className="w-4 h-4" />
                }
                Confirmar avaliação
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
