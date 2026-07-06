/**
 * Comparativos Repository — armazena resultados de comparações A/B entre agentes
 *
 * Tabela: fase2-comparacoes
 * PK: id (HASH)
 * GSI: voter-index (voterId HASH, createdAt RANGE) — listar por usuário
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
  ScanCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'

export interface ComparativoResposta {
  agentId: string
  agentName: string
  response: string
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  trace?: any[]
}

export interface Comparativo {
  id: string
  pergunta: string
  respostas: ComparativoResposta[]
  voto?: string // agentId vencedor ou 'empate'
  voterId: string
  voterName: string
  createdAt: string
  updatedAt: string
}

const TABLE = process.env.DYNAMODB_TABLE_COMPARATIVOS || 'fase2-comparacoes'

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
    new DynamoDBClient({ region, credentials }),
    { marshallOptions: { removeUndefinedValues: true } }
  )
  return dynamoClient
}

// ---------------------------------------------------------------------------
// Criação da tabela
// ---------------------------------------------------------------------------
export async function createComparativosTableIfNotExists(): Promise<void> {
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
    console.info(`[comparativos-db] Tabela ${TABLE} já existe`)
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      await rawClient.send(
        new CreateTableCommand({
          TableName: TABLE,
          KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
          AttributeDefinitions: [
            { AttributeName: 'id', AttributeType: 'S' },
            { AttributeName: 'voterId', AttributeType: 'S' },
            { AttributeName: 'createdAt', AttributeType: 'S' },
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'voter-index',
              KeySchema: [
                { AttributeName: 'voterId', KeyType: 'HASH' },
                { AttributeName: 'createdAt', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        })
      )
      console.info(`[comparativos-db] Tabela ${TABLE} criada com GSI voter-index`)
    } else {
      console.error('[comparativos-db] Erro ao verificar tabela:', err.message)
    }
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createComparativo(
  pergunta: string,
  respostas: ComparativoResposta[],
  voterId: string,
  voterName: string
): Promise<Comparativo> {
  const client = getDynamoClient()
  const now = new Date().toISOString()

  const item: Comparativo = {
    id: randomUUID(),
    pergunta,
    respostas,
    voterId,
    voterName,
    createdAt: now,
    updatedAt: now,
  }

  await client.send(new PutCommand({ TableName: TABLE, Item: item }))
  console.info(`[comparativos-db] Comparativo criado: ${item.id}`)
  return item
}

export async function voteComparativo(
  id: string,
  voto: string
): Promise<Comparativo | null> {
  const client = getDynamoClient()

  const existing = await getComparativo(id)
  if (!existing) return null

  const updated: Comparativo = {
    ...existing,
    voto,
    updatedAt: new Date().toISOString(),
  }

  await client.send(new PutCommand({ TableName: TABLE, Item: updated }))
  console.info(`[comparativos-db] Voto registrado: ${id} → ${voto}`)
  return updated
}

export async function getComparativo(id: string): Promise<Comparativo | null> {
  const client = getDynamoClient()
  const result = await client.send(
    new GetCommand({ TableName: TABLE, Key: { id } })
  )
  return (result.Item as Comparativo) ?? null
}

export async function listComparativos(voterId?: string): Promise<Comparativo[]> {
  const client = getDynamoClient()

  if (voterId) {
    const result = await client.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'voter-index',
        KeyConditionExpression: 'voterId = :vid',
        ExpressionAttributeValues: { ':vid': voterId },
        ScanIndexForward: false,
      })
    )
    return (result.Items || []) as Comparativo[]
  }

  const result = await client.send(new ScanCommand({ TableName: TABLE }))
  return ((result.Items || []) as Comparativo[]).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

export async function getComparativoStats(): Promise<{
  total: number
  votados: number
  winRateByAgent: Record<string, { wins: number; total: number; rate: number }>
}> {
  const all = await listComparativos()
  const votados = all.filter((c) => c.voto)
  const winRateByAgent: Record<string, { wins: number; total: number; rate: number }> = {}

  for (const comp of all) {
    for (const resp of comp.respostas) {
      if (!winRateByAgent[resp.agentName]) {
        winRateByAgent[resp.agentName] = { wins: 0, total: 0, rate: 0 }
      }
      winRateByAgent[resp.agentName].total++
    }
    if (comp.voto && comp.voto !== 'empate') {
      const winner = comp.respostas.find((r) => r.agentId === comp.voto)
      if (winner && winRateByAgent[winner.agentName]) {
        winRateByAgent[winner.agentName].wins++
      }
    }
  }

  // Calcular taxas
  for (const key of Object.keys(winRateByAgent)) {
    const entry = winRateByAgent[key]
    entry.rate = entry.total > 0 ? Math.round((entry.wins / entry.total) * 100) : 0
  }

  return { total: all.length, votados: votados.length, winRateByAgent }
}
