/**
 * Fine-Tuned Models Controller — CRUD e invocação de modelos customizados
 *
 * GET    /api/finetuned-models          → lista modelos (usuários autenticados)
 * POST   /api/finetuned-models          → cadastra modelo (admin)
 * PUT    /api/finetuned-models/:id      → atualiza modelo (admin)
 * DELETE /api/finetuned-models/:id      → remove modelo (admin)
 * POST   /api/finetuned-models/:id/invoke → invoca o modelo com fallback automático
 */

import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import {
  listFineTunedModels,
  getFineTunedModel,
  createFineTunedModel,
  updateFineTunedModel,
  deleteFineTunedModel,
} from '../../infrastructure/database/finetuned-models.repository.js'
import {
  invokeFineTunedModel,
  estimateCost,
} from '../../infrastructure/aws/finetuned-model.service.js'
import type { FineTunedModelProvider } from '../../infrastructure/database/finetuned-models.repository.js'

export const finetunedModelsRoutes = Router()

finetunedModelsRoutes.use(authenticateToken)

const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem gerenciar modelos fine-tuned.' })
  }
  next()
}

const VALID_PROVIDERS: FineTunedModelProvider[] = ['bedrock-custom-model', 'bedrock-provisioned', 'sagemaker-endpoint']

// ---------------------------------------------------------------------------
// GET /api/finetuned-models — lista modelos (todos os usuários autenticados)
// ---------------------------------------------------------------------------
finetunedModelsRoutes.get('/', async (req, res) => {
  try {
    const models = await listFineTunedModels()
    return res.json(models)
  } catch (err: any) {
    console.error('[finetuned-models] list error:', err.message)
    return res.status(500).json({ error: 'Erro ao listar modelos fine-tuned.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/finetuned-models — cadastra modelo (admin)
// ---------------------------------------------------------------------------
finetunedModelsRoutes.post('/', requireAdmin, async (req, res) => {
  const {
    name, description, provider, modelArn, region,
    fallbackAgentId, systemPrompt,
    pricePerThousandInputTokens, pricePerThousandOutputTokens,
    isActive,
  } = req.body

  if (!name?.trim() || !provider || !modelArn?.trim()) {
    return res.status(400).json({ error: 'name, provider e modelArn são obrigatórios.' })
  }

  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider deve ser um de: ${VALID_PROVIDERS.join(', ')}` })
  }

  try {
    const model = await createFineTunedModel({
      name: name.trim(),
      description: description?.trim(),
      provider,
      modelArn: modelArn.trim(),
      region: region?.trim() || process.env.AWS_REGION || 'us-east-1',
      fallbackAgentId: fallbackAgentId?.trim() || undefined,
      systemPrompt: systemPrompt?.trim() || undefined,
      pricePerThousandInputTokens: pricePerThousandInputTokens != null ? Number(pricePerThousandInputTokens) : undefined,
      pricePerThousandOutputTokens: pricePerThousandOutputTokens != null ? Number(pricePerThousandOutputTokens) : undefined,
      isActive: isActive !== false,
    })
    return res.status(201).json(model)
  } catch (err: any) {
    console.error('[finetuned-models] create error:', err.message)
    return res.status(500).json({ error: 'Erro ao cadastrar modelo.' })
  }
})

// ---------------------------------------------------------------------------
// PUT /api/finetuned-models/:id — atualiza modelo (admin)
// ---------------------------------------------------------------------------
finetunedModelsRoutes.put('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params
  const {
    name, description, provider, modelArn, region,
    fallbackAgentId, systemPrompt,
    pricePerThousandInputTokens, pricePerThousandOutputTokens,
    isActive,
  } = req.body

  if (provider && !VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider deve ser um de: ${VALID_PROVIDERS.join(', ')}` })
  }

  try {
    const existing = await getFineTunedModel(id)
    if (!existing) return res.status(404).json({ error: 'Modelo não encontrado.' })

    const updated = await updateFineTunedModel(id, {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description.trim() }),
      ...(provider !== undefined && { provider }),
      ...(modelArn !== undefined && { modelArn: modelArn.trim() }),
      ...(region !== undefined && { region: region.trim() }),
      ...(fallbackAgentId !== undefined && { fallbackAgentId: fallbackAgentId?.trim() || undefined }),
      ...(systemPrompt !== undefined && { systemPrompt: systemPrompt?.trim() || undefined }),
      ...(pricePerThousandInputTokens !== undefined && { pricePerThousandInputTokens: Number(pricePerThousandInputTokens) }),
      ...(pricePerThousandOutputTokens !== undefined && { pricePerThousandOutputTokens: Number(pricePerThousandOutputTokens) }),
      ...(isActive !== undefined && { isActive }),
    })
    return res.json(updated)
  } catch (err: any) {
    console.error('[finetuned-models] update error:', err.message)
    return res.status(500).json({ error: 'Erro ao atualizar modelo.' })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/finetuned-models/:id — remove modelo (admin)
// ---------------------------------------------------------------------------
finetunedModelsRoutes.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params

  try {
    const existing = await getFineTunedModel(id)
    if (!existing) return res.status(404).json({ error: 'Modelo não encontrado.' })

    await deleteFineTunedModel(id)
    return res.json({ success: true })
  } catch (err: any) {
    console.error('[finetuned-models] delete error:', err.message)
    return res.status(500).json({ error: 'Erro ao remover modelo.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/finetuned-models/:id/invoke — invoca o modelo (com fallback automático)
// ---------------------------------------------------------------------------
finetunedModelsRoutes.post('/:id/invoke', async (req: any, res) => {
  const { id } = req.params
  const { message, sessionId } = req.body

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Mensagem é obrigatória.' })
  }

  try {
    const model = await getFineTunedModel(id)
    if (!model) return res.status(404).json({ error: 'Modelo não encontrado.' })
    if (!model.isActive) return res.status(400).json({ error: 'Este modelo está desativado.' })

    const result = await invokeFineTunedModel(model, message.trim(), sessionId)
    const estimatedCostUsd = estimateCost(model, result.inputTokens, result.outputTokens)

    return res.json({ ...result, estimatedCostUsd })
  } catch (err: any) {
    console.error('[finetuned-models] invoke error:', err.message)
    return res.status(500).json({ error: err.message || 'Erro ao invocar modelo fine-tuned.' })
  }
})
