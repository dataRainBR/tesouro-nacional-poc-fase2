import { Router } from 'express'
import { getConfig, saveConfig, getConfigByOrgName } from '../../infrastructure/database/config.repository.js'
import type { AWSConfig } from '@tesouro-nacional/shared'

export const configRoutes = Router()

// GET /api/config - Busca configurações
configRoutes.get('/', async (req, res) => {
  try {
    // Se tiver orgName na query, buscar por orgName (Secrets Manager)
    const orgName = req.query.orgName as string | undefined

    console.log('[config] Buscando configuração. orgName:', orgName || 'não fornecido')
    console.log('[config] USE_SECRETS_MANAGER:', process.env.USE_SECRETS_MANAGER)

    let config: AWSConfig | null = null

    if (orgName) {
      config = await getConfigByOrgName(orgName)
    } else {
      config = await getConfig()
    }

    if (config) {
      console.log('[config] Configuração encontrada. orgName:', config.orgName, 'Agent ID:', config.bedrockAgentId, 'Agent Alias ID:', config.bedrockAgentAliasId)
    } else {
      console.log('[config] Configuração não encontrada')
    }

    // Retornar null se não encontrar (não é erro)
    return res.json(config || null)
  } catch (error) {
    console.error('[config] Erro ao buscar configurações:', error)
    return res.status(500).json({ error: 'Erro ao buscar configurações' })
  }
})

// POST /api/config - Salva configurações
configRoutes.post('/', async (req, res) => {
  try {
    const config = req.body as AWSConfig

    console.log('[config] Salvando configuração. orgName:', config.orgName)
    console.log('[config] USE_SECRETS_MANAGER:', process.env.USE_SECRETS_MANAGER)

    // Validar campos obrigatórios
    const requiredFields = [
      'awsAccountId',
      'awsAccessKeyId',
      'awsSecretAccessKey',
      'awsRegion',
      'bedrockKnowledgeBaseId',
      'bedrockAgentId',
      'bedrockAgentAliasId',
      's3BucketName',
      'orgName',
    ]

    for (const field of requiredFields) {
      if (!config[field as keyof AWSConfig]) {
        console.error('[config] Campo obrigatório faltando:', field)
        return res.status(400).json({
          error: `Campo obrigatório faltando: ${field}`
        })
      }
    }

    const savedConfig = await saveConfig(config)
    console.log('[config] Configuração salva com sucesso. orgName:', savedConfig.orgName)
    return res.json(savedConfig)
  } catch (error: any) {
    console.error('[config] Erro ao salvar configurações:', error)
    console.error('[config] Stack trace:', error.stack)
    return res.status(500).json({
      error: 'Erro ao salvar configurações',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})
