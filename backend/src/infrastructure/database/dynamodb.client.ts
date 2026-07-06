/**
 * DynamoDB Service - Armazenamento de Configurações da Organização
 * 
 * Armazena apenas dados públicos da organização (nome, sobrenome, logo, nome da org)
 * Dados sensíveis (credenciais AWS) ficam apenas no .env
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
} from '@aws-sdk/lib-dynamodb'
import type { OrganizationConfig } from '@tesouro-nacional/shared'

// Nome da tabela
const TABLE_NAME = process.env.DYNAMODB_TABLE_ORGANIZATION || 'tesouro-organization'

// Cliente DynamoDB
let dynamoClient: DynamoDBDocumentClient | null = null

function getDynamoClient(): DynamoDBDocumentClient {
  if (dynamoClient) {
    return dynamoClient
  }

  const region = process.env.AWS_REGION || 'us-east-1'
  
  // Usar credenciais do ambiente ou IAM role
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
 * Cria a tabela DynamoDB (se não existir)
 * Esta função pode ser chamada manualmente ou na inicialização
 */
export async function createTableIfNotExists(): Promise<void> {
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

  try {
    // Verificar se a tabela já existe
    await dynamoClient.send(
      new DescribeTableCommand({ TableName: TABLE_NAME })
    )
    console.info(`[dynamodb] Tabela ${TABLE_NAME} já existe`)
    return
  } catch (error: any) {
    // Se a tabela não existe, criar
    if (error.name === 'ResourceNotFoundException') {
      console.info(`[dynamodb] Criando tabela ${TABLE_NAME}...`)
      
      const command = new CreateTableCommand({
        TableName: TABLE_NAME,
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' }, // Partition key
        ],
        AttributeDefinitions: [
          { AttributeName: 'userId', AttributeType: 'S' },
        ],
        BillingMode: 'PAY_PER_REQUEST', // On-demand pricing
      })

      await dynamoClient.send(command)
      console.info(`[dynamodb] Tabela ${TABLE_NAME} criada com sucesso`)
    } else {
      throw error
    }
  }
}

/**
 * Salva ou atualiza configuração da organização
 */
export async function saveOrganizationConfig(config: OrganizationConfig): Promise<OrganizationConfig> {
  const client = getDynamoClient()
  
  const item = {
    userId: config.userId,
    firstName: config.firstName,
    lastName: config.lastName,
    orgName: config.orgName,
    orgLogo: config.orgLogo || undefined,
    updatedAt: new Date().toISOString(),
  }

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
  })

  await client.send(command)
  console.info(`[dynamodb] Configuração da organização salva para userId: ${config.userId}`)
  
  return item
}

/**
 * Busca configuração da organização por userId
 */
export async function getOrganizationConfig(userId: string): Promise<OrganizationConfig | null> {
  const client = getDynamoClient()

  const command = new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      userId: userId,
    },
  })

  const response = await client.send(command)
  
  if (response.Item) {
    return response.Item as OrganizationConfig
  }

  return null
}

/**
 * Atualiza apenas campos específicos da configuração
 */
export async function updateOrganizationConfig(
  userId: string,
  updates: Partial<Omit<OrganizationConfig, 'userId' | 'updatedAt'>>
): Promise<OrganizationConfig | null> {
  const client = getDynamoClient()

  // Construir expressão de atualização
  const updateExpressions: string[] = []
  const expressionAttributeNames: Record<string, string> = {}
  const expressionAttributeValues: Record<string, any> = {}

  if (updates.firstName !== undefined) {
    updateExpressions.push('#firstName = :firstName')
    expressionAttributeNames['#firstName'] = 'firstName'
    expressionAttributeValues[':firstName'] = updates.firstName
  }

  if (updates.lastName !== undefined) {
    updateExpressions.push('#lastName = :lastName')
    expressionAttributeNames['#lastName'] = 'lastName'
    expressionAttributeValues[':lastName'] = updates.lastName
  }

  if (updates.orgName !== undefined) {
    updateExpressions.push('#orgName = :orgName')
    expressionAttributeNames['#orgName'] = 'orgName'
    expressionAttributeValues[':orgName'] = updates.orgName
  }

  if (updates.orgLogo !== undefined) {
    updateExpressions.push('#orgLogo = :orgLogo')
    expressionAttributeNames['#orgLogo'] = 'orgLogo'
    expressionAttributeValues[':orgLogo'] = updates.orgLogo || null
  }

  if (updateExpressions.length === 0) {
    // Nada para atualizar, retornar configuração atual
    return getOrganizationConfig(userId)
  }

  // Adicionar updatedAt
  updateExpressions.push('#updatedAt = :updatedAt')
  expressionAttributeNames['#updatedAt'] = 'updatedAt'
  expressionAttributeValues[':updatedAt'] = new Date().toISOString()

  const command = new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      userId: userId,
    },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW',
  })

  const response = await client.send(command)
  
  if (response.Attributes) {
    console.info(`[dynamodb] Configuração da organização atualizada para userId: ${userId}`)
    return response.Attributes as OrganizationConfig
  }

  return null
}
