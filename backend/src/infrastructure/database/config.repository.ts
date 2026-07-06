import type { AWSConfig } from '@tesouro-nacional/shared'
import {
  getConfigFromSecretsManager,
  saveConfigToSecretsManager,
  clearConfigCache,
} from '../aws/secrets-manager.service.js'

// Fallback: armazenamento em memória (apenas para desenvolvimento)
// Mapa para armazenar múltiplas configurações por orgName
const inMemoryConfigs = new Map<string, AWSConfig>()

/**
 * Busca configuração
 * Prioridade: Secrets Manager > Memória
 */
export async function getConfig(orgName?: string): Promise<AWSConfig | null> {
  // Se usar Secrets Manager está habilitado e temos orgName
  if (process.env.USE_SECRETS_MANAGER === 'true' && orgName) {
    try {
      const config = await getConfigFromSecretsManager(orgName)
      if (config) {
        console.log(`[config-db] Configuração encontrada no Secrets Manager para orgName: ${orgName}`)
        return config
      }
      console.log(`[config-db] Configuração não encontrada no Secrets Manager para orgName: ${orgName}`)
    } catch (error) {
      console.warn('[config-db] Erro ao buscar do Secrets Manager, usando fallback:', error)
    }
  }

  // Fallback: memória (desenvolvimento)
  if (orgName) {
    const config = inMemoryConfigs.get(orgName)
    if (config) {
      console.log(`[config-db] Configuração encontrada em memória para orgName: ${orgName}`)
      return config
    }
    console.log(`[config-db] Configuração não encontrada em memória para orgName: ${orgName}`)
    return null
  }

  // Se não tem orgName, retornar a primeira configuração em memória (compatibilidade)
  if (inMemoryConfigs.size > 0) {
    const firstConfig = Array.from(inMemoryConfigs.values())[0]
    console.log(`[config-db] Retornando primeira configuração em memória (sem orgName)`)
    return firstConfig
  }

  return null
}

/**
 * Salva configuração
 * Prioridade: Secrets Manager > Memória
 */
export async function saveConfig(newConfig: AWSConfig): Promise<AWSConfig> {
  const configWithTimestamp = {
    ...newConfig,
    updatedAt: new Date().toISOString(),
  }

  console.log(`[config-db] Salvando configuração para orgName: ${newConfig.orgName}`)

  // Se usar Secrets Manager está habilitado
  if (process.env.USE_SECRETS_MANAGER === 'true') {
    try {
      // Limpar cache antes de salvar para garantir que a próxima busca pegue a versão atualizada
      clearConfigCache(newConfig.orgName)

      const saved = await saveConfigToSecretsManager(configWithTimestamp)
      console.log(`[config-db] Configuração salva no Secrets Manager para orgName: ${newConfig.orgName}`)

      // Também salvar em memória como fallback
      inMemoryConfigs.set(newConfig.orgName, saved)

      return saved
    } catch (error) {
      console.error('[config-db] Erro ao salvar no Secrets Manager:', error)
      // Se falhar e estiver em desenvolvimento, salvar em memória
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[config-db] Falha ao salvar no Secrets Manager, usando fallback em memória')
        inMemoryConfigs.set(newConfig.orgName, configWithTimestamp)
        return configWithTimestamp
      }
      // Em produção, lançar erro
      throw error
    }
  }

  // Fallback: memória (desenvolvimento)
  inMemoryConfigs.set(newConfig.orgName, configWithTimestamp)
  console.log(`[config-db] Configuração salva em memória para orgName: ${newConfig.orgName}`)
  return configWithTimestamp
}

/**
 * Busca configuração por orgName (para uso com Secrets Manager)
 */
export async function getConfigByOrgName(orgName: string): Promise<AWSConfig | null> {
  console.log(`[config-db] Buscando configuração por orgName: ${orgName}`)

  // Se usar Secrets Manager está habilitado
  if (process.env.USE_SECRETS_MANAGER === 'true') {
    try {
      const config = await getConfigFromSecretsManager(orgName)
      if (config) {
        console.log(`[config-db] Configuração encontrada no Secrets Manager para orgName: ${orgName}`)
        // Atualizar cache em memória também
        inMemoryConfigs.set(orgName, config)
        return config
      }
      console.log(`[config-db] Configuração não encontrada no Secrets Manager para orgName: ${orgName}`)
    } catch (error) {
      console.warn('[config-db] Erro ao buscar do Secrets Manager:', error)
    }
  }

  // Fallback: memória (desenvolvimento)
  const config = inMemoryConfigs.get(orgName)
  if (config) {
    console.log(`[config-db] Configuração encontrada em memória para orgName: ${orgName}`)
    return config
  }

  console.log(`[config-db] Configuração não encontrada em memória para orgName: ${orgName}`)
  return null
}
