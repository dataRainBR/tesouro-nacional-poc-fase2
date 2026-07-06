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
  UpdateCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'

const JOBS_TABLE = process.env.DYNAMODB_TABLE_EVAL_JOBS || 'fase2-eval-jobs'
const RESULTS_TABLE = process.env.DYNAMODB_TABLE_EVAL_RESULTS || 'fase2-eval-results'
const FEEDBACK_TABLE = process.env.DYNAMODB_TABLE_EVAL_FEEDBACK || 'fase2-eval-feedback'

export type JobStatus = 'pending' | 'running' | 'completed' | 'aborted'
export type QuestionStatus = 'pending' | 'running' | 'done' | 'error'
export type FeedbackVote = 'up' | 'down'

export interface EvalJob {
  jobId: string
  agentId: string
  agentName: string
  /** Alias usado neste job (pode ser diferente do alias padrão do agente armazenado). */
  agentAliasId?: string
  agentAliasName?: string
  /** Identificador do modelo usado no JSONL (customizável pelo usuário). */
  modelIdentifier?: string
  totalQuestions: number
  completedQuestions: number
  errorCount: number
  status: JobStatus
  createdAt: string
  updatedAt: string
  createdBy: string
}

export interface EvalResult {
  jobId: string
  questionIndex: number
  question: string
  referenceResponse?: string | null
  category?: string | null
  answer: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  status: QuestionStatus
  error: string | null
}

export interface EvalFeedback {
  jobId: string
  questionIndex: number
  vote: FeedbackVote
  comment?: string
  userId: string
  createdAt: string
  updatedAt: string
}

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

function getRawClient(): DynamoDBClient {
  const region = process.env.AWS_REGION || 'us-east-1'
  const credentials =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined
  return new DynamoDBClient({ region, credentials })
}

async function ensureTable(
  client: DynamoDBClient,
  tableName: string,
  schema: any
): Promise<void> {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }))
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      await client.send(new CreateTableCommand(schema))
      console.info(`[eval-repo] Tabela ${tableName} criada`)
    }
  }
}

export async function createEvalTablesIfNotExist(): Promise<void> {
  const client = getRawClient()
  await ensureTable(client, JOBS_TABLE, {
    TableName: JOBS_TABLE,
    KeySchema: [{ AttributeName: 'jobId', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'jobId', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  })
  await ensureTable(client, RESULTS_TABLE, {
    TableName: RESULTS_TABLE,
    KeySchema: [
      { AttributeName: 'jobId', KeyType: 'HASH' },
      { AttributeName: 'questionIndex', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'jobId', AttributeType: 'S' },
      { AttributeName: 'questionIndex', AttributeType: 'N' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  })
  await ensureTable(client, FEEDBACK_TABLE, {
    TableName: FEEDBACK_TABLE,
    KeySchema: [
      { AttributeName: 'jobId', KeyType: 'HASH' },
      { AttributeName: 'questionIndex', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'jobId', AttributeType: 'S' },
      { AttributeName: 'questionIndex', AttributeType: 'N' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  })
}

export async function createJob(
  params: Omit<EvalJob, 'jobId' | 'completedQuestions' | 'errorCount' | 'createdAt' | 'updatedAt'>
): Promise<EvalJob> {
  const client = getDynamoClient()
  const now = new Date().toISOString()
  const job: EvalJob = {
    ...params,
    jobId: randomUUID(),
    completedQuestions: 0,
    errorCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  await client.send(new PutCommand({ TableName: JOBS_TABLE, Item: job }))
  return job
}

export async function getJob(jobId: string): Promise<EvalJob | null> {
  const client = getDynamoClient()
  const res = await client.send(
    new GetCommand({ TableName: JOBS_TABLE, Key: { jobId } })
  )
  return (res.Item as EvalJob) ?? null
}

export async function listJobs(): Promise<EvalJob[]> {
  const client = getDynamoClient()
  const res = await client.send(new ScanCommand({ TableName: JOBS_TABLE }))
  const items = (res.Items ?? []) as EvalJob[]
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function updateJobProgress(
  jobId: string,
  completedQuestions: number,
  errorCount: number,
  status: JobStatus
): Promise<void> {
  const client = getDynamoClient()
  await client.send(
    new UpdateCommand({
      TableName: JOBS_TABLE,
      Key: { jobId },
      UpdateExpression:
        'SET completedQuestions = :c, errorCount = :e, #s = :s, updatedAt = :u',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':c': completedQuestions,
        ':e': errorCount,
        ':s': status,
        ':u': new Date().toISOString(),
      },
    })
  )
}

export async function createResults(results: EvalResult[]): Promise<void> {
  const client = getDynamoClient()
  await Promise.all(
    results.map((r) => client.send(new PutCommand({ TableName: RESULTS_TABLE, Item: r })))
  )
}

export async function updateResult(result: EvalResult): Promise<void> {
  const client = getDynamoClient()
  await client.send(new PutCommand({ TableName: RESULTS_TABLE, Item: result }))
}

export async function deleteJob(jobId: string): Promise<void> {
  const client = getDynamoClient()

  // Deleta o job
  await client.send(new DeleteCommand({ TableName: JOBS_TABLE, Key: { jobId } }))

  // Deleta todos os resultados em lotes de 25 (limite do BatchWriteItem)
  const results = await getResults(jobId)
  if (results.length === 0) return

  const chunks: EvalResult[][] = []
  for (let i = 0; i < results.length; i += 25) {
    chunks.push(results.slice(i, i + 25))
  }
  await Promise.all(
    chunks.map((chunk) =>
      client.send(
        new BatchWriteCommand({
          RequestItems: {
            [RESULTS_TABLE]: chunk.map((r) => ({
              DeleteRequest: { Key: { jobId: r.jobId, questionIndex: r.questionIndex } },
            })),
          },
        })
      )
    )
  )
}

export async function getResults(jobId: string): Promise<EvalResult[]> {
  const client = getDynamoClient()
  const res = await client.send(
    new QueryCommand({
      TableName: RESULTS_TABLE,
      KeyConditionExpression: 'jobId = :jobId',
      ExpressionAttributeValues: { ':jobId': jobId },
    })
  )
  const items = (res.Items ?? []) as EvalResult[]
  return items.sort((a, b) => a.questionIndex - b.questionIndex)
}

export async function upsertFeedback(feedback: EvalFeedback): Promise<void> {
  const client = getDynamoClient()
  await client.send(new PutCommand({ TableName: FEEDBACK_TABLE, Item: feedback }))
}

export async function getFeedback(jobId: string, questionIndex: number): Promise<EvalFeedback | null> {
  const client = getDynamoClient()
  const res = await client.send(
    new GetCommand({ TableName: FEEDBACK_TABLE, Key: { jobId, questionIndex } })
  )
  return (res.Item as EvalFeedback) ?? null
}

export async function getAllFeedbacks(jobId: string): Promise<EvalFeedback[]> {
  const client = getDynamoClient()
  const res = await client.send(
    new QueryCommand({
      TableName: FEEDBACK_TABLE,
      KeyConditionExpression: 'jobId = :jobId',
      ExpressionAttributeValues: { ':jobId': jobId },
    })
  )
  return (res.Items ?? []) as EvalFeedback[]
}
