/**
 * Pareceres Repository — armazena avaliações do Modo Parecerista no DynamoDB
 *
 * Tabela: fase2-pareceres
 * PK: reviewerId (HASH) — permite listar pareceres por parecerista
 * SK: createdAt (RANGE) — ordenação cronológica
 * GSI: status-index (status HASH, createdAt RANGE) — filtragem por status
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
  QueryCommand,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'
import type {
  Parecer,
  ParecerCreateInput,
  ParecerUpdateInput,
  ParecerFilterOptions,
  ParecerStatus,
} from '@tesouro-nacional/shared'

const TABLE = process.env.DYNAMODB_TABLE_PARECERES || 'fase2-pareceres'

let dynamoClient: DynamoDBDocumentClient | null = null

function getDynamoClient(): DynamoDBDocumentClient {
  if (dynamoClient) return dynamoClient

  const region = process.env.AWS_REGION || 'us-east-1'
  const credentials =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined

  dynamoClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region, credentials })
  )
  return dynamoClient
}

// ---------------------------------------------------------------------------
// Criação da tabela
// ---------------------------------------------------------------------------
export async function createPareceresTableIfNotExists(): Promise<void> {
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
    console.info(`[pareceres-db] Tabela ${TABLE} já existe`)
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      await rawClient.send(
        new CreateTableCommand({
          TableName: TABLE,
          KeySchema: [
            { AttributeName: 'id', KeyType: 'HASH' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'id', AttributeType: 'S' },
            { AttributeName: 'status', AttributeType: 'S' },
            { AttributeName: 'createdAt', AttributeType: 'S' },
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'status-index',
              KeySchema: [
                { AttributeName: 'status', KeyType: 'HASH' },
                { AttributeName: 'createdAt', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        })
      )
      console.info(`[pareceres-db] Tabela ${TABLE} criada com GSI status-index`)
    } else {
      console.error('[pareceres-db] Erro ao verificar tabela:', err.message)
    }
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createParecer(
  input: ParecerCreateInput,
  reviewerId: string,
  reviewerName: string
): Promise<Parecer> {
  const client = getDynamoClient()
  const now = new Date().toISOString()

  const parecer: Parecer = {
    id: randomUUID(),
    chatId: input.chatId,
    messageId: input.messageId,
    reviewerId,
    reviewerName,
    status: input.status,
    motivo: input.motivo,
    anotacoes: input.anotacoes,
    tags: input.tags,
    pergunta: input.pergunta,
    resposta: input.resposta,
    trace: input.trace,
    createdAt: now,
    updatedAt: now,
  }

  await client.send(
    new PutCommand({ TableName: TABLE, Item: parecer })
  )

  console.info(`[pareceres-db] Parecer criado: ${parecer.id} status=${parecer.status}`)
  return parecer
}

export async function updateParecer(
  id: string,
  updates: ParecerUpdateInput
): Promise<Parecer | null> {
  const client = getDynamoClient()

  // Buscar existente
  const existing = await getParecer(id)
  if (!existing) return null

  const updated: Parecer = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  await client.send(
    new PutCommand({ TableName: TABLE, Item: updated })
  )

  console.info(`[pareceres-db] Parecer atualizado: ${id}`)
  return updated
}

export async function getParecer(id: string): Promise<Parecer | null> {
  const client = getDynamoClient()

  const result = await client.send(
    new GetCommand({ TableName: TABLE, Key: { id } })
  )

  return (result.Item as Parecer) ?? null
}

export async function listPareceres(
  filters?: ParecerFilterOptions
): Promise<Parecer[]> {
  const client = getDynamoClient()

  // Se filtro por status, usar GSI
  if (filters?.status) {
    const params: any = {
      TableName: TABLE,
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :status',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':status': filters.status } as Record<string, any>,
      ScanIndexForward: false,
    }

    if (filters.startDate && filters.endDate) {
      params.KeyConditionExpression += ' AND createdAt BETWEEN :start AND :end'
      params.ExpressionAttributeValues[':start'] = filters.startDate
      params.ExpressionAttributeValues[':end'] = filters.endDate
    }

    const result = await client.send(new QueryCommand(params))
    let items = (result.Items || []) as Parecer[]

    if (filters.reviewerId) {
      items = items.filter((p) => p.reviewerId === filters.reviewerId)
    }

    return items
  }

  // Sem filtro de status — scan completo (aceitável para volume baixo)
  const result = await client.send(
    new ScanCommand({ TableName: TABLE })
  )

  let items = (result.Items || []) as Parecer[]

  if (filters?.reviewerId) {
    items = items.filter((p) => p.reviewerId === filters.reviewerId)
  }
  if (filters?.startDate) {
    items = items.filter((p) => p.createdAt >= filters.startDate!)
  }
  if (filters?.endDate) {
    items = items.filter((p) => p.createdAt <= filters.endDate!)
  }

  return items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

export async function getParecerStats(): Promise<{
  total: number
  aprovados: number
  reprovados: number
  pendentes: number
}> {
  const all = await listPareceres()
  return {
    total: all.length,
    aprovados: all.filter((p) => p.status === 'aprovado').length,
    reprovados: all.filter((p) => p.status === 'reprovado').length,
    pendentes: all.filter((p) => p.status === 'pendente').length,
  }
}
