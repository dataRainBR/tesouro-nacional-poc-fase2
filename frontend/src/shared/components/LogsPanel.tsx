import { useEffect, useState, useCallback, useRef } from 'react'
import { Terminal, Trash2, PauseCircle, PlayCircle } from 'lucide-react'
import { authService } from '@/src/shared/services/auth'

export interface LogEntry {
  id: number
  ts: string
  level: 'log' | 'warn' | 'error' | 'info'
  message: string
}

export function LogsPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)
  const esRef = useRef<EventSource | null>(null)

  pausedRef.current = paused

  const connect = useCallback(async () => {
    if (esRef.current) esRef.current.close()

    // EventSource não suporta renovação de header — se o access token estiver
    // expirado (ou perto de expirar), renova via refresh token ANTES de conectar.
    // Sem isso, o SSE cai em loop de 401 quando a sessão do Cognito expira (~1h).
    if (!authService.isAuthenticated()) {
      await authService.refreshTokens()
    }

    const token = authService.getAccessToken() || ''
    const API_URL = import.meta.env.VITE_API_URL || ''
    const url = `${API_URL}/api/admin/dashboard/logs/stream?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (e) => {
      if (pausedRef.current) return
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'history') {
          setEntries(data.entries)
        } else if (data.type === 'entries') {
          setEntries((prev) => [...prev, ...data.entries].slice(-500))
        }
      } catch {}
    }

    es.onerror = async () => {
      es.close()
      // Tenta renovar o token antes da próxima tentativa — cobre o caso de a
      // conexão ter caído justamente por expiração do access token.
      if (!authService.isAuthenticated()) {
        await authService.refreshTokens()
      }
      setTimeout(connect, 3000)
    }
  }, [])

  useEffect(() => {
    connect()

    // Verifica periodicamente se o access token está perto de expirar e força
    // uma reconexão com token renovado — evita que a stream fique presa em
    // 401 silencioso até o próximo erro de rede.
    const tokenCheckInterval = setInterval(() => {
      if (!authService.isAuthenticated()) {
        connect()
      }
    }, 60_000)

    return () => {
      esRef.current?.close()
      clearInterval(tokenCheckInterval)
    }
  }, [connect])

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries, paused])

  const levelColor: Record<string, string> = {
    error: 'text-red-400',
    warn:  'text-amber-400',
    info:  'text-blue-400',
    log:   'text-neutral-300',
  }
  const levelBg: Record<string, string> = {
    error: 'bg-red-950/40',
    warn:  'bg-amber-950/30',
    info:  'bg-blue-950/30',
    log:   '',
  }

  const filtered = filter
    ? entries.filter((e) => e.message.toLowerCase().includes(filter.toLowerCase()) || e.level === filter)
    : entries

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-neutral-900 border-b border-neutral-700 flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-1">
          <Terminal className="w-4 h-4 text-green-400 flex-shrink-0" />
          <span className="text-xs text-neutral-400 font-mono">backend · pod logs</span>
          <span className="ml-2 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400">live</span>
          </span>
        </div>

        <input
          type="text"
          placeholder="filtrar..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-neutral-800 text-neutral-200 text-xs font-mono rounded px-2.5 py-1 border border-neutral-700 w-36 focus:outline-none focus:border-neutral-500 placeholder-neutral-600"
        />

        <div className="flex items-center gap-1">
          {(['error', 'warn', 'info', 'log'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setFilter((f) => f === lvl ? '' : lvl)}
              className={`text-xs px-1.5 py-0.5 rounded font-mono transition-colors ${
                filter === lvl
                  ? lvl === 'error' ? 'bg-red-800 text-red-200'
                  : lvl === 'warn'  ? 'bg-amber-800 text-amber-200'
                  : lvl === 'info'  ? 'bg-blue-800 text-blue-200'
                  : 'bg-neutral-600 text-neutral-200'
                  : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>

        <button
          onClick={() => setPaused((p) => !p)}
          title={paused ? 'Retomar' : 'Pausar'}
          className="p-1 rounded hover:bg-neutral-700 transition-colors"
        >
          {paused
            ? <PlayCircle className="w-4 h-4 text-green-400" />
            : <PauseCircle className="w-4 h-4 text-neutral-400" />}
        </button>

        <button
          onClick={() => setEntries([])}
          title="Limpar"
          className="p-1 rounded hover:bg-neutral-700 transition-colors"
        >
          <Trash2 className="w-4 h-4 text-neutral-400" />
        </button>
      </div>

      {/* Log lines */}
      <div className="flex-1 overflow-y-auto bg-neutral-950 font-mono text-xs leading-5 min-h-0">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
            {entries.length === 0 ? 'Aguardando logs…' : 'Nenhum resultado para o filtro'}
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className={`flex gap-3 px-4 py-0.5 hover:bg-neutral-900/60 ${levelBg[entry.level]}`}
            >
              <span className="text-neutral-600 flex-shrink-0 select-none">
                {entry.ts.substring(11, 23)}
              </span>
              <span className={`w-10 flex-shrink-0 ${levelColor[entry.level]}`}>
                [{entry.level.toUpperCase().substring(0, 3)}]
              </span>
              <span className="text-neutral-300 break-all whitespace-pre-wrap">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {paused && (
        <div className="px-4 py-1 bg-amber-900/30 border-t border-amber-800/50 text-xs text-amber-400 text-center flex-shrink-0">
          Pausado — clique em ▶ para retomar o scroll automático
        </div>
      )}
    </div>
  )
}
