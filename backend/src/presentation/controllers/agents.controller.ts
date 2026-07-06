/**
 * Agents Controller — CRUD de configurações de agentes Bedrock
 *
 * GET  /api/agents        → lista todos (usuários autenticados)
 * GET  /api/agents/default → retorna o agente padrão
 * POST /api/agents        → cria agente (admin)
 * PUT  /api/agents/:id    → atualiza agente (admin)
 * DELETE /api/agents/:id  → remove agente (admin)
 */

import { Router } from 'express'
import {
  listAgents,
  getAgent,
  getDefaultAgent,
  createAgent,
  updateAgent,
  deleteAgent,
} from '../../infrastructure/database/agents.repository.js'
import {
  listBedrockAgents,
  listAgentAliases,
} from '../../infrastructure/aws/bedrock-agent-discovery.service.js'
import { authenticateToken } from '../middleware/auth.js'

export const agentsRoutes = Router()

// Todas as rotas requerem autenticação
agentsRoutes.use(authenticateToken)

const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem gerenciar agentes.' })
  }
  next()
}

// ---------------------------------------------------------------------------
// GET /api/agents/bedrock/list — lista agents disponíveis na AWS (admin)
// ---------------------------------------------------------------------------
agentsRoutes.get('/bedrock/list', requireAdmin, async (req, res) => {
  const region = (req.query.region as string) || undefined
  try {
    const agents = await listBedrockAgents(region)
    return res.json(agents)
  } catch (err: any) {
    console.error('[agents] bedrock list error:', err.message)
    return res.status(500).json({ error: `Erro ao listar agentes Bedrock: ${err.message}` })
  }
})

// ---------------------------------------------------------------------------
// GET /api/agents/bedrock/:agentId/aliases — lista aliases de um agent na AWS (admin)
// ---------------------------------------------------------------------------
agentsRoutes.get('/bedrock/:agentId/aliases', requireAdmin, async (req, res) => {
  const { agentId } = req.params
  const region = (req.query.region as string) || undefined
  try {
    const aliases = await listAgentAliases(agentId, region)
    return res.json(aliases)
  } catch (err: any) {
    console.error('[agents] bedrock aliases error:', err.message)
    return res.status(500).json({ error: `Erro ao listar aliases: ${err.message}` })
  }
})

// ---------------------------------------------------------------------------
// GET /api/agents — lista agentes (todos os usuários autenticados)
// ---------------------------------------------------------------------------
agentsRoutes.get('/', async (req, res) => {
  try {
    const agents = await listAgents()
    return res.json(agents)
  } catch (err: any) {
    console.error('[agents] list error:', err.message)
    return res.status(500).json({ error: 'Erro ao listar agentes.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/agents/default — retorna o agente padrão
// ---------------------------------------------------------------------------
agentsRoutes.get('/default', async (req, res) => {
  try {
    const agent = await getDefaultAgent()
    if (!agent) return res.status(404).json({ error: 'Nenhum agente configurado.' })
    return res.json(agent)
  } catch (err: any) {
    console.error('[agents] default error:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar agente padrão.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/agents — cria agente (admin)
// ---------------------------------------------------------------------------
agentsRoutes.post('/', requireAdmin, async (req, res) => {
  const { name, description, agentId, agentAliasId, region, isDefault } = req.body

  if (!name?.trim() || !agentId?.trim() || !agentAliasId?.trim()) {
    return res.status(400).json({ error: 'name, agentId e agentAliasId são obrigatórios.' })
  }

  try {
    const agents = await listAgents()
    const agent = await createAgent({
      name: name.trim(),
      description: description?.trim(),
      agentId: agentId.trim(),
      agentAliasId: agentAliasId.trim(),
      region: region?.trim() || process.env.AWS_REGION || 'us-east-1',
      isDefault: isDefault === true || agents.length === 0,
    })
    return res.status(201).json(agent)
  } catch (err: any) {
    console.error('[agents] create error:', err.message)
    return res.status(500).json({ error: 'Erro ao criar agente.' })
  }
})

// ---------------------------------------------------------------------------
// PUT /api/agents/:id — atualiza agente (admin)
// ---------------------------------------------------------------------------
agentsRoutes.put('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params
  const { name, description, agentId, agentAliasId, region, isDefault } = req.body

  try {
    const existing = await getAgent(id)
    if (!existing) return res.status(404).json({ error: 'Agente não encontrado.' })

    const updated = await updateAgent(id, {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description.trim() }),
      ...(agentId !== undefined && { agentId: agentId.trim() }),
      ...(agentAliasId !== undefined && { agentAliasId: agentAliasId.trim() }),
      ...(region !== undefined && { region: region.trim() }),
      ...(isDefault !== undefined && { isDefault }),
    })
    return res.json(updated)
  } catch (err: any) {
    console.error('[agents] update error:', err.message)
    return res.status(500).json({ error: 'Erro ao atualizar agente.' })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/agents/:id — remove agente (admin)
// ---------------------------------------------------------------------------
agentsRoutes.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params

  try {
    const existing = await getAgent(id)
    if (!existing) return res.status(404).json({ error: 'Agente não encontrado.' })

    await deleteAgent(id)
    return res.json({ success: true })
  } catch (err: any) {
    console.error('[agents] delete error:', err.message)
    return res.status(500).json({ error: 'Erro ao remover agente.' })
  }
})
