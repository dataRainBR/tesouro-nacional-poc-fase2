/**
 * Módulo de detecção de abuso e controle de uso.
 * 
 * 1. Limite diário por usuário (200 mensagens/dia)
 * 2. Detecção de padrão de extração (mensagens similares sequenciais)
 * 
 * Armazena contadores em memória (suficiente para single-instance / POC).
 * Para produção multi-instância, migrar para DynamoDB ou Redis.
 */

import { createHash } from 'crypto'

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
const MAX_MESSAGES_PER_DAY = 200
const MAX_SIMILAR_MESSAGES = 5        // máx mensagens similares em uma janela
const SIMILARITY_WINDOW_MS = 30 * 60 * 1000 // 30 minutos
const EXTRACTION_COOLDOWN_MS = 10 * 60 * 1000 // 10 min de bloqueio

// ---------------------------------------------------------------------------
// Estruturas em memória
// ---------------------------------------------------------------------------
interface UserUsage {
  date: string           // YYYY-MM-DD
  count: number          // mensagens enviadas nesse dia
  recentHashes: { hash: string; timestamp: number }[]  // hashes recentes para detecção
  blockedUntil?: number  // timestamp até quando está bloqueado
}

const usageMap = new Map<string, UserUsage>()

// Limpar entradas antigas a cada hora
setInterval(() => {
  const today = getTodayKey()
  for (const [userId, usage] of usageMap.entries()) {
    if (usage.date !== today) {
      usageMap.delete(userId)
    }
  }
}, 60 * 60 * 1000)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTodayKey(): string {
  return new Date().toISOString().substring(0, 10)
}

/** Gera hash curto normalizado da mensagem (ignora variações triviais) */
function hashMessage(message: string): string {
  // Normaliza: lowercase, remove números, pontuação e espaços extras
  const normalized = message
    .toLowerCase()
    .replace(/\d+/g, 'N')          // substitui números por N
    .replace(/[^\wàáâãéêíóôõúçñ\s]/g, '') // remove pontuação
    .replace(/\s+/g, ' ')           // normaliza espaços
    .trim()
  return createHash('md5').update(normalized).digest('hex').substring(0, 12)
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export interface AbuseCheckResult {
  allowed: boolean
  reason?: string
  remainingToday?: number
}

/**
 * Verifica se o usuário pode enviar uma mensagem.
 * Retorna allowed=false com reason se bloqueado.
 */
export function checkAbuse(userId: string, message: string): AbuseCheckResult {
  const today = getTodayKey()
  let usage = usageMap.get(userId)

  // Inicializar ou resetar se mudou o dia
  if (!usage || usage.date !== today) {
    usage = { date: today, count: 0, recentHashes: [] }
    usageMap.set(userId, usage)
  }

  // 1. Verificar bloqueio ativo por padrão de extração
  if (usage.blockedUntil && Date.now() < usage.blockedUntil) {
    const remainingSec = Math.ceil((usage.blockedUntil - Date.now()) / 1000)
    return {
      allowed: false,
      reason: `Padrão de uso atípico detectado. Aguarde ${remainingSec} segundos.`,
    }
  }

  // 2. Verificar limite diário
  if (usage.count >= MAX_MESSAGES_PER_DAY) {
    return {
      allowed: false,
      reason: `Limite diário de ${MAX_MESSAGES_PER_DAY} mensagens atingido. Tente novamente amanhã.`,
      remainingToday: 0,
    }
  }

  // 3. Detecção de padrão de extração (mensagens similares)
  const now = Date.now()
  const msgHash = hashMessage(message)

  // Limpar hashes antigos (fora da janela)
  usage.recentHashes = usage.recentHashes.filter(h => now - h.timestamp < SIMILARITY_WINDOW_MS)

  // Contar quantas mensagens similares existem na janela
  const similarCount = usage.recentHashes.filter(h => h.hash === msgHash).length

  if (similarCount >= MAX_SIMILAR_MESSAGES) {
    usage.blockedUntil = now + EXTRACTION_COOLDOWN_MS
    console.warn(`[abuse] Padrão de extração detectado: userId=${userId} hash=${msgHash} similar=${similarCount}`)
    return {
      allowed: false,
      reason: 'Padrão de extração detectado. Aguarde 10 minutos antes de continuar.',
    }
  }

  // Registrar uso
  usage.count++
  usage.recentHashes.push({ hash: msgHash, timestamp: now })

  return {
    allowed: true,
    remainingToday: MAX_MESSAGES_PER_DAY - usage.count,
  }
}

/**
 * Retorna estatísticas de uso de um usuário (para o admin dashboard).
 */
export function getUserUsageStats(userId: string): { messagestoday: number; limit: number; blocked: boolean } {
  const today = getTodayKey()
  const usage = usageMap.get(userId)
  if (!usage || usage.date !== today) {
    return { messagestoday: 0, limit: MAX_MESSAGES_PER_DAY, blocked: false }
  }
  return {
    messagestoday: usage.count,
    limit: MAX_MESSAGES_PER_DAY,
    blocked: !!(usage.blockedUntil && Date.now() < usage.blockedUntil),
  }
}
