import React, { useEffect, useState, useCallback } from 'react'
import {
  ChevronDown, ChevronUp, RefreshCw, ShieldAlert,
  CheckCircle2, XCircle, Clock3, History,
} from 'lucide-react'
import { api } from '@/src/shared/services/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface HistoryRow {
  messageId: string
  chatId: string
  userId: string
  userName: string
  question: string | null
  answer: string
  timestamp: string
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  agentId: string | null
  feedback: 'like' | 'dislike' | null
  feedbackComment: string | null
  siswebStatus: 'sent' | 'failed' | 'pending' | null
  siswebError: string | null
  siswebSentAt: string | null
}

interface HistoryResponse {
  rows: HistoryRow[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

type SortField = 'timestamp' | 'inputTokens' | 'outputTokens' | 'latencyMs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

function fmtMs(ms: number | null) {
  if (ms === null) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function truncate(s: string | null, max = 70) {
  if (!s) return '—'
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [siswebFilter, setSiswebFilter] = useState<'all' | 'failed'>('all')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const PAGE_SIZE = 20

  const load = useCallback(async (page: number) => {
    setLoading(true)
    setExpandedRow(null)
    try {
      const h = await api.get<HistoryResponse>(
        `/api/admin/dashboard/history?page=${page}&pageSize=${PAGE_SIZE}`
      )
      setHistory(h.rows)
      setMeta({ page: h.page, totalPages: h.totalPages, total: h.total })
    } catch (e) {
      console.error('history', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(1) }, [load])

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortField(field); setSortDir('desc') }
  }

  // Lista de agentes presentes na página atual (para o filtro)
  const agentOptions = [...new Set(history.map((r) => r.agentId).filter(Boolean))] as string[]

  const filtered = (() => {
    let rows = history
    if (dateFrom) {
      const from = new Date(dateFrom)
      rows = rows.filter((r) => new Date(r.timestamp) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59')
      rows = rows.filter((r) => new Date(r.timestamp) <= to)
    }
    if (siswebFilter === 'failed') rows = rows.filter((r) => r.siswebStatus === 'failed')
    if (agentFilter !== 'all') rows = rows.filter((r) => r.agentId === agentFilter)

    return [...rows].sort((a, b) => {
      let va: number, vb: number
      if (sortField === 'timestamp') {
        va = new Date(a.timestamp).getTime(); vb = new Date(b.timestamp).getTime()
      } else {
        va = a[sortField] ?? -1; vb = b[sortField] ?? -1
      }
      return sortDir === 'asc' ? va - vb : vb - va
    })
  })()

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-30 inline ml-0.5" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 inline ml-0.5" />
      : <ChevronDown className="w-3 h-3 inline ml-0.5" />
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center">
              <History className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-neutral-900">Histórico de interações</h1>
              <p className="text-sm text-neutral-500">{meta.total > 0 ? `${meta.total} interações registradas` : 'Carregando...'}</p>
            </div>
          </div>
          <button
            onClick={() => load(meta.page)}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-neutral-200 rounded-md hover:bg-neutral-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Atualizar
          </button>
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-xl border border-neutral-200 p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-neutral-500">De:</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="text-xs border border-neutral-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-neutral-500">Até:</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="text-xs border border-neutral-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </div>
          {agentOptions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-neutral-500">Agente:</label>
              <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}
                className="text-xs border border-neutral-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500 max-w-[180px]">
                <option value="all">Todos</option>
                {agentOptions.map((a) => <option key={a} value={a}>{a.slice(0, 18)}</option>)}
              </select>
            </div>
          )}
          <button
            onClick={() => setSiswebFilter((f) => f === 'failed' ? 'all' : 'failed')}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
              siswebFilter === 'failed' ? 'bg-red-50 border-red-300 text-red-700' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            {siswebFilter === 'failed' ? 'Mostrando falhas SISWEB' : 'Só falhas SISWEB'}
          </button>
          {(dateFrom || dateTo || agentFilter !== 'all' || siswebFilter !== 'all') && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setAgentFilter('all'); setSiswebFilter('all') }}
              className="text-xs text-primary-600 hover:text-primary-700 underline ml-auto"
            >
              Limpar filtros
            </button>
          )}
        </div>

        {/* Tabela */}
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          {meta.totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-b border-neutral-100">
              <button onClick={() => load(meta.page - 1)} disabled={meta.page <= 1 || loading}
                className="px-3 py-1.5 text-xs border border-neutral-200 rounded-md hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed">
                ← Anterior
              </button>
              <span className="text-xs text-neutral-500">{meta.page} / {meta.totalPages}</span>
              <button onClick={() => load(meta.page + 1)} disabled={meta.page >= meta.totalPages || loading}
                className="px-3 py-1.5 text-xs border border-neutral-200 rounded-md hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed">
                Próxima →
              </button>
            </div>
          )}

          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 bg-neutral-100 rounded animate-pulse" />)}
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-neutral-400 text-sm">Nenhuma interação registrada ainda</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-neutral-400 text-sm">Nenhuma interação encontrada com os filtros aplicados</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-neutral-500 text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-neutral-700 select-none" onClick={() => toggleSort('timestamp')}>
                      Data/Hora <SortIcon field="timestamp" />
                    </th>
                    <th className="text-left px-4 py-3 font-medium">Usuário</th>
                    <th className="text-left px-4 py-3 font-medium">Pergunta</th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-neutral-700 select-none" onClick={() => toggleSort('inputTokens')}>
                      Tokens in <SortIcon field="inputTokens" />
                    </th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-neutral-700 select-none" onClick={() => toggleSort('outputTokens')}>
                      Tokens out <SortIcon field="outputTokens" />
                    </th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-neutral-700 select-none" onClick={() => toggleSort('latencyMs')}>
                      Latência <SortIcon field="latencyMs" />
                    </th>
                    <th className="text-center px-4 py-3 font-medium">SISWEB</th>
                    <th className="w-8 px-2 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filtered.map((row) => (
                    <React.Fragment key={row.messageId}>
                      <tr className="hover:bg-neutral-50 cursor-pointer transition-colors"
                        onClick={() => setExpandedRow(expandedRow === row.messageId ? null : row.messageId)}>
                        <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">{fmtDate(row.timestamp)}</td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-neutral-700 max-w-[140px] block truncate" title={row.userId}>
                            {row.userName || row.userId?.substring(0, 12) || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-neutral-700 max-w-xs">{truncate(row.question, 70)}</td>
                        <td className="px-4 py-3 text-right">
                          {row.inputTokens !== null ? <span className="text-xs font-medium text-blue-600">{row.inputTokens.toLocaleString('pt-BR')}</span> : <span className="text-neutral-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.outputTokens !== null ? <span className="text-xs font-medium text-green-600">{row.outputTokens.toLocaleString('pt-BR')}</span> : <span className="text-neutral-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs font-semibold ${row.latencyMs === null ? 'text-neutral-300' : row.latencyMs < 3000 ? 'text-green-600' : row.latencyMs < 8000 ? 'text-amber-600' : 'text-red-600'}`}>
                            {fmtMs(row.latencyMs)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center"><SiswebBadge status={row.siswebStatus} error={row.siswebError} /></td>
                        <td className="px-2 py-3 text-neutral-400">
                          {expandedRow === row.messageId ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </td>
                      </tr>
                      {expandedRow === row.messageId && (
                        <tr className="bg-neutral-50">
                          <td colSpan={8} className="px-6 py-4">
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
                            <div className="flex flex-wrap gap-4 mt-3 text-xs text-neutral-400">
                              <span>Chat: <span className="font-mono">{row.chatId}</span></span>
                              {row.agentId && <span>Agente: <span className="font-mono">{row.agentId}</span></span>}
                              <span>
                                SISWEB:{' '}
                                <span className={row.siswebStatus === 'sent' ? 'text-green-600 font-medium' : row.siswebStatus === 'failed' ? 'text-red-600 font-medium' : 'text-amber-600 font-medium'}>
                                  {row.siswebStatus === 'sent' ? 'enviado' : row.siswebStatus === 'failed' ? 'falhou' : row.siswebStatus === 'pending' ? 'pendente' : 'sem registro'}
                                </span>
                                {row.siswebSentAt && <span className="ml-1">em {fmtDate(row.siswebSentAt)}</span>}
                              </span>
                            </div>
                            {row.siswebStatus === 'failed' && row.siswebError && (
                              <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">Erro SISWEB: {row.siswebError}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SiswebBadge({ status, error }: { status: 'sent' | 'failed' | 'pending' | null; error?: string | null }) {
  if (status === 'sent') return <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full" title="Registrado no SISWEB"><CheckCircle2 className="w-3.5 h-3.5" /> Enviado</span>
  if (status === 'failed') return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full" title={error || 'Falha ao registrar no SISWEB'}><XCircle className="w-3.5 h-3.5" /> Falhou</span>
  if (status === 'pending') return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full" title="Envio em andamento"><Clock3 className="w-3.5 h-3.5" /> Pendente</span>
  return <span className="text-neutral-300 text-xs">—</span>
}
