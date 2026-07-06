/**
 * Rotas para Configuração da Organização
 *
 * Armazena apenas dados públicos (nome, sobrenome, logo, nome da org)
 * Dados sensíveis ficam no .env
 */

import { Router } from 'express'
import {
  saveOrganizationConfig,
  getOrganizationConfig,
  updateOrganizationConfig,
} from '../../infrastructure/database/dynamodb.client.js'
import { authenticateToken } from '../middleware/auth.js'
import type { OrganizationConfig } from '@tesouro-nacional/shared'

export const organizationRoutes = Router()

// Todas as rotas requerem autenticação
organizationRoutes.use(authenticateToken)

// GET /api/organization - Busca configuração do usuário atual
organizationRoutes.get('/', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const config = await getOrganizationConfig(req.user.id)

    return res.json(config || null)
  } catch (error: any) {
    console.error('[organization] Erro ao buscar configuração:', error)
    return res.status(500).json({ error: 'Erro ao buscar configuração' })
  }
})

// POST /api/organization - Salva configuração do usuário (cria nova ou substitui existente)
organizationRoutes.post('/', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const { firstName, lastName, orgName, orgLogo } = req.body

    // Buscar configuração existente para fazer merge
    const existingConfig = await getOrganizationConfig(req.user.id)

    // Fazer merge: usar valores novos se fornecidos, senão manter existentes
    const config: OrganizationConfig = {
      userId: req.user.id,
      firstName: firstName?.trim() || existingConfig?.firstName || '',
      lastName: lastName?.trim() || existingConfig?.lastName || '',
      orgName: orgName?.trim() || existingConfig?.orgName || 'Tesouro Nacional',
      orgLogo: orgLogo?.trim() || existingConfig?.orgLogo || undefined,
    }

    const savedConfig = await saveOrganizationConfig(config)

    return res.json(savedConfig)
  } catch (error: any) {
    console.error('[organization] Erro ao salvar configuração:', error)
    return res.status(500).json({
      error: 'Erro ao salvar configuração',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  }
})

// PUT /api/organization - Atualiza configuração do usuário (update parcial)
organizationRoutes.put('/', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const { firstName, lastName, orgName, orgLogo } = req.body

    // Buscar configuração existente
    const existingConfig = await getOrganizationConfig(req.user.id)

    // Se não existe, criar nova
    if (!existingConfig) {
      const newConfig: OrganizationConfig = {
        userId: req.user.id,
        firstName: firstName?.trim() || '',
        lastName: lastName?.trim() || '',
        orgName: orgName?.trim() || 'Tesouro Nacional',
        orgLogo: orgLogo?.trim() || undefined,
      }
      const savedConfig = await saveOrganizationConfig(newConfig)
      return res.json(savedConfig)
    }

    // Se existe, fazer update parcial (só atualizar campos fornecidos)
    const updates: Partial<OrganizationConfig> = {}
    if (firstName !== undefined && firstName.trim()) updates.firstName = firstName.trim()
    if (lastName !== undefined && lastName.trim()) updates.lastName = lastName.trim()
    if (orgName !== undefined && orgName.trim()) updates.orgName = orgName.trim()
    if (orgLogo !== undefined) updates.orgLogo = orgLogo.trim() || undefined

    // Se não há nada para atualizar, retornar configuração atual
    if (Object.keys(updates).length === 0) {
      return res.json(existingConfig)
    }

    const updatedConfig = await updateOrganizationConfig(req.user.id, updates)

    if (!updatedConfig) {
      return res.status(404).json({ error: 'Configuração não encontrada' })
    }

    return res.json(updatedConfig)
  } catch (error: any) {
    console.error('[organization] Erro ao atualizar configuração:', error)
    return res.status(500).json({
      error: 'Erro ao atualizar configuração',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  }
})
