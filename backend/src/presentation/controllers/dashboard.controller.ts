import { Router } from 'express'
import { getRecentEntries, getEntriesAfter } from '../../infrastructure/logger.js'
import { CloudWatchClient, GetMetricStatisticsCommand, ListMetricsCommand } from '@aws-sdk/client-cloudwatch'
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { authenticateToken } from '../middleware/auth.js'
import { listAgents } from '../../infrastructure/database/agents.repository.js'

export const dashboardRoutes = Router()
dashboardRoutes.use(authenticateToken)

// Apenas admins
dashboardRoutes.use((req: any, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' })
  }
  next()
})

const MESSAGES_TABLE = process.env.DYNAMODB_MESSAGES_TABLE || 'tesouro-nacional-messages'
const CHATS_TABLE = process.env.DYNAMODB_CHATS_TABLE || 'tesouro-nacional-chats'
const EVAL_JOBS_TABLE = process.env.DYNAMODB_TABLE_EVAL_JOBS || 'fase2-eval-jobs'
const EVAL_FEEDBACK_TABLE = process.env.DYNAMODB_TABLE_EVAL_FEEDBACK || 'fase2-eval-feedback'
const REGION = process.env.AWS_REGION || 'us-east-1'

function getDynamo() {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
}

function getCW() {
  return new CloudWatchClient({ region: REGION })
}

// Retorna mapa sub → nome para os subs fornecidos
async function resolveUserNames(subs: string[]): Promise<Record<string, string>> {
  if (subs.length === 0) return {}
  try {
    const cognito = new CognitoIdentityProviderClient({ region: REGION })
    const userPoolId = process.env.COGNITO_USER_POOL_ID
    if (!userPoolId) return {}

    // Buscar todos os usuários e filtrar pelo sub localmente (evita múltiplas chamadas)
    const allUsers: any[] = []
    let token: string | undefined
    do {
      const res = await cognito.send(
        new ListUsersCommand({ UserPoolId: userPoolId, PaginationToken: token, Limit: 60 })
      )
      allUsers.push(...(res.Users || []))
      token = res.PaginationToken
    } while (token)

    const subsSet = new Set(subs)
    const map: Record<string, string> = {}
    for (const u of allUsers) {
      const attrs: Record<string, string> = {}
      u.Attributes?.forEach((a: any) => { if (a.Name) attrs[a.Name] = a.Value || '' })
      const sub = attrs['sub']
      if (sub && subsSet.has(sub)) {
        const name =
          attrs['name'] ||
          `${attrs['given_name'] || ''} ${attrs['family_name'] || ''}`.trim() ||
          attrs['email'] ||
          sub
        map[sub] = name
      }
    }
    return map
  } catch (e: any) {
    console.warn('[dashboard] Falha ao resolver nomes de usuário:', e.message)
    return {}
  }
}

// ---------------------------------------------------------------------------
// GET /api/admin/dashboard/stats — KPIs agregados
// ---------------------------------------------------------------------------
dashboardRoutes.get('/stats', async (_req, res) => {
  try {
    const dynamo = getDynamo()

    // Scan na tabela de mensagens (funciona bem para POC)
    const result = await dynamo.send(new ScanCommand({ TableName: MESSAGES_TABLE }))
    const items = result.Items || []

    const assistantMessages = items.filter((i) => i.role === 'assistant')
    const userMessages = items.filter((i) => i.role === 'user')

    // Chats únicos
    const uniqueChats = new Set(items.map((i) => i.chatId)).size
    // Usuários únicos
    const uniqueUsers = new Set(items.map((i) => i.userId).filter(Boolean)).size

    // Tokens
    const totalInputTokens = assistantMessages.reduce((s, i) => s + (i.inputTokens || 0), 0)
    const totalOutputTokens = assistantMessages.reduce((s, i) => s + (i.outputTokens || 0), 0)

    // Latência média
    const withLatency = assistantMessages.filter((i) => i.latencyMs)
    const avgLatencyMs =
      withLatency.length > 0
        ? Math.round(withLatency.reduce((s, i) => s + i.latencyMs, 0) / withLatency.length)
        : null

    // Mensagens por dia (últimos 14 dias)
    const now = Date.now()
    const msPerDay = 86400000
    const dailyMap: Record<string, number> = {}
    for (let d = 13; d >= 0; d--) {
      const dateStr = new Date(now - d * msPerDay).toISOString().substring(0, 10)
      dailyMap[dateStr] = 0
    }
    for (const msg of userMessages) {
      const day = (msg.timestamp || '').substring(0, 10)
      if (day in dailyMap) dailyMap[day]++
    }
    const dailyActivity = Object.entries(dailyMap).map(([date, count]) => ({ date, count }))

    // Feedback stats
    const totalLikes = assistantMessages.filter((i) => i.feedback === 'like').length
    const totalDislikes = assistantMessages.filter((i) => i.feedback === 'dislike').length
    const totalRated = totalLikes + totalDislikes
    const satisfactionRate = totalRated > 0 ? Math.round((totalLikes / totalRated) * 100) : null

    // SISWEB stats (compliance — registro obrigatório de interações)
    const siswebSent = assistantMessages.filter((i) => i.siswebStatus === 'sent').length
    const siswebFailed = assistantMessages.filter((i) => i.siswebStatus === 'failed').length
    const siswebPending = assistantMessages.filter((i) => i.siswebStatus === 'pending').length
    const siswebTracked = siswebSent + siswebFailed + siswebPending
    const siswebSuccessRate = siswebTracked > 0 ? Math.round((siswebSent / siswebTracked) * 100) : null

    // Breakdown por agente (a partir do agentId gravado em cada mensagem do assistente)
    const agents = await listAgents()
    const agentNameById: Record<string, string> = {}
    for (const a of agents) agentNameById[a.id] = a.name

    const byAgentMap: Record<string, any> = {}
    for (const m of assistantMessages) {
      const aid = m.agentId || 'desconhecido'
      if (!byAgentMap[aid]) {
        byAgentMap[aid] = {
          agentId: aid,
          agentName: agentNameById[aid] || (aid === 'desconhecido' ? 'Sem agente' : aid),
          interactions: 0,
          inputTokens: 0,
          outputTokens: 0,
          latencySum: 0,
          latencyCount: 0,
          likes: 0,
          dislikes: 0,
          siswebSent: 0,
          siswebFailed: 0,
        }
      }
      const b = byAgentMap[aid]
      b.interactions++
      b.inputTokens += m.inputTokens || 0
      b.outputTokens += m.outputTokens || 0
      if (m.latencyMs) { b.latencySum += m.latencyMs; b.latencyCount++ }
      if (m.feedback === 'like') b.likes++
      if (m.feedback === 'dislike') b.dislikes++
      if (m.siswebStatus === 'sent') b.siswebSent++
      if (m.siswebStatus === 'failed') b.siswebFailed++
    }

    const byAgent = Object.values(byAgentMap)
      .map((b: any) => {
        const rated = b.likes + b.dislikes
        return {
          agentId: b.agentId,
          agentName: b.agentName,
          interactions: b.interactions,
          inputTokens: b.inputTokens,
          outputTokens: b.outputTokens,
          avgLatencyMs: b.latencyCount > 0 ? Math.round(b.latencySum / b.latencyCount) : null,
          likes: b.likes,
          dislikes: b.dislikes,
          satisfactionRate: rated > 0 ? Math.round((b.likes / rated) * 100) : null,
          siswebSent: b.siswebSent,
          siswebFailed: b.siswebFailed,
        }
      })
      .sort((a, b) => b.interactions - a.interactions)

    return res.json({
      totalConversations: uniqueChats,
      totalMessages: userMessages.length,
      totalUsers: uniqueUsers,
      totalInputTokens,
      totalOutputTokens,
      avgLatencyMs,
      dailyActivity,
      totalLikes,
      totalDislikes,
      totalRated,
      satisfactionRate,
      siswebSent,
      siswebFailed,
      siswebPending,
      siswebSuccessRate,
      byAgent,
    })
  } catch (err: any) {
    console.error('[dashboard] Erro em /stats:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar estatísticas' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/admin/dashboard/history?page=1&pageSize=20 — histórico com paginação
// ---------------------------------------------------------------------------
dashboardRoutes.get('/history', async (req, res) => {
  try {
    const dynamo = getDynamo()
    const pageSize = Math.min(Number(req.query.pageSize) || 20, 100)
    const page = Math.max(Number(req.query.page) || 1, 1)

    // Scan completo de mensagens do assistente (POC — tabela pequena)
    const allItems: any[] = []
    let lastKey: Record<string, any> | undefined

    do {
      const result = await dynamo.send(new ScanCommand({
        TableName: MESSAGES_TABLE,
        FilterExpression: '#role = :role',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: { ':role': 'assistant' },
        ExclusiveStartKey: lastKey,
      }))
      allItems.push(...(result.Items || []))
      lastKey = result.LastEvaluatedKey
    } while (lastKey)

    // Ordenar por timestamp decrescente
    allItems.sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1))

    const total = allItems.length
    const totalPages = Math.ceil(total / pageSize)
    const pageItems = allItems.slice((page - 1) * pageSize, page * pageSize)

    // Buscar mensagens do usuário para os chats desta página
    const chatIds = [...new Set(pageItems.map((i) => i.chatId))]
    const userMsgMap: Record<string, any[]> = {}
    await Promise.all(
      chatIds.map(async (chatId) => {
        const r = await dynamo.send(new QueryCommand({
          TableName: MESSAGES_TABLE,
          KeyConditionExpression: 'chatId = :chatId',
          FilterExpression: '#role = :role',
          ExpressionAttributeNames: { '#role': 'role' },
          ExpressionAttributeValues: { ':chatId': chatId, ':role': 'user' },
        }))
        userMsgMap[chatId] = r.Items || []
      })
    )

    // Sempre resolver nomes via Cognito — o token de acesso não inclui name/email
    const uniqueSubs = [...new Set(pageItems.map((i) => i.userId).filter(Boolean))]
    const nameMap = await resolveUserNames(uniqueSubs)

    const rows = pageItems.map((msg) => {
      const userMsgs = (userMsgMap[msg.chatId] || [])
        .filter((u) => u.timestamp < msg.timestamp)
        .sort((a: any, b: any) => (a.timestamp > b.timestamp ? -1 : 1))
      const question = userMsgs[0]?.content || userMsgMap[msg.chatId]?.[0]?.content || null

      // Cognito lookup é a fonte primária; msg.userName só como fallback se não for UUID
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(msg.userName || '')
      const userName = nameMap[msg.userId] || (!isUuid && msg.userName) || msg.userId

      return {
        messageId: msg.messageId,
        chatId: msg.chatId,
        userId: msg.userId,
        userName,
        question,
        answer: msg.content,
        timestamp: msg.timestamp,
        inputTokens: msg.inputTokens ?? null,
        outputTokens: msg.outputTokens ?? null,
        latencyMs: msg.latencyMs ?? null,
        agentId: msg.agentId ?? null,
        feedback: msg.feedback ?? null,
        feedbackComment: msg.feedbackComment ?? null,
        siswebStatus: msg.siswebStatus ?? null,
        siswebError: msg.siswebError ?? null,
        siswebSentAt: msg.siswebSentAt ?? null,
      }
    })

    return res.json({ rows, page, pageSize, total, totalPages })
  } catch (err: any) {
    console.error('[dashboard] Erro em /history:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar histórico' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/admin/dashboard/feedback?type=dislike&page=1&pageSize=20
// Retorna mensagens com feedback (like/dislike), mais recentes primeiro
// ---------------------------------------------------------------------------
dashboardRoutes.get('/feedback', async (req, res) => {
  try {
    const dynamo = getDynamo()
    const type = (req.query.type as string) || 'dislike'
    const pageSize = Math.min(Number(req.query.pageSize) || 20, 100)
    const page = Math.max(Number(req.query.page) || 1, 1)

    const allItems: any[] = []
    let lastKey: Record<string, any> | undefined
    do {
      const result = await dynamo.send(new ScanCommand({
        TableName: MESSAGES_TABLE,
        FilterExpression: '#role = :role AND #feedback = :feedback',
        ExpressionAttributeNames: { '#role': 'role', '#feedback': 'feedback' },
        ExpressionAttributeValues: { ':role': 'assistant', ':feedback': type },
        ExclusiveStartKey: lastKey,
      }))
      allItems.push(...(result.Items || []))
      lastKey = result.LastEvaluatedKey
    } while (lastKey)

    allItems.sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1))

    const total = allItems.length
    const totalPages = Math.ceil(total / pageSize) || 1
    const pageItems = allItems.slice((page - 1) * pageSize, page * pageSize)

    // Buscar perguntas correspondentes
    const chatIds = [...new Set(pageItems.map((i) => i.chatId))]
    const userMsgMap: Record<string, any[]> = {}
    await Promise.all(
      chatIds.map(async (chatId) => {
        const r = await dynamo.send(new QueryCommand({
          TableName: MESSAGES_TABLE,
          KeyConditionExpression: 'chatId = :chatId',
          FilterExpression: '#role = :role',
          ExpressionAttributeNames: { '#role': 'role' },
          ExpressionAttributeValues: { ':chatId': chatId, ':role': 'user' },
        }))
        userMsgMap[chatId] = r.Items || []
      })
    )

    const uniqueSubs = [...new Set(pageItems.map((i) => i.userId).filter(Boolean))]
    const nameMap = await resolveUserNames(uniqueSubs)

    const rows = pageItems.map((msg) => {
      const userMsgs = (userMsgMap[msg.chatId] || [])
        .filter((u: any) => u.timestamp < msg.timestamp)
        .sort((a: any, b: any) => (a.timestamp > b.timestamp ? -1 : 1))
      const question = userMsgs[0]?.content || userMsgMap[msg.chatId]?.[0]?.content || null
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(msg.userName || '')
      const userName = nameMap[msg.userId] || (!isUuid && msg.userName) || msg.userId
      return {
        messageId: msg.messageId,
        chatId: msg.chatId,
        userId: msg.userId,
        userName,
        question,
        answer: msg.content,
        timestamp: msg.timestamp,
        feedback: msg.feedback,
        feedbackComment: msg.feedbackComment ?? null,
      }
    })

    return res.json({ rows, page, pageSize, total, totalPages })
  } catch (err: any) {
    console.error('[dashboard] Erro em /feedback:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar feedbacks' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/admin/dashboard/cloudwatch — uso de modelos no Bedrock (CloudWatch)
// Métricas reais: namespace AWS/Bedrock, dimensão ModelId
// ---------------------------------------------------------------------------
dashboardRoutes.get('/cloudwatch', async (req, res) => {
  try {
    const cw = getCW()
    const days = Math.min(Number(req.query.days) || 7, 30)
    const endTime = new Date()
    const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000)

    // 1. Descobrir quais ModelIds tiveram invocações (lista de métricas)
    const listed = await cw.send(new ListMetricsCommand({
      Namespace: 'AWS/Bedrock',
      MetricName: 'Invocations',
    }))

    const modelIds = [...new Set(
      (listed.Metrics || [])
        .map((m) => m.Dimensions?.find((d) => d.Name === 'ModelId')?.Value)
        .filter((v): v is string => !!v)
    )]

    // 2. Para cada modelo, somar métricas no período
    const period = days * 24 * 60 * 60 // janela inteira em um datapoint

    async function sumMetric(modelId: string, metricName: string, stat: 'Sum' | 'Average'): Promise<number | null> {
      try {
        const r = await cw.send(new GetMetricStatisticsCommand({
          Namespace: 'AWS/Bedrock',
          MetricName: metricName,
          Dimensions: [{ Name: 'ModelId', Value: modelId }],
          StartTime: startTime,
          EndTime: endTime,
          Period: period,
          Statistics: [stat],
        }))
        const dps = r.Datapoints || []
        if (dps.length === 0) return null
        if (stat === 'Sum') return dps.reduce((s, d) => s + (d.Sum || 0), 0)
        return Math.round(dps.reduce((s, d) => s + (d.Average || 0), 0) / dps.length)
      } catch {
        return null
      }
    }

    const models = await Promise.all(
      modelIds.map(async (modelId) => {
        const [invocations, inputTokens, outputTokens, avgLatencyMs, clientErrors] = await Promise.all([
          sumMetric(modelId, 'Invocations', 'Sum'),
          sumMetric(modelId, 'InputTokenCount', 'Sum'),
          sumMetric(modelId, 'OutputTokenCount', 'Sum'),
          sumMetric(modelId, 'InvocationLatency', 'Average'),
          sumMetric(modelId, 'InvocationClientErrors', 'Sum'),
        ])
        // Nome curto e legível do modelo
        const shortName = modelId.replace(/^arn:aws:bedrock:[^/]+::foundation-model\//, '')
        return {
          modelId: shortName,
          invocations: invocations ?? 0,
          inputTokens: inputTokens ?? 0,
          outputTokens: outputTokens ?? 0,
          avgLatencyMs,
          clientErrors: clientErrors ?? 0,
        }
      })
    )

    // Só modelos com algum uso, ordenados por invocações
    const used = models
      .filter((m) => m.invocations > 0 || m.inputTokens > 0)
      .sort((a, b) => b.invocations - a.invocations)

    return res.json({ days, region: REGION, models: used })
  } catch (err: any) {
    console.error('[dashboard] Erro em /cloudwatch:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar métricas CloudWatch' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/admin/dashboard/logs/stream — SSE: streaming de logs em tempo real
// ---------------------------------------------------------------------------
dashboardRoutes.get('/logs/stream', (req: any, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // desabilitar buffer no nginx
  res.flushHeaders()

  // Enviar histórico recente imediatamente
  const history = getRecentEntries(200)
  if (history.length > 0) {
    res.write(`data: ${JSON.stringify({ type: 'history', entries: history })}\n\n`)
  }

  let lastId = history.length > 0 ? history[history.length - 1].id : 0

  // Polling a cada 1s por novas entradas
  const interval = setInterval(() => {
    const newEntries = getEntriesAfter(lastId)
    if (newEntries.length > 0) {
      lastId = newEntries[newEntries.length - 1].id
      res.write(`data: ${JSON.stringify({ type: 'entries', entries: newEntries })}\n\n`)
    } else {
      // Keepalive para manter a conexão aberta pelo ALB (timeout padrão 60s)
      res.write(': keepalive\n\n')
    }
  }, 1000)

  req.on('close', () => clearInterval(interval))
})

// ---------------------------------------------------------------------------
// GET /api/admin/dashboard/logs — últimas N entradas (snapshot)
// ---------------------------------------------------------------------------
dashboardRoutes.get('/logs', (_req, res) => {
  res.json({ entries: getRecentEntries(200) })
})

// ---------------------------------------------------------------------------
// DELETE /api/admin/dashboard/feedback/:messageId?chatId=...&timestamp=...
// Remove os campos feedback e feedbackComment de uma mensagem
// ---------------------------------------------------------------------------
dashboardRoutes.delete('/feedback/:messageId', async (req, res) => {
  const { messageId } = req.params
  const { chatId, timestamp } = req.query as { chatId?: string; timestamp?: string }

  if (!chatId || !timestamp) {
    return res.status(400).json({ error: 'chatId e timestamp são obrigatórios' })
  }

  try {
    const dynamo = getDynamo()

    await dynamo.send(new UpdateCommand({
      TableName: MESSAGES_TABLE,
      Key: { chatId, timestamp },
      UpdateExpression: 'REMOVE #fb, feedbackComment',
      ExpressionAttributeNames: { '#fb': 'feedback' },
    }))

    console.info(`[dashboard] Feedback removido: messageId=${messageId} chatId=${chatId}`)
    return res.json({ ok: true, messageId })
  } catch (err: any) {
    console.error('[dashboard] Erro ao remover feedback:', err.message)
    return res.status(500).json({ error: 'Erro ao remover feedback' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/admin/dashboard/evaluations — visão geral dos jobs de avaliação
// ---------------------------------------------------------------------------
dashboardRoutes.get('/evaluations', async (_req, res) => {
  try {
    const dynamo = getDynamo()

    // Busca todos os jobs de avaliação
    const jobsResult = await dynamo.send(new ScanCommand({ TableName: EVAL_JOBS_TABLE }))
    const jobs = (jobsResult.Items || []).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    )

    // Busca todos os feedbacks das avaliações (scan único)
    const feedbackResult = await dynamo.send(new ScanCommand({ TableName: EVAL_FEEDBACK_TABLE }))
    const feedbacks = feedbackResult.Items || []

    // Agrega feedbacks por jobId
    const feedbackByJob: Record<string, { ups: number; downs: number; comments: { questionIndex: number; vote: string; comment?: string; userId: string; createdAt: string }[] }> = {}
    for (const f of feedbacks) {
      if (!feedbackByJob[f.jobId]) feedbackByJob[f.jobId] = { ups: 0, downs: 0, comments: [] }
      if (f.vote === 'up') feedbackByJob[f.jobId].ups++
      else feedbackByJob[f.jobId].downs++
      if (f.comment) {
        feedbackByJob[f.jobId].comments.push({
          questionIndex: f.questionIndex,
          vote: f.vote,
          comment: f.comment,
          userId: f.userId,
          createdAt: f.createdAt,
        })
      }
    }

    // Totais gerais
    const totalJobs = jobs.length
    const completedJobs = jobs.filter((j) => j.status === 'completed').length
    const totalQuestions = jobs.reduce((s, j) => s + (j.totalQuestions || 0), 0)
    const totalAnswered = jobs.reduce((s, j) => s + (j.completedQuestions || 0), 0)
    const totalUps = feedbacks.filter((f) => f.vote === 'up').length
    const totalDowns = feedbacks.filter((f) => f.vote === 'down').length
    const totalRated = totalUps + totalDowns
    const satisfactionRate = totalRated > 0 ? Math.round((totalUps / totalRated) * 100) : null

    const jobRows = jobs.map((j) => ({
      jobId: j.jobId,
      agentName: j.agentName,
      agentAliasName: j.agentAliasName ?? null,
      modelIdentifier: j.modelIdentifier ?? null,
      totalQuestions: j.totalQuestions ?? 0,
      completedQuestions: j.completedQuestions ?? 0,
      errorCount: j.errorCount ?? 0,
      status: j.status,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      createdBy: j.createdBy ?? null,
      feedbackUps: feedbackByJob[j.jobId]?.ups ?? 0,
      feedbackDowns: feedbackByJob[j.jobId]?.downs ?? 0,
      feedbackComments: feedbackByJob[j.jobId]?.comments ?? [],
    }))

    return res.json({
      summary: { totalJobs, completedJobs, totalQuestions, totalAnswered, totalUps, totalDowns, totalRated, satisfactionRate },
      jobs: jobRows,
    })
  } catch (err: any) {
    console.error('[dashboard] Erro em /evaluations:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar avaliações' })
  }
})
