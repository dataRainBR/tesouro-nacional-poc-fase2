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
  /** ID do agente Bedrock (config interna) que gerou esta resposta, quando aplicável */
  agentId?: string
  /** ID do modelo fine-tuned que gerou esta resposta, quando aplicável */
  finetunedModelId?: string
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

// ─── Modo Parecerista ───────────────────────────────────────────────────────

export type ParecerStatus = 'pendente' | 'aprovado' | 'reprovado'

export interface Parecer {
  id: string
  chatId: string
  messageId: string
  /** ID do parecerista que avaliou */
  reviewerId: string
  reviewerName: string
  status: ParecerStatus
  /** Motivo obrigatório em caso de reprovação */
  motivo?: string
  /** Anotações livres do parecerista */
  anotacoes?: string
  /** Tags de classificação */
  tags?: string[]
  /** Pergunta original do usuário */
  pergunta: string
  /** Resposta do agente avaliada */
  resposta: string
  /** Trace da resposta (para contexto) */
  trace?: TraceStep[]
  createdAt: string
  updatedAt: string
}

export interface ParecerCreateInput {
  chatId: string
  messageId: string
  status: ParecerStatus
  motivo?: string
  anotacoes?: string
  tags?: string[]
  pergunta: string
  resposta: string
  trace?: TraceStep[]
}

export interface ParecerUpdateInput {
  status?: ParecerStatus
  motivo?: string
  anotacoes?: string
  tags?: string[]
}

export interface ParecerFilterOptions {
  status?: ParecerStatus
  reviewerId?: string
  startDate?: string
  endDate?: string
}

// ─── Modo Comparativo ───────────────────────────────────────────────────────

export interface ComparativoVote {
  id: string
  pergunta: string
  respostas: ComparativoResposta[]
  voto?: string // ID do agente vencedor ou 'empate'
  voterId: string
  voterName: string
  createdAt: string
}

export interface ComparativoResposta {
  agentId: string
  agentName: string
  response: string
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  trace?: TraceStep[]
}

// ─── Modelos Fine-Tuned ─────────────────────────────────────────────────────

export type FineTunedModelProvider = 'bedrock-custom-model' | 'bedrock-provisioned' | 'sagemaker-endpoint'

export interface FineTunedModel {
  id: string
  name: string
  description?: string
  provider: FineTunedModelProvider
  modelArn: string
  region?: string
  fallbackAgentId?: string
  systemPrompt?: string
  pricePerThousandInputTokens?: number
  pricePerThousandOutputTokens?: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface FineTunedInvokeResponse {
  response: string
  inputTokens?: number
  outputTokens?: number
  latencyMs: number
  usedFallback: boolean
  fallbackReason?: string
  estimatedCostUsd?: number
}
