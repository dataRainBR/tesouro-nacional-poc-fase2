/**
 * Fine-Tuned Model Service — invoca modelos customizados do Bedrock via InvokeModel
 * (diferente de Bedrock Agents, que usam InvokeAgent com orquestração própria).
 *
 * Modelos fine-tuned não têm orquestração de agente — o prompt precisa ser montado
 * manualmente, incluindo o system prompt configurado no cadastro do modelo.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import type { FineTunedModelConfig } from '../database/finetuned-models.repository.js'
import { generateResponseWithBedrock } from './bedrock.service.js'
import { getAgent } from '../database/agents.repository.js'

export interface FineTunedInvokeResult {
  response: string
  inputTokens?: number
  outputTokens?: number
  latencyMs: number
  usedFallback: boolean
  fallbackReason?: string
}

function getClient(region?: string): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: region || process.env.AWS_REGION || 'us-east-1',
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  })
}

const DEFAULT_SYSTEM_PROMPT = 'Você é um assistente especializado do Tesouro Nacional. Responda de forma técnica e precisa.'

/**
 * Monta o body da requisição no formato esperado pela família de modelo.
 * Detecta a família pelo ARN/modelId:
 * - Amazon Nova (amazon.nova-*) — formato Converse-like: content é array de {text}, system é array de {text}
 * - Claude/Anthropic (anthropic.*) — formato Messages API tradicional
 * Outros provedores podem precisar de ajuste adicional aqui.
 */
function buildRequestBody(modelArn: string, message: string, systemPrompt?: string, modelHint?: string): string {
  // O ARN de um Custom Model Deployment (custom-model-deployment/xxx) não contém
  // o identificador da família do modelo base — por isso também verificamos o
  // nome/descrição cadastrados (modelHint) como fallback de detecção.
  const isNova = /amazon\.nova/i.test(modelArn) || /nova/i.test(modelHint || '')
  const system = systemPrompt || DEFAULT_SYSTEM_PROMPT

  if (isNova) {
    return JSON.stringify({
      schemaVersion: 'messages-v1',
      system: [{ text: system }],
      messages: [
        { role: 'user', content: [{ text: message }] },
      ],
      inferenceConfig: { maxTokens: 2048 },
    })
  }

  // Claude/Anthropic (default)
  return JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2048,
    system,
    messages: [
      { role: 'user', content: message },
    ],
  })
}

function parseResponseBody(modelArn: string, bytes: Uint8Array, modelHint?: string): { text: string; inputTokens?: number; outputTokens?: number } {
  const parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes))

  // Formato Amazon Nova (Converse-like)
  if (parsed.output?.message?.content && Array.isArray(parsed.output.message.content)) {
    const text = parsed.output.message.content.map((c: any) => c.text || '').join('')
    return {
      text,
      inputTokens: parsed.usage?.inputTokens,
      outputTokens: parsed.usage?.outputTokens,
    }
  }

  // Formato Claude (Anthropic Messages API via Bedrock)
  if (parsed.content && Array.isArray(parsed.content)) {
    const text = parsed.content.map((c: any) => c.text || '').join('')
    return {
      text,
      inputTokens: parsed.usage?.input_tokens,
      outputTokens: parsed.usage?.output_tokens,
    }
  }

  // Fallback genérico
  return { text: parsed.completion || parsed.generated_text || JSON.stringify(parsed) }
}

/**
 * Invoca o modelo fine-tuned diretamente via InvokeModel.
 * Em caso de erro ou resposta vazia, roteia automaticamente para o agente de fallback
 * configurado (se houver), preservando a experiência do usuário.
 */
export async function invokeFineTunedModel(
  model: FineTunedModelConfig,
  message: string,
  sessionId?: string
): Promise<FineTunedInvokeResult> {
  const start = Date.now()

  try {
    const client = getClient(model.region)

    const command = new InvokeModelCommand({
      modelId: model.modelArn,
      contentType: 'application/json',
      accept: 'application/json',
      body: buildRequestBody(model.modelArn, message, model.systemPrompt, `${model.name} ${model.description || ''}`),
    })

    const response = await client.send(command)

    if (!response.body) {
      throw new Error('Resposta vazia do modelo fine-tuned')
    }

    const { text, inputTokens, outputTokens } = parseResponseBody(model.modelArn, response.body as Uint8Array, `${model.name} ${model.description || ''}`)

    if (!text || text.trim().length === 0) {
      throw new Error('Modelo fine-tuned retornou texto vazio')
    }

    return {
      response: text,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - start,
      usedFallback: false,
    }
  } catch (err: any) {
    console.error(`[finetuned-model] Erro ao invocar modelo ${model.name} (${model.modelArn}):`, err.message)

    // ── Fallback para agente base ──
    if (model.fallbackAgentId) {
      try {
        const fallbackAgent = await getAgent(model.fallbackAgentId)
        if (fallbackAgent) {
          console.warn(`[finetuned-model] Roteando para agente de fallback: ${fallbackAgent.name}`)
          const fallbackResult = await generateResponseWithBedrock(message, sessionId, {
            agentId: fallbackAgent.agentId,
            agentAliasId: fallbackAgent.agentAliasId,
            region: fallbackAgent.region,
          })

          return {
            response: fallbackResult.response,
            inputTokens: fallbackResult.inputTokens,
            outputTokens: fallbackResult.outputTokens,
            latencyMs: Date.now() - start,
            usedFallback: true,
            fallbackReason: err.message,
          }
        }
      } catch (fallbackErr: any) {
        console.error('[finetuned-model] Fallback também falhou:', fallbackErr.message)
        throw new Error(
          `Modelo fine-tuned falhou (${err.message}) e o fallback também falhou (${fallbackErr.message}).`
        )
      }
    }

    throw new Error(`Erro ao invocar modelo fine-tuned "${model.name}": ${err.message}`)
  }
}

/**
 * Calcula o custo estimado da invocação com base no preço configurado no modelo.
 */
export function estimateCost(
  model: FineTunedModelConfig,
  inputTokens?: number,
  outputTokens?: number
): number | undefined {
  if (!model.pricePerThousandInputTokens && !model.pricePerThousandOutputTokens) return undefined

  const inputCost = ((inputTokens || 0) / 1000) * (model.pricePerThousandInputTokens || 0)
  const outputCost = ((outputTokens || 0) / 1000) * (model.pricePerThousandOutputTokens || 0)

  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
}
