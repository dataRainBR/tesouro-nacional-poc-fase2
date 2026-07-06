/**
 * Bedrock Agent Discovery — lista agentes e aliases disponíveis na conta AWS.
 * Usado no painel de admin para selecionar agentes sem digitar IDs manualmente.
 */

import {
  BedrockAgentClient,
  ListAgentsCommand,
  ListAgentAliasesCommand,
} from '@aws-sdk/client-bedrock-agent'

export interface DiscoveredAgent {
  agentId: string
  agentName: string
  agentStatus: string
  description?: string
  updatedAt?: string
}

export interface DiscoveredAlias {
  agentAliasId: string
  agentAliasName: string
  agentAliasStatus: string
  description?: string
  routingConfiguration?: any[]
}

function getClient(region?: string) {
  return new BedrockAgentClient({
    region: region || process.env.AWS_REGION || 'us-east-1',
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  })
}

/**
 * Lista todos os agentes Bedrock disponíveis na conta/região.
 */
export async function listBedrockAgents(region?: string): Promise<DiscoveredAgent[]> {
  const client = getClient(region)

  const response = await client.send(new ListAgentsCommand({ maxResults: 50 }))

  return (response.agentSummaries || []).map((a) => ({
    agentId: a.agentId || '',
    agentName: a.agentName || '',
    agentStatus: a.agentStatus || 'UNKNOWN',
    description: a.description,
    updatedAt: a.updatedAt?.toISOString(),
  }))
}

/**
 * Lista aliases de um agente específico.
 */
export async function listAgentAliases(agentId: string, region?: string): Promise<DiscoveredAlias[]> {
  const client = getClient(region)

  const response = await client.send(
    new ListAgentAliasesCommand({ agentId, maxResults: 20 })
  )

  return (response.agentAliasSummaries || []).map((a) => ({
    agentAliasId: a.agentAliasId || '',
    agentAliasName: a.agentAliasName || '',
    agentAliasStatus: a.agentAliasStatus || 'UNKNOWN',
    description: a.description,
    routingConfiguration: a.routingConfiguration,
  }))
}
