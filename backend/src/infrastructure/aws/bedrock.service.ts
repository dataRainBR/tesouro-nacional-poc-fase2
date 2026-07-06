import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime'
import type { BedrockResponse, TraceStep } from '@tesouro-nacional/shared'

export interface BedrockInvokeOptions {
  agentId?: string
  agentAliasId?: string
  region?: string
  sessionSummary?: string  // resumo da conversa anterior (quando sessão Bedrock expirou)
  userContext?: string      // contexto leve do usuário (data, papel, etc.)
}


export async function generateResponseWithBedrock(
  message: string,
  sessionId?: string,
  options?: BedrockInvokeOptions
): Promise<BedrockResponse> {
  const awsRegion = options?.region || process.env.AWS_REGION || 'us-east-1'
  const bedrockAgentId = options?.agentId || process.env.BEDROCK_AGENT_ID
  const bedrockAgentAliasId = options?.agentAliasId || process.env.BEDROCK_AGENT_ALIAS_ID

  if (!bedrockAgentId || !bedrockAgentAliasId) {
    throw new Error(
      'Nenhum agente Bedrock configurado. ' +
      'Acesse Configurações e adicione um agente com Agent ID e Agent Alias ID.'
    )
  }

  if (!message || message.trim().length === 0) {
    throw new Error('A mensagem não pode estar vazia')
  }

  const agentId = bedrockAgentId.trim()
  const agentAliasId = bedrockAgentAliasId.trim()
  const region = awsRegion.trim()

  // Normalizar caracteres Unicode rejeitados pelo Bedrock com 400
  message = message
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2026]/g, '...')

  const cleanSessionId = sessionId
    ? sessionId.replace(/[^0-9a-zA-Z._:-]/g, '-')
    : `default-session-${Date.now()}`

  console.info(`[bedrock] Invocando agente agentId=${agentId} aliasId=${agentAliasId} sessionId=${cleanSessionId} msgLen=${message.trim().length}`)

  // Monta promptSessionAttributes com contexto leve injetado no prompt do agente
  const promptSessionAttributes: Record<string, string> = {
    currentDate: new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
  }
  if (options?.userContext) {
    promptSessionAttributes.userContext = options.userContext
  }
  if (options?.sessionSummary) {
    promptSessionAttributes.previousContext = options.sessionSummary
  }

  try {
    const client = new BedrockAgentRuntimeClient({ region })

    const input: any = {
      agentId,
      agentAliasId,
      sessionId: cleanSessionId,
      inputText: message.trim(),
      enableTrace: true,
      sessionState: {
        sessionAttributes: {
          locale: 'pt-BR',
          source: 'tesouro-nacional-chat',
        },
        promptSessionAttributes,
      },
    }

    const command = new InvokeAgentCommand(input)

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 270_000)

    let response: any
    try {
      response = await client.send(command, { abortSignal: ac.signal })
    } catch (sendError: any) {
      clearTimeout(timer)
      console.error('[bedrock] Erro ao invocar agente:', {
        name: sendError.name,
        message: sendError.message,
        statusCode: sendError.$metadata?.httpStatusCode,
        requestId: sendError.$metadata?.requestId,
      })

      if (
        sendError.$metadata?.httpStatusCode === 400 &&
        (sendError.name === 'UnknownError' || sendError.message?.includes('UnknownError'))
      ) {
        throw new Error(
          `Erro UnknownError (400) ao invocar o Agent.\n` +
          `Agent ID: ${agentId} | Alias ID: ${agentAliasId} | Região: ${region}\n` +
          `Verifique se o Agent Alias está no estado PREPARED no console AWS Bedrock.\n` +
          `Request ID: ${sendError.$metadata?.requestId || 'N/A'}`
        )
      }
      throw sendError
    } finally {
      clearTimeout(timer)
    }

    const startTime = Date.now()
    let fullResponse = ''
    let newSessionId = cleanSessionId
    let hasError = false
    let errorMessage = ''
    let totalInputTokens = 0
    let totalOutputTokens = 0
    const traceSteps: TraceStep[] = []

    if (response.sessionId) {
      newSessionId = response.sessionId
    }

    if (response.completion) {
      try {
        for await (const event of response.completion) {
          // --- Chunks de texto ---
          if (event.chunk?.bytes) {
            try {
              fullResponse += new TextDecoder('utf-8').decode(event.chunk.bytes)
            } catch {
              fullResponse += Buffer.from(event.chunk.bytes).toString('utf-8')
            }
          }

          // --- Trace events: logs estruturados (Item 1) ---
          if (event.trace?.trace?.orchestrationTrace) {
            const ot = event.trace.trace.orchestrationTrace

            if (ot.rationale?.text) {
              console.info('[trace] rationale:', ot.rationale.text)
              traceSteps.push({ type: 'rationale', timestamp: new Date().toISOString(), content: { text: ot.rationale.text } })
            }

            if (ot.invocationInput?.actionGroupInvocationInput) {
              const ag = ot.invocationInput.actionGroupInvocationInput
              const actionData = {
                actionGroup: ag.actionGroupName,
                apiPath: ag.apiPath,
                verb: ag.verb,
                parameters: ag.parameters,
                requestBody: ag.requestBody?.content,
              }
              console.info('[trace] actionGroup invoked:', JSON.stringify(actionData))
              // Debug: log raw fields disponíveis
              if (!ag.parameters && !ag.requestBody) {
                console.info('[trace] actionGroup raw keys:', Object.keys(ag).join(', '))
              }
              traceSteps.push({ type: 'actionGroup_invoke', timestamp: new Date().toISOString(), content: actionData })
            }

            if (ot.invocationInput?.knowledgeBaseLookupInput) {
              const kb = ot.invocationInput.knowledgeBaseLookupInput
              const kbData = { knowledgeBaseId: kb.knowledgeBaseId, text: kb.text }
              console.info('[trace] knowledgeBase lookup:', JSON.stringify(kbData))
              traceSteps.push({ type: 'knowledgeBase_lookup', timestamp: new Date().toISOString(), content: kbData })
            }

            if (ot.invocationInput?.agentCollaboratorInvocationInput) {
              const collab = ot.invocationInput.agentCollaboratorInvocationInput
              const collabData = {
                agentCollaboratorName: collab.agentCollaboratorName,
                agentCollaboratorAliasArn: collab.agentCollaboratorAliasArn,
                input: collab.input?.text?.slice(0, 500),
              }
              console.info('[trace] sub-agent invoked:', JSON.stringify(collabData))
              traceSteps.push({ type: 'sub_agent_invoke', timestamp: new Date().toISOString(), content: collabData })
            }

            if (ot.observation?.knowledgeBaseLookupOutput?.retrievedReferences) {
              const refs = ot.observation.knowledgeBaseLookupOutput.retrievedReferences
              const refsData = refs.map((r: any) => ({
                score: r.score,
                uri: r.location?.s3Location?.uri,
                excerpt: r.content?.text?.slice(0, 200),
              }))
              console.info(`[trace] knowledgeBase retrieved ${refs.length} reference(s):`, JSON.stringify(refsData))
              traceSteps.push({ type: 'knowledgeBase_result', timestamp: new Date().toISOString(), content: { references: refsData } })
            }

            if (ot.observation?.actionGroupInvocationOutput) {
              const outputData = { text: ot.observation.actionGroupInvocationOutput.text?.slice(0, 1500) }
              console.info('[trace] actionGroup output:', JSON.stringify({ text: outputData.text?.slice(0, 200) }))
              traceSteps.push({ type: 'actionGroup_result', timestamp: new Date().toISOString(), content: outputData })
            }

            if (ot.observation?.agentCollaboratorInvocationOutput) {
              const collabOut = ot.observation.agentCollaboratorInvocationOutput
              const collabOutData = {
                agentCollaboratorName: collabOut.agentCollaboratorName,
                output: collabOut.output?.text?.slice(0, 500),
              }
              console.info('[trace] sub-agent result:', JSON.stringify(collabOutData))
              traceSteps.push({ type: 'sub_agent_result', timestamp: new Date().toISOString(), content: collabOutData })
            }

            const usage = ot.modelInvocationOutput?.metadata?.usage
            if (usage) {
              totalInputTokens += usage.inputTokens ?? 0
              totalOutputTokens += usage.outputTokens ?? 0
            }
          }

          // --- Erros do stream ---
          if (event.internalServerException) {
            hasError = true
            errorMessage = event.internalServerException.message || 'Erro interno do servidor'
            console.error('[bedrock] Erro interno do agente:', errorMessage)
          }
          if (event.validationException) {
            hasError = true
            errorMessage = event.validationException.message || 'Erro de validação'
            console.error('[bedrock] Erro de validação:', errorMessage)
          }
          if (event.throttlingException) {
            hasError = true
            errorMessage = event.throttlingException.message || 'Throttling'
            console.error('[bedrock] Throttling:', errorMessage)
          }
          if (event.accessDeniedException) {
            hasError = true
            errorMessage = event.accessDeniedException.message || 'Acesso negado'
            console.error('[bedrock] Acesso negado:', errorMessage)
          }
        }
      } catch (streamError: any) {
        console.error('[bedrock] Erro ao processar stream:', streamError.message)
        throw streamError
      }
    } else if (response.outputText) {
      fullResponse = response.outputText
    }

    if (hasError) {
      throw new Error(`Bedrock Agent Error: ${errorMessage}`)
    }

    if (!fullResponse || fullResponse.trim().length === 0) {
      console.warn('[bedrock] Resposta vazia do agente')
      fullResponse = 'Desculpe, não consegui processar sua mensagem no momento.'
    }

    const latencyMs = Date.now() - startTime
    console.info(`[bedrock] Concluído em ${latencyMs}ms — inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens} responseLen=${fullResponse.length}`)

    return {
      response: fullResponse,
      sessionId: newSessionId,
      inputTokens: totalInputTokens || undefined,
      outputTokens: totalOutputTokens || undefined,
      latencyMs,
      trace: traceSteps.length > 0 ? traceSteps : undefined,
    }
  } catch (error: any) {
    console.error('[bedrock] Erro ao chamar agente:', {
      name: error.name,
      message: error.message,
      statusCode: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId,
      agentId,
      agentAliasId,
      region,
    })

    if (error.name === 'InvalidSignatureException' || error.name === 'UnrecognizedClientException') {
      throw new Error('Credenciais AWS inválidas. Verifique suas Access Key e Secret Key nas configurações.')
    }
    if (error.name === 'ResourceNotFoundException') {
      throw new Error(
        `Agent ou Knowledge Base não encontrado. Agent ID: ${agentId}, Alias ID: ${agentAliasId}`
      )
    }
    if (error.name === 'ValidationException') {
      throw new Error(`Erro de validação: ${error.message || 'Parâmetros inválidos'}`)
    }
    if (error.$metadata?.httpStatusCode === 400) {
      throw new Error(
        `Erro 400 ao invocar o Agent (ID: ${agentId} / Alias: ${agentAliasId}).\n` +
        `Verifique se o Alias está PREPARED e as credenciais têm permissão bedrock:InvokeAgent.\n` +
        `Request ID: ${error.$metadata?.requestId || 'N/A'}`
      )
    }

    throw new Error(
      `Erro ao processar sua mensagem: ${error.message || error.name || 'Erro desconhecido'}`
    )
  }
}

