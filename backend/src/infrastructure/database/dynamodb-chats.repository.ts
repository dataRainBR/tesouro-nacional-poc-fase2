/**
 * DynamoDB Service - Armazenamento de Chats e Mensagens
 * 
 * Usa DynamoDB para persistir histórico de conversas
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
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import type { Chat, Message } from '@tesouro-nacional/shared'
import { randomUUID } from 'crypto'

// Nomes das tabelas
const CHATS_TABLE = process.env.DYNAMODB_CHATS_TABLE || 'tesouro-nacional-chats'
const MESSAGES_TABLE = process.env.DYNAMODB_MESSAGES_TABLE || 'tesouro-nacional-messages'

// Cliente DynamoDB
let dynamoClient: DynamoDBDocumentClient | null = null

function getDynamoClient(): DynamoDBDocumentClient {
  if (dynamoClient) {
    return dynamoClient
  }

  const region = process.env.AWS_REGION || 'us-east-1'
  
  const credentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined

  const client = new DynamoDBClient({
    region,
    credentials,
  })

  dynamoClient = DynamoDBDocumentClient.from(client)
  return dynamoClient
}

/**
 * Cria as tabelas DynamoDB (se não existirem)
 */
export async function createTablesIfNotExist(): Promise<void> {
  const client = getDynamoClient()
  const dynamoClient = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  })

  // Criar tabela de chats
  try {
    await dynamoClient.send(
      new DescribeTableCommand({ TableName: CHATS_TABLE })
    )
    console.info(`[dynamodb-chats] Tabela ${CHATS_TABLE} já existe`)
  } catch (error: any) {
    if (error.name === 'ResourceNotFoundException') {
      console.info(`[dynamodb-chats] Criando tabela ${CHATS_TABLE}...`)
      
      await dynamoClient.send(
        new CreateTableCommand({
          TableName: CHATS_TABLE,
          KeySchema: [
            { AttributeName: 'userId', KeyType: 'HASH' },
            { AttributeName: 'chatId', KeyType: 'RANGE' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'userId', AttributeType: 'S' },
            { AttributeName: 'chatId', AttributeType: 'S' },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        })
      )
      console.info(`[dynamodb-chats] Tabela ${CHATS_TABLE} criada com sucesso`)
    }
  }

  // Criar tabela de mensagens
  try {
    const describeResponse = await dynamoClient.send(
      new DescribeTableCommand({ TableName: MESSAGES_TABLE })
    )
    console.info(`[dynamodb-chats] Tabela ${MESSAGES_TABLE} já existe`)
    
    // Verificar se a estrutura da tabela está correta
    const keySchema = describeResponse.Table?.KeySchema || []
    const hasCorrectKeys = keySchema.some(k => k.AttributeName === 'chatId' && k.KeyType === 'HASH') &&
                          keySchema.some(k => k.AttributeName === 'timestamp' && k.KeyType === 'RANGE')
    
    if (!hasCorrectKeys) {
      console.error(`[dynamodb-chats] ⚠️  Tabela ${MESSAGES_TABLE} existe mas com estrutura incorreta!`)
      console.error(`[dynamodb-chats] Estrutura atual:`, keySchema.map(k => `${k.AttributeName} (${k.KeyType})`))
      console.error(`[dynamodb-chats] Por favor, delete a tabela manualmente e reinicie o servidor para recriá-la.`)
    }
  } catch (error: any) {
    if (error.name === 'ResourceNotFoundException') {
      console.info(`[dynamodb-chats] Criando tabela ${MESSAGES_TABLE}...`)
      
      const createCommand = new CreateTableCommand({
        TableName: MESSAGES_TABLE,
        KeySchema: [
          { AttributeName: 'chatId', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'chatId', AttributeType: 'S' },
          { AttributeName: 'timestamp', AttributeType: 'S' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      })
      
      await dynamoClient.send(createCommand)
      console.info(`[dynamodb-chats] Tabela ${MESSAGES_TABLE} criada com sucesso (chatId HASH, timestamp RANGE)`)
    } else {
      throw error
    }
  }
}

/**
 * Lista todos os chats de um usuário
 */
export async function getChats(userId: string, includeArchived = false): Promise<Chat[]> {
  const client = getDynamoClient()

  const command = new QueryCommand({
    TableName: CHATS_TABLE,
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
    ScanIndexForward: false,
  })

  const response = await client.send(command)
  
  let chats = (response.Items || []).map((item: any) => ({
    id: item.chatId,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    archived: item.archived || false,
  })) as (Chat & { archived?: boolean })[]

  if (!includeArchived) {
    chats = chats.filter(c => !c.archived)
  }

  return chats.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

/**
 * Cria um novo chat
 */
export async function createChat(userId: string): Promise<Chat> {
  const client = getDynamoClient()

  const chatId = `chat_${Date.now()}_${randomUUID().substring(0, 8)}`
  const now = new Date().toISOString()

  const chat: Chat = {
    id: chatId,
    title: 'Nova conversa',
    createdAt: now,
    updatedAt: now,
  }

  const command = new PutCommand({
    TableName: CHATS_TABLE,
    Item: {
      userId: userId,
      chatId: chatId,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    },
  })

  await client.send(command)
  console.info(`[dynamodb-chats] Chat criado: ${chatId} userId: ${userId}`)

  return chat
}

/**
 * Deleta um chat e todas suas mensagens
 */
export async function deleteChat(userId: string, chatId: string): Promise<void> {
  const client = getDynamoClient()

  // Deletar chat
  const deleteChatCommand = new DeleteCommand({
    TableName: CHATS_TABLE,
    Key: {
      userId: userId,
      chatId: chatId,
    },
  })

  await client.send(deleteChatCommand)

  // Deletar todas as mensagens do chat
  const messages = await getMessages(chatId)
  
  if (messages.length > 0) {
    // DynamoDB não suporta delete em lote nativamente, então deletamos uma por uma
    // Para muitos itens, considere usar BatchWriteItem
    for (const message of messages) {
      const deleteMessageCommand = new DeleteCommand({
        TableName: MESSAGES_TABLE,
        Key: {
          chatId: chatId,
          timestamp: message.timestamp,
        },
      })
      await client.send(deleteMessageCommand)
    }
  }

  console.info(`[dynamodb-chats] Chat deletado: ${chatId}`)
}

/**
 * Atualiza o título de um chat
 */
export async function updateChatTitle(userId: string, chatId: string, title: string): Promise<void> {
  const client = getDynamoClient()

  const command = new UpdateCommand({
    TableName: CHATS_TABLE,
    Key: {
      userId: userId,
      chatId: chatId,
    },
    UpdateExpression: 'SET #title = :title, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#title': 'title',
    },
    ExpressionAttributeValues: {
      ':title': title,
      ':updatedAt': new Date().toISOString(),
    },
  })

  await client.send(command)
}

/**
 * Lista mensagens de um chat (com paginação opcional)
 */
export async function getMessages(chatId: string, limit?: number, before?: string): Promise<Message[]> {
  const client = getDynamoClient()

  const params: any = {
    TableName: MESSAGES_TABLE,
    KeyConditionExpression: before
      ? 'chatId = :chatId AND #ts < :before'
      : 'chatId = :chatId',
    ExpressionAttributeValues: {
      ':chatId': chatId,
      ...(before && { ':before': before }),
    },
    ScanIndexForward: true,
  }

  if (before) {
    params.ExpressionAttributeNames = { '#ts': 'timestamp' }
  }

  if (limit) {
    // Para pegar as últimas N, precisamos inverter e depois reverter
    params.ScanIndexForward = false
    params.Limit = limit
  }

  const command = new QueryCommand(params)
  const response = await client.send(command)
  
  let items = (response.Items || []).map((item: any) => ({
    id: item.messageId,
    chatId: item.chatId,
    role: item.role,
    content: item.content,
    timestamp: item.timestamp,
    feedback: item.feedback || null,
    trace: item.trace || undefined,
  })) as Message[]

  // Se usamos limit com ScanIndexForward=false, reverter para ordem cronológica
  if (limit) {
    items = items.reverse()
  }

  return items
}

/**
 * Adiciona uma mensagem a um chat
 */
export async function addMessage(
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
  userId: string,
  metrics?: { inputTokens?: number; outputTokens?: number; latencyMs?: number; agentId?: string; userName?: string; siswebStatus?: 'pending' | 'sent' | 'failed'; trace?: any[] }
): Promise<string> {
  const client = getDynamoClient()

  const messageId = `msg_${Date.now()}_${randomUUID().substring(0, 8)}`
  const timestamp = new Date().toISOString()

  const item: Record<string, any> = {
    chatId: chatId,
    timestamp: timestamp,
    messageId: messageId,
    role: role,
    content: content,
    userId: userId,
  }

  if (metrics?.userName) item.userName = metrics.userName

  if (metrics && role === 'assistant') {
    if (metrics.inputTokens !== undefined) item.inputTokens = metrics.inputTokens
    if (metrics.outputTokens !== undefined) item.outputTokens = metrics.outputTokens
    if (metrics.latencyMs !== undefined) item.latencyMs = metrics.latencyMs
    if (metrics.agentId) item.agentId = metrics.agentId
    if (metrics.siswebStatus) item.siswebStatus = metrics.siswebStatus
    if (metrics.trace && metrics.trace.length > 0) {
      // Remover undefined values para evitar erro do DynamoDB SDK
      item.trace = JSON.parse(JSON.stringify(metrics.trace))
    }
  }

  const command = new PutCommand({
    TableName: MESSAGES_TABLE,
    Item: item,
  })

  await client.send(command)

  // Atualizar timestamp do chat
  const updateChatCommand = new UpdateCommand({
    TableName: CHATS_TABLE,
    Key: {
      userId: userId,
      chatId: chatId,
    },
    UpdateExpression: 'SET updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':updatedAt': timestamp,
    },
  })

  await client.send(updateChatCommand)

  // Título será gerado pelo title-summarizer no chat.controller.ts
  // (não truncar)

  console.info(`[dynamodb-chats] Mensagem adicionada: ${messageId} chat: ${chatId} role: ${role}`)
  return messageId
}

/**
 * Atualiza o feedback de uma mensagem
 */
export async function updateMessageFeedback(
  chatId: string,
  timestamp: string,
  feedback: 'like' | 'dislike',
  comment?: string
): Promise<void> {
  const client = getDynamoClient()

  const hasComment = feedback === 'dislike' && comment && comment.trim()

  const command = new UpdateCommand({
    TableName: MESSAGES_TABLE,
    Key: {
      chatId: chatId,
      timestamp: timestamp,
    },
    UpdateExpression: hasComment
      ? 'SET #feedback = :feedback, feedbackComment = :comment'
      : 'SET #feedback = :feedback REMOVE feedbackComment',
    ExpressionAttributeNames: {
      '#feedback': 'feedback',
    },
    ExpressionAttributeValues: hasComment
      ? { ':feedback': feedback, ':comment': comment!.trim() }
      : { ':feedback': feedback },
  })

  await client.send(command)
  console.info(`[dynamodb-chats] Feedback atualizado: chatId=${chatId} timestamp=${timestamp} feedback=${feedback}`)
}

/**
 * Atualiza o status de envio ao SISWEB de uma mensagem (localiza pelo messageId).
 * Usado para registrar se o log obrigatório de compliance foi entregue.
 */
export async function updateSiswebStatus(
  chatId: string,
  messageId: string,
  status: 'sent' | 'failed',
  attempts?: number,
  error?: string
): Promise<void> {
  const client = getDynamoClient()

  // Localizar o timestamp (range key) da mensagem pelo messageId
  const query = await client.send(new QueryCommand({
    TableName: MESSAGES_TABLE,
    KeyConditionExpression: 'chatId = :chatId',
    ExpressionAttributeValues: { ':chatId': chatId },
  }))

  const item = (query.Items || []).find((m: any) => m.messageId === messageId)
  if (!item) {
    console.warn(`[dynamodb-chats] SISWEB status: mensagem ${messageId} não encontrada no chat ${chatId}`)
    return
  }

  const exprNames: Record<string, string> = { '#s': 'siswebStatus' }
  const exprValues: Record<string, any> = {
    ':s': status,
    ':at': new Date().toISOString(),
  }
  let setExpr = 'SET #s = :s, siswebSentAt = :at'

  if (attempts !== undefined) {
    setExpr += ', siswebAttempts = :att'
    exprValues[':att'] = attempts
  }
  if (error) {
    setExpr += ', siswebError = :err'
    exprValues[':err'] = error.slice(0, 500)
  } else {
    setExpr += ' REMOVE siswebError'
  }

  await client.send(new UpdateCommand({
    TableName: MESSAGES_TABLE,
    Key: { chatId, timestamp: item.timestamp },
    UpdateExpression: setExpr,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
  }))

  console.info(`[dynamodb-chats] SISWEB status atualizado: ${messageId} → ${status}`)
}


/**
 * Arquiva ou desarquiva um chat
 */
export async function archiveChat(userId: string, chatId: string, archived: boolean): Promise<void> {
  const client = getDynamoClient()

  const command = new UpdateCommand({
    TableName: CHATS_TABLE,
    Key: { userId, chatId },
    UpdateExpression: 'SET archived = :archived, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':archived': archived,
      ':updatedAt': new Date().toISOString(),
    },
  })

  await client.send(command)
  console.info(`[dynamodb-chats] Chat ${archived ? 'arquivado' : 'desarquivado'}: ${chatId}`)
}

/**
 * Duplica um chat com todas as suas mensagens
 */
export async function duplicateChat(userId: string, sourceChatId: string): Promise<Chat> {
  // Buscar mensagens do chat original
  const messages = await getMessages(sourceChatId)

  // Buscar info do chat original
  const client = getDynamoClient()
  const getCmd = new GetCommand({
    TableName: CHATS_TABLE,
    Key: { userId, chatId: sourceChatId },
  })
  const original = await client.send(getCmd)

  // Criar novo chat
  const newChat = await createChat(userId)

  // Atualizar título
  const originalTitle = original.Item?.title || 'Nova conversa'
  await updateChatTitle(userId, newChat.id, `${originalTitle} (cópia)`)

  // Copiar mensagens
  for (const msg of messages) {
    await addMessage(newChat.id, msg.role as 'user' | 'assistant', msg.content, userId)
  }

  console.info(`[dynamodb-chats] Chat duplicado: ${sourceChatId} → ${newChat.id} (${messages.length} msgs)`)

  return {
    ...newChat,
    title: `${originalTitle} (cópia)`,
  }
}

/**
 * Pesquisa chats por título ou conteúdo de mensagens
 */
export async function searchChats(userId: string, query: string): Promise<Chat[]> {
  const queryLower = query.toLowerCase()

  // Buscar todos os chats do usuário
  const allChats = await getChats(userId, false)

  // Filtrar por título
  const matchedByTitle = allChats.filter(c =>
    c.title.toLowerCase().includes(queryLower)
  )

  // Para chats que não bateram no título, buscar nas mensagens
  const titleIds = new Set(matchedByTitle.map(c => c.id))
  const remaining = allChats.filter(c => !titleIds.has(c.id))

  const matchedByContent: Chat[] = []
  for (const chat of remaining) {
    try {
      const messages = await getMessages(chat.id, 50) // Limitar busca
      const hasMatch = messages.some(m =>
        m.content.toLowerCase().includes(queryLower)
      )
      if (hasMatch) matchedByContent.push(chat)
    } catch {
      // Ignorar erros de busca individual
    }
  }

  return [...matchedByTitle, ...matchedByContent]
}


/**
 * Deleta todas as mensagens de um chat com timestamp >= afterTimestamp
 * Usado quando o usuário edita uma mensagem (remove a original e tudo depois)
 */
export async function deleteMessagesAfter(chatId: string, afterTimestamp: string): Promise<number> {
  const client = getDynamoClient()

  // Buscar mensagens com timestamp >= afterTimestamp
  const command = new QueryCommand({
    TableName: MESSAGES_TABLE,
    KeyConditionExpression: 'chatId = :chatId AND #ts >= :after',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: {
      ':chatId': chatId,
      ':after': afterTimestamp,
    },
  })

  const response = await client.send(command)
  const items = response.Items || []

  // Deletar cada mensagem
  for (const item of items) {
    await client.send(new DeleteCommand({
      TableName: MESSAGES_TABLE,
      Key: { chatId, timestamp: item.timestamp },
    }))
  }

  console.info(`[dynamodb-chats] Deletadas ${items.length} mensagens após ${afterTimestamp} no chat ${chatId}`)
  return items.length
}
