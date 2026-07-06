/**
 * Pareceres Controller — Modo Parecerista
 *
 * POST   /api/pareceres          → cria um parecer (avaliação de resposta)
 * GET    /api/pareceres          → lista pareceres (com filtros)
 * GET    /api/pareceres/stats    → estatísticas de pareceres
 * GET    /api/pareceres/:id      → retorna um parecer específico
 * PUT    /api/pareceres/:id      → atualiza um parecer
 */

import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import {
  createParecer,
  updateParecer,
  getParecer,
  listPareceres,
  getParecerStats,
} from '../../infrastructure/database/pareceres.repository.js'
import type { ParecerStatus } from '@tesouro-nacional/shared'

export const pareceresRoutes = Router()

// Todas as rotas requerem autenticação
pareceresRoutes.use(authenticateToken)

// ---------------------------------------------------------------------------
// POST /api/pareceres — cria um parecer
// ---------------------------------------------------------------------------
pareceresRoutes.post('/', async (req: any, res) => {
  const { chatId, messageId, status, motivo, anotacoes, tags, pergunta, resposta, trace } = req.body

  if (!chatId || !messageId || !status || !pergunta || !resposta) {
    return res.status(400).json({
      error: 'chatId, messageId, status, pergunta e resposta são obrigatórios.',
    })
  }

  const validStatuses: ParecerStatus[] = ['pendente', 'aprovado', 'reprovado']
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Status deve ser: pendente, aprovado ou reprovado.' })
  }

  if (status === 'reprovado' && !motivo?.trim()) {
    return res.status(400).json({ error: 'Motivo é obrigatório para reprovação.' })
  }

  try {
    const parecer = await createParecer(
      { chatId, messageId, status, motivo, anotacoes, tags, pergunta, resposta, trace },
      req.user.id,
      req.user.name || req.user.email
    )
    return res.status(201).json(parecer)
  } catch (err: any) {
    console.error('[pareceres] create error:', err.message)
    return res.status(500).json({ error: 'Erro ao criar parecer.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/pareceres/stats — estatísticas
// ---------------------------------------------------------------------------
pareceresRoutes.get('/stats', async (req: any, res) => {
  try {
    const stats = await getParecerStats()
    return res.json(stats)
  } catch (err: any) {
    console.error('[pareceres] stats error:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar estatísticas.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/pareceres — lista com filtros
// ---------------------------------------------------------------------------
pareceresRoutes.get('/', async (req: any, res) => {
  const { status, startDate, endDate } = req.query

  try {
    const pareceres = await listPareceres({
      status: status as ParecerStatus | undefined,
      reviewerId: req.user.role === 'admin' ? undefined : req.user.id,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    })
    return res.json(pareceres)
  } catch (err: any) {
    console.error('[pareceres] list error:', err.message)
    return res.status(500).json({ error: 'Erro ao listar pareceres.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/pareceres/:id — retorna um parecer
// ---------------------------------------------------------------------------
pareceresRoutes.get('/:id', async (req: any, res) => {
  try {
    const parecer = await getParecer(req.params.id)
    if (!parecer) return res.status(404).json({ error: 'Parecer não encontrado.' })
    return res.json(parecer)
  } catch (err: any) {
    console.error('[pareceres] get error:', err.message)
    return res.status(500).json({ error: 'Erro ao buscar parecer.' })
  }
})

// ---------------------------------------------------------------------------
// PUT /api/pareceres/:id — atualiza um parecer
// ---------------------------------------------------------------------------
pareceresRoutes.put('/:id', async (req: any, res) => {
  const { status, motivo, anotacoes, tags } = req.body

  if (status === 'reprovado' && !motivo?.trim()) {
    return res.status(400).json({ error: 'Motivo é obrigatório para reprovação.' })
  }

  try {
    const existing = await getParecer(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Parecer não encontrado.' })

    // Apenas o autor ou admin pode editar
    if (existing.reviewerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Sem permissão para editar este parecer.' })
    }

    const updated = await updateParecer(req.params.id, { status, motivo, anotacoes, tags })
    return res.json(updated)
  } catch (err: any) {
    console.error('[pareceres] update error:', err.message)
    return res.status(500).json({ error: 'Erro ao atualizar parecer.' })
  }
})
