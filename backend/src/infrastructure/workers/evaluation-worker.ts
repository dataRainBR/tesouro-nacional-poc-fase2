/**
 * Evaluation Worker
 *
 * Consome mensagens da fila (SQS ou fila em memória) e executa as avaliações
 * do agente Bedrock. Isso garante que as avaliações continuem mesmo que o
 * usuário saia da tela, pois o processamento ocorre no servidor.
 *
 * Modo SQS  → EVALUATIONS_QUEUE_URL configurada: mais durável, suporta
 *              múltiplas instâncias do backend.
 * Modo local → sem EVALUATIONS_QUEUE_URL: fila em memória, suficiente para
 *              ambientes de desenvolvimento e instância única.
 */

import {
  isSQSEnabled,
  receiveEvalMessages,
  deleteEvalMessage,
  type EvalMessage,
} from '../aws/sqs.service.js'
import {
  getJob,
  updateJobProgress,
  updateResult,
  getResults,
} from '../database/evaluations.repository.js'
import { generateResponseWithBedrock } from '../aws/bedrock.service.js'
import { getAgent } from '../database/agents.repository.js'

// ---------------------------------------------------------------------------
// Fila local (fallback sem SQS)
// ---------------------------------------------------------------------------
const localQueue: EvalMessage[] = []

export function enqueueLocal(messages: EvalMessage[]): void {
  localQueue.push(...messages)
}

// ---------------------------------------------------------------------------
// Worker principal
// ---------------------------------------------------------------------------
let workerStarted = false

export function startEvaluationWorker(): void {
  if (workerStarted) return
  workerStarted = true

  if (isSQSEnabled()) {
    console.info('[eval-worker] Modo SQS — consumindo de', process.env.EVALUATIONS_QUEUE_URL)
  } else {
    console.info('[eval-worker] Modo local — fila em memória (SQS não configurado)')
  }

  void pollLoop()
}

async function pollLoop(): Promise<void> {
  while (true) {
    try {
      if (isSQSEnabled()) {
        await processSQSBatch()
      } else {
        await processLocalBatch()
      }
    } catch (err: any) {
      console.error('[eval-worker] Erro no loop:', err.message)
      await sleep(5_000)
    }
  }
}

// ---------------------------------------------------------------------------
// SQS: long-poll + processa em paralelo
// ---------------------------------------------------------------------------
async function processSQSBatch(): Promise<void> {
  const messages = await receiveEvalMessages(10)
  if (messages.length === 0) return // WaitTimeSeconds=20 já esperou

  await Promise.all(
    messages.map(async ({ message, receiptHandle }) => {
      await processMessage(message)
      await deleteEvalMessage(receiptHandle)
    })
  )
}

// ---------------------------------------------------------------------------
// Local: processa até 5 por vez, aguarda 2 s se a fila estiver vazia
// ---------------------------------------------------------------------------
async function processLocalBatch(): Promise<void> {
  if (localQueue.length === 0) {
    await sleep(2_000)
    return
  }
  const batch = localQueue.splice(0, 5)
  await Promise.all(batch.map(processMessage))
}

// ---------------------------------------------------------------------------
// Verificar se o erro é transitório (merece retry)
// ---------------------------------------------------------------------------
function isTransientError(err: any): boolean {
  const msg: string = err?.message || ''
  // 424 = Lambda/API execution failure, timeout errors
  return (
    err?.['$metadata']?.httpStatusCode === 424 ||
    msg.includes('424') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('ThrottlingException') ||
    msg.includes('ServiceUnavailableException')
  )
}

// ---------------------------------------------------------------------------
// Processar uma mensagem individual (com retry para erros transitórios)
// ---------------------------------------------------------------------------
async function processMessage(msg: EvalMessage): Promise<void> {
  const { jobId, questionIndex, question, agentId } = msg
  const MAX_RETRIES = 2
  const RETRY_DELAY_MS = 3_000

  let lastErr: any = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const job = await getJob(jobId)
      if (!job || job.status === 'aborted') return

      const agent = await getAgent(agentId)
      if (!agent) throw new Error(`Agente ${agentId} não encontrado`)

      const sessionId = `eval-${jobId}-q${questionIndex}-a${attempt}`
      // Usa o alias da mensagem se fornecido (override), caso contrário usa o padrão do agente armazenado
      const result = await generateResponseWithBedrock(question, sessionId, {
        agentId: agent.agentId,
        agentAliasId: msg.agentAliasId || agent.agentAliasId,
        region: agent.region,
      })

      await updateResult({
        jobId,
        questionIndex,
        question,
        referenceResponse: msg.referenceResponse ?? null,
        category: msg.category ?? null,
        answer: result.response,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        latencyMs: result.latencyMs ?? null,
        status: 'done',
        error: null,
      })

      await refreshJobProgress(jobId)
      return // sucesso — sai do loop
    } catch (err: any) {
      lastErr = err
      if (attempt < MAX_RETRIES && isTransientError(err)) {
        console.warn(
          `[eval-worker] jobId=${jobId} idx=${questionIndex} tentativa ${attempt + 1}/${MAX_RETRIES} — erro transitório, aguardando ${RETRY_DELAY_MS}ms:`,
          err.message
        )
        await sleep(RETRY_DELAY_MS)
        continue
      }
      break
    }
  }

  // Todas tentativas falharam
  console.error(
    `[eval-worker] jobId=${jobId} idx=${questionIndex} erro (${MAX_RETRIES + 1} tentativas):`,
    lastErr?.message
  )
  await updateResult({
    jobId,
    questionIndex,
    question,
    referenceResponse: msg.referenceResponse ?? null,
    category: msg.category ?? null,
    answer: null,
    inputTokens: null,
    outputTokens: null,
    latencyMs: null,
    status: 'error',
    error: lastErr?.message || 'Erro desconhecido',
  })

  await refreshJobProgress(jobId)
}

async function refreshJobProgress(jobId: string): Promise<void> {
  try {
    const job = await getJob(jobId)
    if (!job) return
    const results = await getResults(jobId)
    const completed = results.filter(
      (r) => r.status === 'done' || r.status === 'error'
    ).length
    const errors = results.filter((r) => r.status === 'error').length
    // Preserve 'aborted' status — never overwrite a manual abort
    const status = job.status === 'aborted'
      ? 'aborted'
      : completed >= job.totalQuestions ? 'completed' : 'running'
    await updateJobProgress(jobId, completed, errors, status)
  } catch (err: any) {
    console.error('[eval-worker] refreshJobProgress error:', err.message)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
