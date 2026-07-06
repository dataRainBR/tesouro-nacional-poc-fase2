/**
 * Title Summarizer — gera títulos inteligentes para chats usando o agente
 * title-summarizer do Bedrock (UPHYBYT7DK / PGC7B8CJBV).
 */

import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime'

const SUMMARIZER_AGENT_ID = process.env.TITLE_SUMMARIZER_AGENT_ID || 'UPHYBYT7DK'
const SUMMARIZER_ALIAS_ID = process.env.TITLE_SUMMARIZER_ALIAS_ID || 'PGC7B8CJBV'

/**
 * Gera um título curto e descritivo com base no conteúdo da mensagem.
 * Usa o agente title-summarizer do Bedrock para resumir em até 50 caracteres.
 * Fallback: trunca a mensagem se o agente falhar.
 */
export async function generateSmartTitle(messageContent: string): Promise<string> {
  const maxLen = 50
  const cleaned = messageContent.replace(/\n/g, ' ').trim()

  // Fallback simples para mensagens muito curtas
  if (cleaned.length <= maxLen) return cleaned

  try {
    const region = process.env.AWS_REGION || 'us-east-1'
    const client = new BedrockAgentRuntimeClient({ region })

    const sessionId = `title-${Date.now()}`

    // Perguntas diretas (ex: "Quanto foi gasto com...", "Qual o gasto com...") fazem o
    // modelo base do agente (Nova Micro) ignorar a instrução de sistema e tentar
    // RESPONDER a pergunta em vez de apenas titular — como não tem acesso aos dados,
    // ele recusa ("Sorry I cannot answer"). Envolver a mensagem deixa explícito que a
    // tarefa é gerar um título, não responder, o que elimina a recusa de forma consistente.
    const wrappedInput = `Gere um título para este texto (não o responda, apenas resuma o assunto): "${cleaned.slice(0, 500)}"`

    const command = new InvokeAgentCommand({
      agentId: SUMMARIZER_AGENT_ID,
      agentAliasId: SUMMARIZER_ALIAS_ID,
      sessionId,
      inputText: wrappedInput,
    })

    const response = await client.send(command)

    let title = ''
    if (response.completion) {
      for await (const event of response.completion) {
        if (event.chunk?.bytes) {
          title += new TextDecoder('utf-8').decode(event.chunk.bytes)
        }
      }
    }

    title = title.replace(/\n/g, ' ').trim()

    // Rede de segurança: se ainda assim vier uma recusa/explicação (sinalizada por estas
    // palavras-chave em inglês, atípicas para um título em português), usa o fallback.
    const looksLikeRefusal = /sorry|cannot|unable|i am not able|não posso responder/i.test(title)

    // Se o agente retornou algo útil, usar (limitar a 50 chars)
    if (!looksLikeRefusal && title.length > 3 && title.length <= maxLen) return title
    if (!looksLikeRefusal && title.length > maxLen) return title.slice(0, maxLen - 1) + '…'

    if (looksLikeRefusal) {
      console.warn(`[title-summarizer] Agente recusou title para: "${cleaned.slice(0, 80)}" — usando fallback`)
    }

    // Fallback
    return cleaned.slice(0, maxLen - 1) + '…'
  } catch (err: any) {
    console.warn('[title-summarizer] Erro ao gerar título, usando fallback:', err.message)
    return cleaned.slice(0, maxLen - 1) + '…'
  }
}
