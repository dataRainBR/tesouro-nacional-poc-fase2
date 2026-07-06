import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  UpdateSecretCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import type { AWSConfig } from '@tesouro-nacional/shared'

// Cache em memória para evitar múltiplas chamadas ao Secrets Manager
const configCache = new Map<string, { config: AWSConfig; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutos

/**
 * Gera o nome do secret baseado no nome da organização
 */
function getSecretName(orgName: string): string {
  // Normaliza o nome da organização para usar como parte do secret name
  const normalizedName = orgName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  
  return `tesouro-nacional/config/${normalizedName}`
}

/**
 * Cria cliente do Secrets Manager
 * Usa credenciais do ambiente ou IAM role
 */
function createSecretsManagerClient(region: string): SecretsManagerClient {
  // Se houver credenciais no ambiente, usa elas
  // Caso contrário, usa IAM role (para produção)
  const credentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined

  return new SecretsManagerClient({
    region,
    credentials,
  })
}

/**
 * Busca configuração do AWS Secrets Manager
 */
export async function getConfigFromSecretsManager(
  orgName: string,
  awsRegion?: string
): Promise<AWSConfig | null> {
  try {
    const secretName = getSecretName(orgName)
    
    // Verificar cache
    const cached = configCache.get(secretName)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.config
    }

    // Usar região fornecida ou padrão do ambiente
    const region = awsRegion || process.env.AWS_REGION || 'us-east-1'
    const client = createSecretsManagerClient(region)

    const command = new GetSecretValueCommand({
      SecretId: secretName,
    })

    const response = await client.send(command)

    if (!response.SecretString) {
      return null
    }

    const config = JSON.parse(response.SecretString) as AWSConfig

    // Atualizar cache
    configCache.set(secretName, {
      config,
      timestamp: Date.now(),
    })

    return config
  } catch (error: any) {
    // Se o secret não existe, retorna null (não é erro)
    if (error.name === 'ResourceNotFoundException') {
      return null
    }

    console.error('Erro ao buscar secret do Secrets Manager:', error)
    throw error
  }
}

/**
 * Salva configuração no AWS Secrets Manager
 */
export async function saveConfigToSecretsManager(
  config: AWSConfig
): Promise<AWSConfig> {
  try {
    const secretName = getSecretName(config.orgName)
    const region = config.awsRegion

    const client = createSecretsManagerClient(region)

    const secretValue = JSON.stringify({
      ...config,
      updatedAt: new Date().toISOString(),
    })

    // Tentar atualizar secret existente
    try {
      const updateCommand = new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: secretValue,
      })

      await client.send(updateCommand)
    } catch (error: any) {
      // Se o secret não existe, criar novo
      if (error.name === 'ResourceNotFoundException') {
        const createCommand = new CreateSecretCommand({
          Name: secretName,
          SecretString: secretValue,
          Description: `Configurações AWS para ${config.orgName}`,
        })

        await client.send(createCommand)
      } else {
        throw error
      }
    }

    const savedConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
    }

    // Atualizar cache
    configCache.set(secretName, {
      config: savedConfig,
      timestamp: Date.now(),
    })

    return savedConfig
  } catch (error: any) {
    console.error('Erro ao salvar secret no Secrets Manager:', error)
    throw new Error(
      `Erro ao salvar configurações: ${error.message || 'Erro desconhecido'}`
    )
  }
}

/**
 * Limpa o cache (útil para testes ou quando necessário forçar refresh)
 */
export function clearConfigCache(orgName?: string): void {
  if (orgName) {
    const secretName = getSecretName(orgName)
    configCache.delete(secretName)
  } else {
    configCache.clear()
  }
}
