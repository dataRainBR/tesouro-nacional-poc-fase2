import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import {
  generateResponseWithBedrock,
  type BedrockInvokeOptions,
} from '../../infrastructure/aws/bedrock.service.js'
import {
  createChat,
  addMessage,
  getMessages,
  updateChatTitle,
  updateSiswebStatus,
} from '../../infrastructure/database/dynamodb-chats.repository.js'
import { getAgent, getDefaultAgent } from '../../infrastructure/database/agents.repository.js'
import { generateSmartTitle } from '../../infrastructure/aws/title-summarizer.service.js'
import { sendInteractionLog } from '../../infrastructure/sisweb/sisweb-logger.service.js'
import { checkAbuse } from '../../infrastructure/abuse-detection.js'

// Sessão Bedrock expira após 15 min de inatividade
const BEDROCK_SESSION_TTL_MS = 15 * 60 * 1000 // 900000ms

// Verifica se a sessão Bedrock provavelmente expirou com base no último timestamp do chat
async function isSessionExpired(chatId: string): Promise<boolean> {
  try {
    const messages = await getMessages(chatId)
    if (messages.length === 0) return false
    const last = messages[messages.length - 1]
    const lastAt = new Date(last.timestamp).getTime()
    return Date.now() - lastAt > BEDROCK_SESSION_TTL_MS
  } catch {
    return false
  }
}

// Monta resumo compacto das últimas N mensagens para injetar no agente após expiração
async function buildSessionSummary(chatId: string, maxMessages = 6): Promise<string> {
  try {
    const messages = await getMessages(chatId)
    const recent = messages.slice(-maxMessages)
    if (recent.length === 0) return ''
    const lines = recent.map((m) =>
      `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content.slice(0, 300)}`
    )
    return `Resumo da conversa anterior:\n${lines.join('\n')}`
  } catch {
    return ''
  }
}

function getFriendlyErrorMessage(error: any): string {
  const msg: string = error.message || ''
  if (msg.includes('Nenhum agente Bedrock configurado')) return msg
  if (msg.includes('Credenciais AWS inválidas')) return 'Credenciais AWS inválidas. Entre em contato com o administrador.'
  if (msg.includes('não encontrado') || msg.includes('ResourceNotFoundException')) {
    return 'O agente de IA não foi encontrado. Verifique se o Agent ID e Agent Alias ID estão corretos.'
  }
  if (msg.includes('PREPARED') || msg.includes('UnknownError')) {
    return 'O agente de IA não está pronto. Verifique no console AWS Bedrock se o Agent Alias está no estado PREPARED.'
  }
  if (msg.includes('Lambda')) return 'Serviço de consulta temporariamente indisponível. Tente novamente em instantes.'
  if (msg.includes('throttling') || msg.includes('Throttling')) return 'Muitas requisições no momento. Aguarde alguns segundos e tente novamente.'
  if (msg.includes('not authorized') || msg.includes('AccessDenied')) return 'Sem permissão para acessar este recurso.'
  if (msg.includes('timed out') || msg.includes('TimeoutError')) return 'A consulta demorou demais. Tente uma pergunta mais específica.'
  return 'Ocorreu um erro ao processar sua mensagem. Tente novamente.'
}

export const chatRoutes = Router()
chatRoutes.use(authenticateToken)

// Headers de resposta registrados no SISWEB (compliance)
const SISWEB_RESP_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
}

/**
 * Dispara o registro da interação no SISWEB (obrigatório por compliance).
 * Fire-and-forget: não bloqueia a resposta ao usuário. Quando o envio resolve,
 * grava o status (sent/failed) no item da mensagem para acompanhamento no admin.
 */
function logToSisweb(params: {
  req: any
  chatId: string
  messageId: string
  question: string
  answer: string
  sessionId: string
  userId: string
  tsReq: Date
  tsResp: Date
  statusHttp: string
  agentId?: string
  modelName?: string
  inputTokens?: number
  outputTokens?: number
}) {
  const {
    req, chatId, messageId, question, answer, sessionId, userId,
    tsReq, tsResp, statusHttp, agentId, modelName, inputTokens, outputTokens,
  } = params

  const promptTokens = inputTokens ?? 0
  const completionTokens = outputTokens ?? 0

  // Não usar await: o envio (com retry interno) roda em background
  sendInteractionLog({
    dataHoraReq: tsReq.toISOString(),
    dataHoraResp: tsResp.toISOString(),
    txBodyReq: JSON.stringify({ question, session_id: sessionId, user_id: userId }),
    txBodyResp: JSON.stringify({ answer }),
    idInteracao: sessionId,
    dadosUsuario: userId,
    txHeaderReq: JSON.stringify(req.headers || {}),
    txHeaderResp: JSON.stringify(SISWEB_RESP_HEADERS),
    nuStatusHttp: statusHttp,
    txUrl: req.originalUrl || req.path || '',
    nomeModelo: modelName || process.env.SUPERVISOR_MODEL_NAME || '',
    nomeObjeto: agentId ? `agent:${agentId}` : '',
    nuMaxTokens: process.env.MODEL_MAX_TOKENS || '',
    nuPromptTokens: String(promptTokens),
    nuCompletionTokens: String(completionTokens),
    nuTotalTokens: String(promptTokens + completionTokens),
  })
    .then((result) => {
      // Grava o status e o detalhe no item da mensagem para diagnóstico no admin
      updateSiswebStatus(
        chatId,
        messageId,
        result.ok ? 'sent' : 'failed',
        result.attempts,
        result.ok ? undefined : result.detail
      ).catch((e) => console.error('[chat] Erro ao gravar status SISWEB:', e?.message))
    })
    .catch((err) => {
      console.error('[chat] Erro inesperado ao registrar no SISWEB:', err?.message)
      updateSiswebStatus(chatId, messageId, 'failed', undefined, `Erro inesperado: ${err?.message}`)
        .catch(() => {})
    })
}

chatRoutes.post('/', async (req: any, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Usuário não autenticado' })
  }

  const { chatId, message, agentId: requestedAgentId } = req.body

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Mensagem é obrigatória' })
  }

  if (message.length > 3000) {
    return res.status(400).json({ error: 'Mensagem muito longa. Máximo: 3.000 caracteres.' })
  }

  // Verificação de abuso: limite diário + detecção de padrão de extração
  const abuseCheck = checkAbuse(req.user.id, message)
  if (!abuseCheck.allowed) {
    return res.status(429).json({ error: abuseCheck.reason })
  }

  // Resolver agente
  let agentConfig = null
  if (requestedAgentId) agentConfig = await getAgent(requestedAgentId)
  if (!agentConfig) agentConfig = await getDefaultAgent()

  // Criar chat se necessário
  let currentChatId = chatId
  if (!currentChatId) {
    const newChat = await createChat(req.user.id)
    currentChatId = newChat.id
  }

  await addMessage(currentChatId, 'user', message, req.user.id, { userName: req.user.name || req.user.email })

  // Item 3: detectar expiração de sessão Bedrock e montar resumo
  let sessionSummary: string | undefined
  if (currentChatId !== chatId) {
    // chat novo — sem histórico anterior
  } else {
    const expired = await isSessionExpired(currentChatId)
    if (expired) {
      sessionSummary = await buildSessionSummary(currentChatId)
      if (sessionSummary) console.info(`[chat] Sessão Bedrock expirada — injetando resumo (${sessionSummary.length} chars)`)
    }
  }

  const invokeOptions: BedrockInvokeOptions = agentConfig
    ? { agentId: agentConfig.agentId, agentAliasId: agentConfig.agentAliasId, region: agentConfig.region }
    : {}

  if (sessionSummary) invokeOptions.sessionSummary = sessionSummary

  const tsReq = new Date()
  let bedrockResult
  try {
    bedrockResult = await generateResponseWithBedrock(message, currentChatId, invokeOptions)
  } catch (error: any) {
    const tsResp = new Date()
    const friendly = getFriendlyErrorMessage(error)

    try {
      const messageId = await addMessage(currentChatId, 'assistant', friendly, req.user.id, {
        agentId: agentConfig?.id,
        userName: req.user.name || req.user.email,
        siswebStatus: 'pending',
      })

      // SISWEB: registrar interação mesmo em caso de erro (compliance)
      logToSisweb({
        req,
        chatId: currentChatId,
        messageId,
        question: message,
        answer: friendly,
        sessionId: currentChatId,
        userId: req.user.id,
        tsReq,
        tsResp,
        statusHttp: '500',
        agentId: agentConfig?.agentId,
      })

      return res.json({ chatId: currentChatId, messageId, response: friendly })
    } catch {
      return res.status(500).json({ error: friendly })
    }
  }

  const tsResp = new Date()

  try {
    const messageId = await addMessage(currentChatId, 'assistant', bedrockResult.response, req.user.id, {
      agentId: agentConfig?.id,
      userName: req.user.name || req.user.email,
      inputTokens: bedrockResult.inputTokens,
      outputTokens: bedrockResult.outputTokens,
      latencyMs: bedrockResult.latencyMs,
      siswebStatus: 'pending',
      trace: bedrockResult.trace,
    })

    // SISWEB: registrar interação bem-sucedida (compliance — obrigatório)
    logToSisweb({
      req,
      chatId: currentChatId,
      messageId,
      question: message,
      answer: bedrockResult.response,
      sessionId: currentChatId,
      userId: req.user.id,
      tsReq,
      tsResp,
      statusHttp: '200',
      agentId: agentConfig?.agentId,
      inputTokens: bedrockResult.inputTokens,
      outputTokens: bedrockResult.outputTokens,
    })

    // Gerar título inteligente se é a primeira mensagem do chat (fire-and-forget)
    if (!chatId) {
      // Chat novo — gerar título baseado na primeira pergunta
      generateSmartTitle(message)
        .then((title) => updateChatTitle(req.user.id, currentChatId, title))
        .catch((err) => console.error('[chat] Erro ao gerar título:', err.message))
    } else {
      // Chat existente — verificar se deve atualizar título (a cada 5 mensagens do usuário)
      getMessages(currentChatId)
        .then((msgs) => {
          const userMsgs = msgs.filter(m => m.role === 'user')
          if (userMsgs.length > 1 && userMsgs.length % 5 === 0) {
            const recentContext = userMsgs.slice(-3).map(m => m.content).join(' | ')
            generateSmartTitle(recentContext)
              .then((title) => updateChatTitle(req.user.id, currentChatId, title))
              .catch((err) => console.error('[chat] Erro ao atualizar título:', err.message))
          }
        })
        .catch(() => {})
    }

    return res.json({ chatId: currentChatId, messageId, response: bedrockResult.response })
  } catch (dbError: any) {
    console.error('[chat] Erro ao persistir resposta:', dbError.message)
    return res.status(500).json({ error: 'Erro ao salvar resposta' })
  }
})
