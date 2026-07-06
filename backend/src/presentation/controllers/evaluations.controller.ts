/**
 * Evaluations Controller
 *
 * POST /api/evaluations/batch              — inicia job em lote (via fila)
 * GET  /api/evaluations/jobs              — lista todos os jobs
 * GET  /api/evaluations/jobs/:jobId       — job + resultados
 * DELETE /api/evaluations/jobs/:jobId     — aborta job
 * POST /api/evaluations/jobs/:jobId/export — gera JSONL, faz upload p/ S3 e retorna URL
 *
 * POST /api/evaluations/invoke            — invoca agente (legado, uma pergunta)
 */

import { Router } from 'express'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { generateResponseWithBedrock } from '../../infrastructure/aws/bedrock.service.js'
import { getAgent, getDefaultAgent } from '../../infrastructure/database/agents.repository.js'
import { authenticateToken } from '../middleware/auth.js'
import {
  createJob,
  createResults,
  deleteJob,
  getJob,
  getResults,
  listJobs,
  updateJobProgress,
  upsertFeedback,
  getAllFeedbacks,
  type EvalJob,
  type EvalResult,
  type EvalFeedback,
} from '../../infrastructure/database/evaluations.repository.js'
import {
  isSQSEnabled,
  sendEvalMessages,
} from '../../infrastructure/aws/sqs.service.js'
import { enqueueLocal } from '../../infrastructure/workers/evaluation-worker.js'

const S3_BUCKET = process.env.EVALUATIONS_S3_BUCKET || 'evaluation-dataset-rtn'
const S3_PREFIX = process.env.EVALUATIONS_S3_PREFIX || 'src/'

function buildExportJsonl(job: EvalJob, results: EvalResult[]): string {
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

function getS3Client() {
  const region = process.env.AWS_REGION || 'us-east-1'
  const credentials =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined
  return new S3Client({ region, credentials })
}

export const evaluationsRoutes = Router()

evaluationsRoutes.use(authenticateToken)

const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem executar avaliações.' })
  }
  next()
}

// ---------------------------------------------------------------------------
// POST /api/evaluations/batch
// Body: { questions: string[], agentId?: string }
// ---------------------------------------------------------------------------
interface QuestionInput {
  question: string
  referenceResponse?: string
  category?: string
}

evaluationsRoutes.post('/batch', requireAdmin, async (req, res) => {
  const { questions, agentId, agentAliasId, agentAliasName, modelIdentifier } = req.body

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'O campo questions deve ser um array não vazio.' })
  }

  // Normaliza: aceita string[] ou { question, referenceResponse, category }[]
  const normalizedQuestions: QuestionInput[] = questions.map((q: any) =>
    typeof q === 'string' ? { question: q } : { question: q.question, referenceResponse: q.referenceResponse, category: q.category }
  )

  try {
    let agent
    if (agentId) {
      agent = await getAgent(agentId)
      if (!agent) {
        return res.status(404).json({ error: `Agente "${agentId}" não encontrado.` })
      }
    } else {
      agent = await getDefaultAgent()
      if (!agent) {
        return res.status(404).json({ error: 'Nenhum agente configurado.' })
      }
    }

    // alias efetivo: override > padrão do agente
    const effectiveAliasId: string = agentAliasId?.trim() || agent.agentAliasId
    const effectiveAliasName: string | undefined = agentAliasName?.trim() || undefined

    // Criar o job no DynamoDB
    const job = await createJob({
      agentId: agent.id,
      agentName: agent.name,
      agentAliasId: effectiveAliasId,
      agentAliasName: effectiveAliasName,
      modelIdentifier: modelIdentifier?.trim() || undefined,
      totalQuestions: normalizedQuestions.length,
      status: 'running',
      createdBy: req.user?.id || req.user?.email || 'unknown',
    })

    // Criar registros de resultado com status "pending"
    await createResults(
      normalizedQuestions.map((q, i) => ({
        jobId: job.jobId,
        questionIndex: i,
        question: q.question,
        referenceResponse: q.referenceResponse ?? null,
        category: q.category ?? null,
        answer: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        status: 'pending' as const,
        error: null,
      }))
    )

    // Enfileirar mensagens (SQS ou fila local)
    const messages = normalizedQuestions.map((q, i) => ({
      jobId: job.jobId,
      questionIndex: i,
      question: q.question,
      referenceResponse: q.referenceResponse,
      category: q.category,
      agentId: agent!.id,
      agentAliasId: effectiveAliasId !== agent!.agentAliasId ? effectiveAliasId : undefined,
    }))

    if (isSQSEnabled()) {
      await sendEvalMessages(messages)
    } else {
      enqueueLocal(messages)
    }

    console.info(
      `[evaluations] Batch job criado: jobId=${job.jobId} ` +
      `questions=${questions.length} agent=${agent.name} ` +
      `mode=${isSQSEnabled() ? 'sqs' : 'local'}`
    )

    return res.status(201).json({ jobId: job.jobId })
  } catch (err: any) {
    console.error('[evaluations] batch error:', err.message)
    return res.status(500).json({ error: err.message || 'Erro ao criar job.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/evaluations/jobs
// ---------------------------------------------------------------------------
evaluationsRoutes.get('/jobs', requireAdmin, async (_req, res) => {
  try {
    const jobs = await listJobs()
    return res.json(jobs)
  } catch (err: any) {
    console.error('[evaluations] listJobs error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /api/evaluations/jobs/:jobId
// ---------------------------------------------------------------------------
evaluationsRoutes.get('/jobs/:jobId', requireAdmin, async (req, res) => {
  const { jobId } = req.params
  try {
    let job = await getJob(jobId)
    if (!job) return res.status(404).json({ error: 'Job não encontrado.' })
    const [results, feedbacks] = await Promise.all([getResults(jobId), getAllFeedbacks(jobId)])

    // Reconcilia o registro do job com os resultados reais caso esteja desatualizado
    const actualCompleted = results.filter((r) => r.status === 'done' || r.status === 'error').length
    const actualErrors = results.filter((r) => r.status === 'error').length
    const allDone = results.length > 0 && results.every((r) => r.status === 'done' || r.status === 'error')
    const shouldBeCompleted = allDone && actualCompleted >= job.totalQuestions
    const isStale = actualCompleted !== job.completedQuestions || actualErrors !== job.errorCount
      || (shouldBeCompleted && job.status === 'running')

    if (isStale) {
      const newStatus = job.status === 'aborted'
        ? 'aborted'
        : shouldBeCompleted ? 'completed' : 'running'
      await updateJobProgress(jobId, actualCompleted, actualErrors, newStatus)
      job = { ...job, completedQuestions: actualCompleted, errorCount: actualErrors, status: newStatus }
    }

    return res.json({ job, results, feedbacks })
  } catch (err: any) {
    console.error('[evaluations] getJob error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/evaluations/jobs/:jobId
// ?force=true → exclui permanentemente do histórico (qualquer status)
// sem ?force   → apenas aborta jobs em execução
// ---------------------------------------------------------------------------
evaluationsRoutes.delete('/jobs/:jobId', requireAdmin, async (req, res) => {
  const { jobId } = req.params
  const force = req.query.force === 'true'
  try {
    const job = await getJob(jobId)
    if (!job) return res.status(404).json({ error: 'Job não encontrado.' })

    if (force) {
      // Aborta primeiro se ainda em execução, depois deleta permanentemente
      if (job.status === 'running' || job.status === 'pending') {
        await updateJobProgress(jobId, job.completedQuestions, job.errorCount, 'aborted')
      }
      await deleteJob(jobId)
      return res.json({ ok: true, deleted: true })
    }

    // Comportamento legado: apenas aborta
    if (job.status === 'completed') {
      return res.status(400).json({ error: 'Job já concluído, não pode ser abortado.' })
    }
    await updateJobProgress(jobId, job.completedQuestions, job.errorCount, 'aborted')
    return res.json({ ok: true })
  } catch (err: any) {
    console.error('[evaluations] deleteJob error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /api/evaluations/jobs/:jobId/export — gera JSONL e faz upload p/ S3
// ---------------------------------------------------------------------------
evaluationsRoutes.post('/jobs/:jobId/export', requireAdmin, async (req, res) => {
  const { jobId } = req.params
  try {
    const job = await getJob(jobId)
    if (!job) return res.status(404).json({ error: 'Job não encontrado.' })

    const results = await getResults(jobId)
    const jsonlContent = buildExportJsonl(job, results)

    if (!jsonlContent.trim()) {
      return res.status(400).json({ error: 'Nenhum resultado disponível para exportar.' })
    }

    const dateStr = job.createdAt.slice(0, 10).replace(/-/g, '')
    const key = `${S3_PREFIX}${dateStr}_${jobId.slice(0, 8)}_${job.agentName.replace(/[^a-zA-Z0-9]/g, '-')}.jsonl`

    const s3 = getS3Client()
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: jsonlContent,
        ContentType: 'application/x-ndjson',
        Metadata: {
          jobId,
          agentName: job.agentName,
          createdAt: job.createdAt,
          totalQuestions: String(job.totalQuestions),
          completedQuestions: String(job.completedQuestions),
        },
      })
    )

    const s3Url = `s3://${S3_BUCKET}/${key}`
    console.info(`[evaluations] export jobId=${jobId} → ${s3Url}`)

    return res.json({
      s3Url,
      bucket: S3_BUCKET,
      key,
      lines: jsonlContent.split('\n').length,
    })
  } catch (err: any) {
    console.error('[evaluations] export error:', err.message)
    return res.status(500).json({ error: err.message || 'Erro ao exportar para S3.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/evaluations/jobs/:jobId/results/:questionIndex/feedback
// Body: { vote: 'up' | 'down', comment?: string }
// ---------------------------------------------------------------------------
evaluationsRoutes.post('/jobs/:jobId/results/:questionIndex/feedback', requireAdmin, async (req, res) => {
  const { jobId, questionIndex } = req.params
  const idx = parseInt(questionIndex, 10)
  if (isNaN(idx)) return res.status(400).json({ error: 'questionIndex inválido.' })

  const { vote, comment } = req.body
  if (vote !== 'up' && vote !== 'down') {
    return res.status(400).json({ error: 'O campo vote deve ser "up" ou "down".' })
  }
  if (vote === 'down' && comment !== undefined && typeof comment !== 'string') {
    return res.status(400).json({ error: 'O campo comment deve ser uma string.' })
  }

  try {
    const now = new Date().toISOString()
    const feedback: EvalFeedback = {
      jobId,
      questionIndex: idx,
      vote,
      comment: vote === 'down' && comment?.trim() ? comment.trim() : undefined,
      userId: req.user?.id || req.user?.email || 'unknown',
      createdAt: now,
      updatedAt: now,
    }
    await upsertFeedback(feedback)
    return res.json(feedback)
  } catch (err: any) {
    console.error('[evaluations] feedback error:', err.message)
    return res.status(500).json({ error: err.message || 'Erro ao salvar feedback.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/evaluations/invoke  (legado — invoca uma única pergunta)
// ---------------------------------------------------------------------------
evaluationsRoutes.post('/invoke', requireAdmin, async (req, res) => {
  const { question, agentId } = req.body

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'O campo question é obrigatório.' })
  }

  try {
    let agent
    if (agentId) {
      agent = await getAgent(agentId)
      if (!agent) {
        return res.status(404).json({ error: `Agente com ID "${agentId}" não encontrado.` })
      }
    } else {
      agent = await getDefaultAgent()
      if (!agent) {
        return res.status(404).json({ error: 'Nenhum agente configurado.' })
      }
    }

    const sessionId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result = await generateResponseWithBedrock(question.trim(), sessionId, {
      agentId: agent.agentId,
      agentAliasId: agent.agentAliasId,
      region: agent.region,
    })

    return res.json({
      response: result.response,
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
      latencyMs: result.latencyMs ?? null,
    })
  } catch (err: any) {
    console.error('[evaluations] invoke error:', err.message)
    return res.status(500).json({ error: err.message || 'Erro ao invocar o agente.' })
  }
})
