/**
 * Agents Repository — armazena configurações de agentes Bedrock no DynamoDB
 * com fallback em memória para desenvolvimento sem DynamoDB local.
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'

export interface AgentConfig {
  id: string
  name: string
  description?: string
  agentId: string
  agentAliasId: string
region?: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

const TABLE = process.env.DYNAMODB_TABLE_AGENTS || 'tesouro-agents'

// Fallback em memória (desenvolvimento sem DynamoDB)
const inMemory = new Map<string, AgentConfig>()

function getDynamoClient(): DynamoDBDocumentClient {
  const region = process.env.AWS_REGION || 'us-east-1'
  const credentials =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region, credentials }))
}

// Indica se o DynamoDB está acessível (detectado na primeira operação)
let dynamoAvailable: boolean | null = null

async function isDynamoAvailable(): Promise<boolean> {
  if (dynamoAvailable !== null) return dynamoAvailable
  try {
    await getDynamoClient().send(new ScanCommand({ TableName: TABLE, Limit: 1 }))
    dynamoAvailable = true
  } catch (err: any) {
    // ResourceNotFoundException = tabela não existe mas DynamoDB está acessível
    if (err.name === 'ResourceNotFoundException') {
      dynamoAvailable = true
    } else {
      dynamoAvailable = false
      console.warn('[agents-db] DynamoDB indisponível, usando memória:', err.message)
    }
  }
  return dynamoAvailable
}

// ---------------------------------------------------------------------------
// Criação da tabela (chamada na inicialização)
// ---------------------------------------------------------------------------
export async function createAgentsTableIfNotExists(): Promise<void> {
  const rawClient = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  })

  try {
    await rawClient.send(new DescribeTableCommand({ TableName: TABLE }))
    console.info(`[agents-db] Tabela ${TABLE} já existe`)
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      await rawClient.send(
        new CreateTableCommand({
          TableName: TABLE,
          KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
          BillingMode: 'PAY_PER_REQUEST',
        })
      )
      console.info(`[agents-db] Tabela ${TABLE} criada`)
    }
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export async function listAgents(): Promise<AgentConfig[]> {
  if (!(await isDynamoAvailable())) {
    return Array.from(inMemory.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  }

  try {
    const result = await getDynamoClient().send(new ScanCommand({ TableName: TABLE }))
    const items = (result.Items || []) as AgentConfig[]
    return items.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') return []
    throw err
  }
}

export async function getAgent(id: string): Promise<AgentConfig | null> {
  if (!(await isDynamoAvailable())) {
    return inMemory.get(id) ?? null
  }

  try {
    const result = await getDynamoClient().send(
      new GetCommand({ TableName: TABLE, Key: { id } })
    )
    return (result.Item as AgentConfig) ?? null
  } catch {
    return null
  }
}

export async function getDefaultAgent(): Promise<AgentConfig | null> {
  const agents = await listAgents()
  return agents.find((a) => a.isDefault) ?? agents[0] ?? null
}

export async function createAgent(
  data: Omit<AgentConfig, 'id' | 'createdAt' | 'updatedAt'>
): Promise<AgentConfig> {
  const agent: AgentConfig = {
    ...data,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  // Se é o primeiro agente ou foi marcado como default, garantir que só um é default
  if (agent.isDefault) {
    await clearDefaultFlag()
  }

  if (!(await isDynamoAvailable())) {
    inMemory.set(agent.id, agent)
    return agent
  }

  await getDynamoClient().send(new PutCommand({ TableName: TABLE, Item: agent }))
  return agent
}

export async function updateAgent(
  id: string,
  data: Partial<Omit<AgentConfig, 'id' | 'createdAt'>>
): Promise<AgentConfig> {
  const existing = await getAgent(id)
  if (!existing) throw new Error(`Agente ${id} não encontrado`)

  if (data.isDefault) {
    await clearDefaultFlag()
  }

  const updated: AgentConfig = {
    ...existing,
    ...data,
    id,
    updatedAt: new Date().toISOString(),
  }

  if (!(await isDynamoAvailable())) {
    inMemory.set(id, updated)
    return updated
  }

  await getDynamoClient().send(new PutCommand({ TableName: TABLE, Item: updated }))
  return updated
}

export async function deleteAgent(id: string): Promise<void> {
  if (!(await isDynamoAvailable())) {
    inMemory.delete(id)
    return
  }

  await getDynamoClient().send(
    new DeleteCommand({ TableName: TABLE, Key: { id } })
  )
}

async function clearDefaultFlag(): Promise<void> {
  const agents = await listAgents()
  await Promise.all(
    agents
      .filter((a) => a.isDefault)
      .map((a) => updateAgent(a.id, { isDefault: false }))
  )
}
