/**
 * Fine-Tuned Models Repository — armazena configurações de modelos customizados
 * (Bedrock Custom Models ou endpoints SageMaker) no DynamoDB, com fallback em
 * memória para desenvolvimento sem DynamoDB local.
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
} from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'

export type FineTunedModelProvider = 'bedrock-custom-model' | 'bedrock-provisioned' | 'sagemaker-endpoint'

export interface FineTunedModelConfig {
  id: string
  name: string
  description?: string
  provider: FineTunedModelProvider
  /** ARN do Custom Model, Provisioned Throughput ou endpoint SageMaker */
  modelArn: string
  region?: string
  /** Agente base para fallback quando este modelo falhar ou não responder */
  fallbackAgentId?: string
  /** System prompt customizado, já que modelos fine-tuned não têm orquestração de Agent */
  systemPrompt?: string
  /** Preço por 1000 tokens de input/output, em USD — usado no dashboard de custos */
  pricePerThousandInputTokens?: number
  pricePerThousandOutputTokens?: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

const TABLE = process.env.DYNAMODB_TABLE_FINETUNED_MODELS || 'fase2-finetuned-models'

const inMemory = new Map<string, FineTunedModelConfig>()

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

let dynamoAvailable: boolean | null = null

async function isDynamoAvailable(): Promise<boolean> {
  if (dynamoAvailable !== null) return dynamoAvailable
  try {
    await getDynamoClient().send(new ScanCommand({ TableName: TABLE, Limit: 1 }))
    dynamoAvailable = true
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      dynamoAvailable = true
    } else {
      dynamoAvailable = false
      console.warn('[finetuned-models-db] DynamoDB indisponível, usando memória:', err.message)
    }
  }
  return dynamoAvailable
}

// ---------------------------------------------------------------------------
// Criação da tabela
// ---------------------------------------------------------------------------
export async function createFineTunedModelsTableIfNotExists(): Promise<void> {
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
    console.info(`[finetuned-models-db] Tabela ${TABLE} já existe`)
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
      console.info(`[finetuned-models-db] Tabela ${TABLE} criada`)
    }
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export async function listFineTunedModels(): Promise<FineTunedModelConfig[]> {
  if (!(await isDynamoAvailable())) {
    return Array.from(inMemory.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  }

  try {
    const result = await getDynamoClient().send(new ScanCommand({ TableName: TABLE }))
    const items = (result.Items || []) as FineTunedModelConfig[]
    return items.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') return []
    throw err
  }
}

export async function getFineTunedModel(id: string): Promise<FineTunedModelConfig | null> {
  if (!(await isDynamoAvailable())) {
    return inMemory.get(id) ?? null
  }

  try {
    const result = await getDynamoClient().send(
      new GetCommand({ TableName: TABLE, Key: { id } })
    )
    return (result.Item as FineTunedModelConfig) ?? null
  } catch {
    return null
  }
}

export async function createFineTunedModel(
  data: Omit<FineTunedModelConfig, 'id' | 'createdAt' | 'updatedAt'>
): Promise<FineTunedModelConfig> {
  const model: FineTunedModelConfig = {
    ...data,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  if (!(await isDynamoAvailable())) {
    inMemory.set(model.id, model)
    return model
  }

  await getDynamoClient().send(new PutCommand({ TableName: TABLE, Item: model }))
  return model
}

export async function updateFineTunedModel(
  id: string,
  data: Partial<Omit<FineTunedModelConfig, 'id' | 'createdAt'>>
): Promise<FineTunedModelConfig> {
  const existing = await getFineTunedModel(id)
  if (!existing) throw new Error(`Modelo ${id} não encontrado`)

  const updated: FineTunedModelConfig = {
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

export async function deleteFineTunedModel(id: string): Promise<void> {
  if (!(await isDynamoAvailable())) {
    inMemory.delete(id)
    return
  }

  await getDynamoClient().send(
    new DeleteCommand({ TableName: TABLE, Key: { id } })
  )
}
