import { useEffect, useState, useCallback } from 'react'
import {
  MessageSquare, Users, Zap, Clock, TrendingUp,
  RefreshCw, ChevronDown, ChevronUp, Terminal,
  ThumbsUp, ThumbsDown, MessageCircle, Trash2,
  ShieldCheck, ShieldAlert, Bot, Smile, CalendarDays, Layers,
} from 'lucide-react'
import { api } from '@/src/shared/services/api'
import { LogsPanel } from '@/src/shared/components/LogsPanel'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Stats {
  totalConversations: number
  totalMessages: number
  totalUsers: number
  totalInputTokens: number
  totalOutputTokens: number
  avgLatencyMs: number | null
  dailyActivity: { date: string; count: number }[]
  totalLikes: number
  totalDislikes: number
  totalRated: number
  satisfactionRate: number | null
  siswebSent: number
  siswebFailed: number
  siswebPending: number
  siswebSuccessRate: number | null
  byAgent: AgentUsage[]
}

interface AgentUsage {
  agentId: string
  agentName: string
  interactions: number
  inputTokens: number
  outputTokens: number
  avgLatencyMs: number | null
  likes: number
  dislikes: number
  satisfactionRate: number | null
  siswebSent: number
  siswebFailed: number
}

interface FeedbackRow {
  messageId: string
  chatId: string
  userId: string
  userName: string
  question: string | null
  answer: string
  timestamp: string
  feedback: 'like' | 'dislike'
  feedbackComment: string | null
}

interface FeedbackResponse {
  rows: FeedbackRow[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface ModelUsage {
  modelId: string
  invocations: number
  inputTokens: number
  outputTokens: number
  avgLatencyMs: number | null
  clientErrors: number
}

interface CWMetrics {
  days: number
  region: string
  models: ModelUsage[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(n: number | null | undefined, unit = '') {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M${unit}`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k${unit}`
  return `${n}${unit}`
}

function fmtMs(ms: number | null) {
  if (ms === null) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function truncate(s: string | null, max = 80) {
  if (!s) return '—'
  return s.length > max ? s.substring(0, max) + '…' : s
}

// ---------------------------------------------------------------------------
// Mini bar chart (CSS-based, no deps)
// ---------------------------------------------------------------------------
function BarChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div className="flex items-end gap-1 h-24 w-full">
      {data.map((d, i) => {
        const pct = (d.count / max) * 100
        const label = d.date.substring(5) // MM-DD
        return (
          <div key={d.date} className="flex flex-col justify-end items-center flex-1 h-full group relative">
            {/* contagem no topo da barra */}
            <span className={`text-[10px] font-semibold leading-none mb-0.5 ${d.count > 0 ? 'text-neutral-600' : 'text-neutral-300'}`}>
              {d.count}
            </span>
            {/* trilho de fundo para dar referência visual */}
            <div className="w-full flex-1 flex items-end rounded-t bg-neutral-100">
              <div
                className={`w-full rounded-t transition-all ${d.count > 0 ? 'bg-primary-500 group-hover:bg-primary-600' : ''}`}
                style={{ height: d.count > 0 ? `${Math.max(pct, 6)}%` : '0%' }}
              />
            </div>
            {/* tooltip — só a contagem */}
            <div className="absolute -top-8 bg-neutral-800 text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
              {d.count} {d.count === 1 ? 'pergunta' : 'perguntas'}
            </div>
            {/* label a cada 3 dias */}
            {i % 3 === 0 && (
              <span className="text-[9px] text-neutral-400 mt-1 leading-none">{label}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'primary',
}: {
  icon: any
  label: string
  value: string
  sub?: string
  color?: 'primary' | 'green' | 'amber' | 'purple' | 'red'
}) {
  const colors = {
    primary: 'bg-primary-50 text-primary-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600',
  }
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-5 flex items-start gap-4 shadow-sm hover:shadow-md transition-shadow">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-neutral-500 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-neutral-900 leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-neutral-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'feedback' | 'logs'>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [feedbackRows, setFeedbackRows] = useState<FeedbackRow[]>([])
  const [feedbackMeta, setFeedbackMeta] = useState({ page: 1, totalPages: 1, total: 0 })
  const [loadingFeedback, setLoadingFeedback] = useState(false)
  const [deletingFeedback, setDeletingFeedback] = useState<string | null>(null)
  const [expandedFeedback, setExpandedFeedback] = useState<string | null>(null)
  const [cw, setCw] = useState<CWMetrics | null>(null)
  const [loadingCw, setLoadingCw] = useState(true)
  const [loadingStats, setLoadingStats] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const PAGE_SIZE = 20

  const loadFeedback = useCallback(async (page: number) => {
    setLoadingFeedback(true)
    setExpandedFeedback(null)
    try {
      const f = await api.get<FeedbackResponse>(
        `/api/admin/dashboard/feedback?type=dislike&page=${page}&pageSize=${PAGE_SIZE}`
      )
      setFeedbackRows(f.rows)
      setFeedbackMeta({ page: f.page, totalPages: f.totalPages, total: f.total })
    } catch (e) {
      console.error('feedback', e)
    } finally {
      setLoadingFeedback(false)
    }
  }, [])

  const deleteFeedback = useCallback(async (row: FeedbackRow) => {
    if (!confirm(`Remover o feedback desta mensagem?\n\n"${row.question?.substring(0, 80) ?? '—'}"`)) return
    setDeletingFeedback(row.messageId)
    try {
      const params = new URLSearchParams({ chatId: row.chatId, timestamp: row.timestamp })
      await api.delete(`/api/admin/dashboard/feedback/${row.messageId}?${params}`)
      await Promise.all([
        loadFeedback(feedbackMeta.page),
        api.get<Stats>('/api/admin/dashboard/stats').then(setStats).catch(() => {}),
      ])
    } catch (e) {
      console.error('delete feedback', e)
      alert('Erro ao remover feedback.')
    } finally {
      setDeletingFeedback(null)
    }
  }, [loadFeedback, feedbackMeta.page])

  const loadAll = useCallback(async () => {
    setLoadingStats(true)
    try {
      const s = await api.get<Stats>('/api/admin/dashboard/stats')
      setStats(s)
    } catch (e) {
      console.error('stats', e)
    } finally {
      setLoadingStats(false)
    }

    loadFeedback(1)

    setLoadingCw(true)
    try {
      const c = await api.get<CWMetrics>('/api/admin/dashboard/cloudwatch')
      setCw(c)
    } catch (e) {
      console.debug('cloudwatch', e)
    } finally {
      setLoadingCw(false)
    }

    setLastRefresh(new Date())
  }, [loadFeedback])

  useEffect(() => { loadAll() }, [loadAll])

  const cwModels = cw?.models ?? []
  const totalCwInvocations = cwModels.reduce((s, m) => s + (m.invocations ?? 0), 0)

  const Skeleton = ({ className = '' }: { className?: string }) => (
    <div className={`bg-neutral-100 rounded animate-pulse ${className}`} />
  )

  return (
    <div className="min-h-screen bg-neutral-50">

      {/* Sub-nav: tabs + refresh */}
      <div className="bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <div className="flex gap-0">
            {([
              { id: 'overview' as const, label: 'Visão Geral', icon: TrendingUp, badge: null as number | null },
              { id: 'feedback' as const, label: 'Feedbacks', icon: ThumbsDown, badge: stats?.totalDislikes ?? null },
              { id: 'logs' as const, label: 'Logs', icon: Terminal, badge: null as number | null },
            ]).map(({ id, label, icon: Icon, badge }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as typeof activeTab)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
                {badge != null && badge > 0 && (
                  <span className="ml-1 bg-neutral-100 text-neutral-600 text-[10px] font-semibold rounded-full px-1.5 py-0.5 leading-none">
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>
          {activeTab === 'overview' && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-neutral-400">
                Atualizado em {lastRefresh.toLocaleTimeString('pt-BR')}
              </span>
              <button
                onClick={loadAll}
                disabled={loadingStats}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-neutral-200 rounded-md hover:bg-neutral-50 text-neutral-700 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingStats ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Logs tab — full height */}
      {activeTab === 'logs' && (
        <div style={{ height: 'calc(100vh - 112px)' }} className="flex flex-col">
          <LogsPanel />
        </div>
      )}

      {/* Feedback tab — dislikes do chat */}
      {activeTab === 'feedback' && (
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

          {/* KPI cards de feedback */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {loadingStats ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-neutral-100 rounded-xl animate-pulse h-28" />
              ))
            ) : (
              <>
                <KpiCard
                  icon={ThumbsUp}
                  label="Likes"
                  value={fmt(stats?.totalLikes)}
                  sub={`${stats?.totalRated ?? 0} avaliações no total`}
                  color="green"
                />
                <KpiCard
                  icon={ThumbsDown}
                  label="Dislikes"
                  value={fmt(stats?.totalDislikes)}
                  sub={`${feedbackMeta.total} com comentário`}
                  color="amber"
                />
                <KpiCard
                  icon={MessageCircle}
                  label="Com comentário"
                  value={fmt(feedbackMeta.total)}
                  sub="feedbacks negativos"
                  color="purple"
                />
              </>
            )}
          </div>

          {/* Barra de proporção likes / dislikes */}
          {!loadingStats && stats && (stats.totalLikes + stats.totalDislikes) > 0 && (
            <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-3">Proporção de feedbacks</p>
              <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
                <div
                  className="bg-green-400 rounded-l-full transition-all"
                  style={{ width: `${Math.round((stats.totalLikes / (stats.totalLikes + stats.totalDislikes)) * 100)}%` }}
                  title={`${stats.totalLikes} likes`}
                />
                <div
                  className="bg-red-400 rounded-r-full transition-all flex-1"
                  title={`${stats.totalDislikes} dislikes`}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-neutral-500">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block" />
                  {stats.totalLikes} likes ({Math.round((stats.totalLikes / (stats.totalLikes + stats.totalDislikes)) * 100)}%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" />
                  {stats.totalDislikes} dislikes ({Math.round((stats.totalDislikes / (stats.totalLikes + stats.totalDislikes)) * 100)}%)
                </span>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-neutral-700">Feedbacks negativos do chat</h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {feedbackMeta.total > 0 ? `${feedbackMeta.total} respostas com dislike` : 'Nenhum feedback negativo registrado'}
                </p>
              </div>
              {feedbackMeta.totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button onClick={() => loadFeedback(feedbackMeta.page - 1)} disabled={feedbackMeta.page <= 1 || loadingFeedback} className="px-3 py-1.5 text-xs border border-neutral-200 rounded-md hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">← Anterior</button>
                  <span className="text-xs text-neutral-500">{feedbackMeta.page} / {feedbackMeta.totalPages}</span>
                  <button onClick={() => loadFeedback(feedbackMeta.page + 1)} disabled={feedbackMeta.page >= feedbackMeta.totalPages || loadingFeedback} className="px-3 py-1.5 text-xs border border-neutral-200 rounded-md hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Próxima →</button>
                </div>
              )}
            </div>
            {loadingFeedback ? (
              <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="bg-neutral-100 rounded animate-pulse h-12" />)}</div>
            ) : feedbackRows.length === 0 ? (
              <div className="text-center py-12 text-neutral-400 text-sm">Nenhum feedback negativo registrado</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-neutral-50 text-neutral-500 text-xs uppercase tracking-wide">
                      <th className="text-left px-4 py-3 font-medium">Data/Hora</th>
                      <th className="text-left px-4 py-3 font-medium">Usuário</th>
                      <th className="text-left px-4 py-3 font-medium">Pergunta</th>
                      <th className="text-left px-4 py-3 font-medium">Comentário</th>
                      <th className="w-16 px-2 py-3" />
                      <th className="w-8 px-2 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {feedbackRows.map((row) => (
                      <>
                        <tr key={row.messageId} className="hover:bg-neutral-50 cursor-pointer transition-colors" onClick={() => setExpandedFeedback(expandedFeedback === row.messageId ? null : row.messageId)}>
                          <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">{fmtDate(row.timestamp)}</td>
                          <td className="px-4 py-3 text-neutral-700 max-w-[140px] truncate" title={row.userId}>{row.userName || row.userId?.substring(0, 12) || '—'}</td>
                          <td className="px-4 py-3 text-neutral-700 max-w-xs">{truncate(row.question, 70)}</td>
                          <td className="px-4 py-3 text-neutral-500 max-w-xs">
                            {row.feedbackComment ? (
                              <span className="flex items-center gap-1">
                                <MessageCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                                {truncate(row.feedbackComment, 60)}
                              </span>
                            ) : <span className="text-neutral-300">—</span>}
                          </td>
                          <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => deleteFeedback(row)}
                              disabled={deletingFeedback === row.messageId}
                              title="Remover feedback"
                              className="p-1.5 rounded text-neutral-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                          <td className="px-2 py-3 text-neutral-400">{expandedFeedback === row.messageId ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                        </tr>
                        {expandedFeedback === row.messageId && (
                          <tr key={`${row.messageId}-exp`} className="bg-neutral-50">
                            <td colSpan={6} className="px-6 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div>
                                  <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">Pergunta</p>
                                  <p className="text-neutral-700 bg-white rounded border border-neutral-200 p-3 leading-relaxed">{row.question || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">Resposta</p>
                                  <p className="text-neutral-700 bg-white rounded border border-neutral-200 p-3 leading-relaxed max-h-40 overflow-y-auto">{row.answer || '—'}</p>
                                </div>
                              </div>
                              {row.feedbackComment && (
                                <div className="mt-3">
                                  <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">Comentário do usuário</p>
                                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">{row.feedbackComment}</p>
                                </div>
                              )}
                              <div className="flex gap-4 mt-3 text-xs text-neutral-400">
                                <span>Chat: <span className="font-mono">{row.chatId}</span></span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'overview' && (
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {loadingStats ? (
            Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          ) : (
            <>
              <KpiCard icon={MessageSquare} label="Conversas" value={fmt(stats?.totalConversations)} sub={`${fmt(stats?.totalMessages)} mensagens`} color="primary" />
              <KpiCard icon={Users} label="Usuários" value={fmt(stats?.totalUsers)} color="green" />
              <KpiCard icon={Zap} label="Tokens (in / out)" value={`${fmt(stats?.totalInputTokens)} / ${fmt(stats?.totalOutputTokens)}`} sub="acumulado total" color="purple" />
              <KpiCard icon={Clock} label="Latência Média" value={fmtMs(stats?.avgLatencyMs ?? null)} sub="por resposta" color="amber" />
              <KpiCard
                icon={(stats?.siswebFailed ?? 0) > 0 ? ShieldAlert : ShieldCheck}
                label="SISWEB (compliance)"
                value={stats?.siswebSuccessRate != null ? `${stats.siswebSuccessRate}%` : '—'}
                sub={`${fmt(stats?.siswebSent)} enviados · ${fmt(stats?.siswebFailed)} falhas${(stats?.siswebPending ?? 0) > 0 ? ` · ${fmt(stats?.siswebPending)} pendentes` : ''}`}
                color={(stats?.siswebFailed ?? 0) > 0 ? 'red' : 'green'}
              />
              <KpiCard
                icon={Smile}
                label="Satisfação"
                value={stats?.satisfactionRate != null ? `${stats.satisfactionRate}%` : '—'}
                sub={`${fmt(stats?.totalLikes)} 👍 · ${fmt(stats?.totalDislikes)} 👎`}
                color={
                  stats?.satisfactionRate == null ? 'primary'
                    : stats.satisfactionRate >= 70 ? 'green'
                    : stats.satisfactionRate >= 40 ? 'amber'
                    : 'red'
                }
              />
              <KpiCard
                icon={CalendarDays}
                label="Perguntas hoje"
                value={fmt(stats?.dailyActivity?.[stats.dailyActivity.length - 1]?.count ?? 0)}
                sub="últimas 24h"
                color="primary"
              />
              <KpiCard
                icon={Layers}
                label="Msgs / conversa"
                value={
                  stats && stats.totalConversations > 0
                    ? (stats.totalMessages / stats.totalConversations).toFixed(1)
                    : '—'
                }
                sub="profundidade média"
                color="purple"
              />
            </>
          )}
        </div>

        {/* Atividade diária + CloudWatch */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Gráfico de atividade diária */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-neutral-200 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-neutral-700 mb-4">Perguntas por dia (14 dias)</h2>
            {loadingStats ? (
              <Skeleton className="h-20" />
            ) : stats?.dailyActivity?.length ? (
              <BarChart data={stats.dailyActivity} />
            ) : (
              <p className="text-sm text-neutral-400 text-center py-6">Sem dados</p>
            )}
          </div>

          {/* Uso de modelos (CloudWatch) */}
          <div className="bg-white rounded-xl border border-neutral-200 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-neutral-700 mb-4">
              Bedrock · últimos {cw?.days ?? 7} dias
            </h2>
            <div className="space-y-3">
              <MetricRow label="Invocações (todos modelos)" value={fmt(totalCwInvocations)} />
              <MetricRow label="Tokens de entrada" value={fmt(cwModels.reduce((s, m) => s + m.inputTokens, 0))} />
              <MetricRow label="Tokens de saída" value={fmt(cwModels.reduce((s, m) => s + m.outputTokens, 0))} />
              <MetricRow label="Erros de cliente" value={fmt(cwModels.reduce((s, m) => s + m.clientErrors, 0))} />
              <MetricRow label="Modelos com uso" value={fmt(cwModels.length)} />
            </div>
            {loadingCw && <p className="text-[10px] text-neutral-400 mt-4">Carregando métricas...</p>}
          </div>
        </div>

        {/* Uso por agente */}
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-neutral-200">
            <h2 className="text-sm font-semibold text-neutral-700">Uso por agente</h2>
            <p className="text-xs text-neutral-500 mt-0.5">Métricas separadas por agente selecionado no chat</p>
          </div>
          {loadingStats ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !stats?.byAgent?.length ? (
            <div className="text-center py-12 text-neutral-400 text-sm">Nenhuma interação registrada ainda</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-neutral-500 text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-3 font-medium">Agente</th>
                    <th className="text-right px-4 py-3 font-medium">Interações</th>
                    <th className="text-right px-4 py-3 font-medium">Tokens in</th>
                    <th className="text-right px-4 py-3 font-medium">Tokens out</th>
                    <th className="text-right px-4 py-3 font-medium">Latência média</th>
                    <th className="text-center px-4 py-3 font-medium">Satisfação</th>
                    <th className="text-center px-4 py-3 font-medium">SISWEB</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {stats.byAgent.map((a) => (
                    <tr key={a.agentId} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Bot className="w-4 h-4 text-primary-600" />
                          </div>
                          <span className="font-medium text-neutral-800 max-w-[200px] truncate" title={a.agentId}>{a.agentName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-neutral-800">{a.interactions.toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-3 text-right text-blue-600">{a.inputTokens.toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-3 text-right text-green-600">{a.outputTokens.toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-3 text-right"><LatencyBadge ms={a.avgLatencyMs} /></td>
                      <td className="px-4 py-3 text-center">
                        {a.satisfactionRate !== null ? (
                          <span className={`text-xs font-semibold ${a.satisfactionRate >= 70 ? 'text-green-600' : a.satisfactionRate >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                            {a.satisfactionRate}%
                          </span>
                        ) : <span className="text-neutral-300 text-xs">—</span>}
                        <span className="text-[10px] text-neutral-400 block">{a.likes}👍 {a.dislikes}👎</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {a.siswebFailed > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                            <ShieldAlert className="w-3.5 h-3.5" /> {a.siswebFailed} falha{a.siswebFailed > 1 ? 's' : ''}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                            <ShieldCheck className="w-3.5 h-3.5" /> {a.siswebSent} ok
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Uso por modelo (CloudWatch) */}
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-neutral-200">
            <h2 className="text-sm font-semibold text-neutral-700">Uso por modelo</h2>
            <p className="text-xs text-neutral-500 mt-0.5">Invocações de modelos no Bedrock (CloudWatch, últimos {cw?.days ?? 7} dias)</p>
          </div>
          {loadingCw ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : cwModels.length === 0 ? (
            <div className="text-center py-12 text-neutral-400 text-sm">Sem métricas de modelo no período</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-neutral-500 text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-3 font-medium">Modelo</th>
                    <th className="text-right px-4 py-3 font-medium">Invocações</th>
                    <th className="text-right px-4 py-3 font-medium">Tokens in</th>
                    <th className="text-right px-4 py-3 font-medium">Tokens out</th>
                    <th className="text-right px-4 py-3 font-medium">Latência média</th>
                    <th className="text-right px-4 py-3 font-medium">Erros</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {cwModels.map((m) => (
                    <tr key={m.modelId} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-neutral-700 max-w-[260px] truncate" title={m.modelId}>{m.modelId}</td>
                      <td className="px-4 py-3 text-right font-semibold text-neutral-800">{m.invocations.toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-3 text-right text-blue-600">{m.inputTokens.toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-3 text-right text-green-600">{m.outputTokens.toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-3 text-right"><LatencyBadge ms={m.avgLatencyMs} /></td>
                      <td className="px-4 py-3 text-right">
                        {m.clientErrors > 0 ? <span className="text-red-600 font-semibold text-xs">{m.clientErrors}</span> : <span className="text-neutral-300 text-xs">0</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-neutral-500">{label}</span>
      <span className="text-sm font-semibold text-neutral-800">{value}</span>
    </div>
  )
}

function LatencyBadge({ ms }: { ms: number | null }) {
  if (ms === null) return <span className="text-neutral-300 text-xs">—</span>
  const color = ms < 3000 ? 'text-green-600' : ms < 8000 ? 'text-amber-600' : 'text-red-600'
  return <span className={`text-xs font-semibold ${color}`}>{fmtMs(ms)}</span>
}
