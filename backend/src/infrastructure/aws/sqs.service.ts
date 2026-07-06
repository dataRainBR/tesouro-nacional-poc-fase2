import {
  SQSClient,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs'

export interface EvalMessage {
  jobId: string
  questionIndex: number
  question: string
  agentId: string
  /** Alias override — se fornecido, usa este alias em vez do alias padrão do agente armazenado. */
  agentAliasId?: string
  referenceResponse?: string
  category?: string
}

function getSQSClient(): SQSClient {
  const region = process.env.AWS_REGION || 'us-east-1'
  const credentials =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined
  return new SQSClient({ region, credentials })
}

const QUEUE_URL = () => process.env.EVALUATIONS_QUEUE_URL?.trim() || ''

export function isSQSEnabled(): boolean {
  return !!QUEUE_URL()
}

/** Envia mensagens em batches de até 10 (limite do SQS). */
export async function sendEvalMessages(messages: EvalMessage[]): Promise<void> {
  const url = QUEUE_URL()
  if (!url) throw new Error('EVALUATIONS_QUEUE_URL não configurada.')

  const client = getSQSClient()
  for (let i = 0; i < messages.length; i += 10) {
    const chunk = messages.slice(i, i + 10)
    await client.send(
      new SendMessageBatchCommand({
        QueueUrl: url,
        Entries: chunk.map((msg, idx) => ({
          Id: `q${idx}`,
          MessageBody: JSON.stringify(msg),
        })),
      })
    )
  }
}

/** Long-poll: retorna até `max` mensagens com seus receipt handles. */
export async function receiveEvalMessages(
  max = 10
): Promise<{ message: EvalMessage; receiptHandle: string }[]> {
  const url = QUEUE_URL()
  if (!url) return []

  const client = getSQSClient()
  const res = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: url,
      MaxNumberOfMessages: max,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 180, // 3 min por mensagem (Bedrock pode ser lento)
    })
  )
  return (res.Messages ?? []).map((m) => ({
    message: JSON.parse(m.Body!) as EvalMessage,
    receiptHandle: m.ReceiptHandle!,
  }))
}

export async function deleteEvalMessage(receiptHandle: string): Promise<void> {
  const url = QUEUE_URL()
  if (!url) return
  await getSQSClient().send(
    new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: receiptHandle })
  )
}
