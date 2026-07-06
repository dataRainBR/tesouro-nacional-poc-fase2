/**
 * Comparativos Controller — Modo Comparativo (A/B entre agentes)
 *
 * POST   /api/comparativos/invoke    → envia pergunta para N agentes em paralelo
 * POST   /api/comparativos/:id/vote  → registra voto (qual resposta foi melhor)
 * GET    /api/comparativos           → lista comparações realizadas
 * GET    /api/comparativos/stats     → estatísticas e win-rate por agente
 * GET    /api/comparativos/:id       → retorna uma comparação específica
 */

import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { listAgents } from '../../infrastructure/database/agents.repository.js'
import { generateResponseWithBedrock } from '../../infrastructure/aws/bedrock.service.js'
import {
  createComparativo,
  voteComparativo,
  getComparativo,
  listComparativos,
  getComparativoStats,
  type ComparativoResposta,
} from '../../infrastructure/database/comparativos.repository.js'

export const comparativosRoutes = Router()

comparativosRoutes.use(authenticateToken)

// ---------------------------------------------------------------------------
// POST /api/comparativos/invoke — invoca N agentes com a mesma pergunta
// ---------------------------------------------------------------------------
comparativosRoutes.post('/invoke', async (req: any, res) => {
  const { message, agentIds } = req.body

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Mensagem é obrigatória.' })
  }

  if (!agentIds || !Array.isArray(agentIds) || agentIds.length < 2) {
    return res.status(400).json({ error: 'Selecione pelo menos 2 agentes para comparar.' })
  }

  if (agentIds.length > 4) {
    return res.status(400).json({ error: 'Máximo de 4 agentes por comparação.' })
  }

  // Buscar configs dos agentes selecionados
  const allAgents = await listAgents()
  const selectedAgents = agentIds
    .map((id: string) => allAgents.find((a) => a.id === id))
    .filter(Boolean)

  if (selectedAgents.length < 2) {
    return res.status(400).json({ error: 'Agentes selecionados não encontrados. Verifique os IDs.' })
  }

  // Invocar todos em paralelo
  const sessionId = `comp-${Date.now()}`
  const promises = selectedAgents.map(async (agent: any) => {
    const start = Date.now()
    try {
      const result = await generateResponseWithBedrock(message, `${sessionId}-${agent.id}`, {
        agentId: agent.agentId,
        agentAliasId: agent.agentAliasId,
        region: agent.region,
      })
      return {
        agentId: agent.id,
        agentName: agent.name,
        response: result.response,
        latencyMs: result.latencyMs || (Date.now() - start),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        trace: result.trace,
      } as ComparativoResposta
    } catch (err: any) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        response: `[Erro] ${err.message || 'Falha ao invocar agente'}`,
        latencyMs: Date.now() - start,
      } as ComparativoResposta
    }
  })

  try {
    const respostas = await Promise.all(promises)

    // Salvar no DynamoDB
    const comparativo = await createComparativo(
      message,
      respostas,
      req.user.id,
      req.user.name || req.user.email
    )

    return res.status(201).json(comparativo)
  } catch (err: any) {
    console.error('[comparativos] invoke error:', err.message)
    return res.status(500).json({ error: 'Erro ao executar comparação.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/comparativos/:id/vote — registra voto
// ---------------------------------------------------------------------------
comparativosRoutes.post('/:id/vote', async (req: any, res) => {
  const { voto } = req.body // agentId do vencedor ou 'empate'

  if (!voto) {
    return res.status(400).json({ error: 'Voto é obrigatório (agentId ou "empate").' })
  }

  try {
    const existing = await getComparativo(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Comparação não encontrada.' })

    // Validar que o voto é um agentId válido ou 'empate'
    if (voto !== 'empate') {
      const valid = existing.respostas.some((r) => r.agentId === voto)
      if (!valid) return res.status(400).json({ error: 'agentId do voto não está na comparação.' })
    }

    const updated = await voteComparativo(req.params.id, voto)
    return res.json(updated)
  } catch (err: any) {
    console.error('[comparativos] vote error:', err.message)
    return res.status(500).json({ error: 'Erro ao registrar voto.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/comparativos/stats — win-rate por agente
// ---------------------------------------------------------------------------
comparativosRoutes.get('/stats', async (req: any, res) => {
  try {
    const stats = await getComparativoStats()
    return res.json(stats)
  } catch (err: any) {
    console.error('[comparativos] stats error:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar estatísticas.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/comparativos — lista comparações
// ---------------------------------------------------------------------------
comparativosRoutes.get('/', async (req: any, res) => {
  try {
    const all = req.user.role === 'admin'
      ? await listComparativos()
      : await listComparativos(req.user.id)
    return res.json(all)
  } catch (err: any) {
    console.error('[comparativos] list error:', err.message)
    return res.status(500).json({ error: 'Erro ao listar comparações.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/comparativos/:id — retorna uma comparação
// ---------------------------------------------------------------------------
comparativosRoutes.get('/:id', async (req: any, res) => {
  try {
    const comp = await getComparativo(req.params.id)
    if (!comp) return res.status(404).json({ error: 'Comparação não encontrada.' })
    return res.json(comp)
  } catch (err: any) {
    console.error('[comparativos] get error:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar comparação.' })
  }
})
