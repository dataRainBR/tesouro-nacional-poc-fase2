/**
 * Tesouro Nacional — Fase 2 — Backend Entry Point
 *
 * Express server com todas as rotas registradas.
 */

import { initLogger } from './infrastructure/logger.js'
initLogger()

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

// Repositories (inicialização de tabelas)
import { createTablesIfNotExist } from './infrastructure/database/dynamodb-chats.repository.js'
import { createTableIfNotExists as createOrgTableIfNotExists } from './infrastructure/database/dynamodb.client.js'
import { createAgentsTableIfNotExists } from './infrastructure/database/agents.repository.js'
import { createPareceresTableIfNotExists } from './infrastructure/database/pareceres.repository.js'
import { createComparativosTableIfNotExists } from './infrastructure/database/comparativos.repository.js'
import { createFineTunedModelsTableIfNotExists } from './infrastructure/database/finetuned-models.repository.js'
import { createEvalTablesIfNotExist } from './infrastructure/database/evaluations.repository.js'
import { startEvaluationWorker } from './infrastructure/workers/evaluation-worker.js'

// Controllers
import { authRoutes } from './presentation/controllers/auth.controller.js'
import { chatRoutes } from './presentation/controllers/chat.controller.js'
import { chatsRoutes } from './presentation/controllers/chats.controller.js'
import { messagesRoutes } from './presentation/controllers/messages.controller.js'
import { agentsRoutes } from './presentation/controllers/agents.controller.js'
import { pareceresRoutes } from './presentation/controllers/pareceres.controller.js'
import { comparativosRoutes } from './presentation/controllers/comparativos.controller.js'
import { finetunedModelsRoutes } from './presentation/controllers/finetuned-models.controller.js'
import { adminRoutes } from './presentation/controllers/admin.controller.js'
import { dashboardRoutes } from './presentation/controllers/dashboard.controller.js'
import { evaluationsRoutes } from './presentation/controllers/evaluations.controller.js'
import { organizationRoutes } from './presentation/controllers/organization.controller.js'
import { configRoutes } from './presentation/controllers/config.controller.js'

const app = express()
const PORT = process.env.PORT || 3001

// ── Middleware global ─────────────────────────────────────────────────────────
// HSTS desabilitado: a POC é servida via HTTP no DNS do ELB (sem certificado válido
// para esse hostname). Com HSTS o browser força HTTPS e a validação TLS falha,
// quebrando as chamadas fetch() do frontend. Reabilitar quando houver domínio + cert próprios.
app.use(helmet({ hsts: false }))

// Em dev, aceita qualquer porta localhost (Vite pode subir em 5173, 5174, 5175...)
// Em produção, restringe estritamente ao(s) domínio(s) configurado(s) em CORS_ORIGIN.
const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim())
const isDev = process.env.NODE_ENV !== 'production'

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true) // requisições sem origin (curl, health check)
    if (isDev && /^http:\/\/localhost:\d+$/.test(origin)) return callback(null, true)
    if (corsOrigins?.includes(origin)) return callback(null, true)
    // POC servida atrás do ALB (mesmo host de frontend e backend) — aceitar o domínio do ELB
    if (/^https?:\/\/[a-zA-Z0-9.-]+\.elb\.amazonaws\.com$/.test(origin)) return callback(null, true)
    callback(new Error(`Origem não permitida pelo CORS: ${origin}`))
  },
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))

// Rate limiting global
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 100, // 100 requisições por IP por minuto
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em instantes.' },
})
app.use(limiter)

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' })
})

// ── Rotas ─────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/chats', chatsRoutes)
app.use('/api/messages', messagesRoutes)
app.use('/api/agents', agentsRoutes)
app.use('/api/pareceres', pareceresRoutes)
app.use('/api/comparativos', comparativosRoutes)
app.use('/api/finetuned-models', finetunedModelsRoutes)
app.use('/api/admin/dashboard', dashboardRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/evaluations', evaluationsRoutes)
app.use('/api/organization', organizationRoutes)
app.use('/api/config', configRoutes)

// ── Inicialização ─────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    // Criar tabelas DynamoDB se necessário
    await Promise.allSettled([
      createTablesIfNotExist(),
      createOrgTableIfNotExists(),
      createAgentsTableIfNotExists(),
      createPareceresTableIfNotExists(),
      createComparativosTableIfNotExists(),
      createFineTunedModelsTableIfNotExists(),
      createEvalTablesIfNotExist(),
    ])
    console.info('[server] Tabelas DynamoDB verificadas')
  } catch (err: any) {
    console.warn('[server] Erro ao verificar tabelas (continuando):', err.message)
  }

  startEvaluationWorker()

  app.listen(PORT, () => {
    console.info(`[server] 🚀 Backend Fase 2 rodando em http://localhost:${PORT}`)
  })
}

bootstrap()
