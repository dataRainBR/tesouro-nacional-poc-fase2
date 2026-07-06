export interface Chat {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  chatId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  feedback?: 'like' | 'dislike' | null
  trace?: TraceStep[]
}

export interface User {
  id: string
  name: string
  email: string
  avatar?: string
}

export interface AuthUser {
  id: string
  email: string
  name: string
  role?: 'admin' | 'user'
  token?: string
  refreshToken?: string
  expiresIn?: number
}

export interface AWSConfig {
  awsAccountId: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
  awsRegion: string
  bedrockKnowledgeBaseId: string
  bedrockAgentId: string
  bedrockAgentAliasId: string
  s3BucketName: string
  orgName: string
  orgLogo?: string
  updatedAt?: string
}

// Configuração da organização (apenas dados públicos)
export interface OrganizationConfig {
  userId: string // ID do usuário (email ou sub do Cognito)
  firstName: string
  lastName: string
  orgName: string
  orgLogo?: string
  updatedAt?: string
}

export interface TraceStep {
  type: 'rationale' | 'knowledgeBase_lookup' | 'knowledgeBase_result' | 'actionGroup_invoke' | 'actionGroup_result' | 'sub_agent_invoke' | 'sub_agent_result'
  timestamp: string
  content: Record<string, any>
}

export interface BedrockResponse {
  response: string
  sessionId?: string
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  trace?: TraceStep[]
}
