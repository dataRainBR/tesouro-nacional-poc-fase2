/**
 * Ring-buffer logger — intercepta console e armazena últimas entradas.
 * Usado pelo endpoint SSE de logs do dashboard.
 */

export interface LogEntry {
  id: number
  ts: string
  level: 'log' | 'warn' | 'error' | 'info'
  message: string
}

const MAX_ENTRIES = 500
const buffer: LogEntry[] = []
let seq = 0

function push(level: LogEntry['level'], args: unknown[]) {
  const message = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')

  buffer.push({ id: ++seq, ts: new Date().toISOString(), level, message })
  if (buffer.length > MAX_ENTRIES) buffer.shift()
}

// Guardar referências originais antes de sobrescrever
const _log = console.log.bind(console)
const _warn = console.warn.bind(console)
const _error = console.error.bind(console)
const _info = console.info.bind(console)

export function initLogger() {
  console.log = (...args: unknown[]) => { _log(...args); push('log', args) }
  console.warn = (...args: unknown[]) => { _warn(...args); push('warn', args) }
  console.error = (...args: unknown[]) => { _error(...args); push('error', args) }
  console.info = (...args: unknown[]) => { _info(...args); push('info', args) }
}

/** Entradas após o id fornecido (ou todas se afterId = 0) */
export function getEntriesAfter(afterId: number): LogEntry[] {
  return buffer.filter((e) => e.id > afterId)
}

/** Últimas N entradas */
export function getRecentEntries(n = 200): LogEntry[] {
  return buffer.slice(-n)
}
