/**
 * SiswebLogger — envia log de interação ao endpoint de métricas do Tesouro Nacional.
 *
 * O envio ao SISWEB é OBRIGATÓRIO (compliance): toda interação com o agente
 * deve ser registrada. Diferente da versão Python original, esta implementação
 * faz retry com backoff antes de desistir e registra alertas claros em caso de falha.
 *
 * Variáveis de ambiente:
 *   SISWEB_API_TOKEN   — Bearer token de autenticação (obrigatório)
 *   SISWEB_API_URL     — URL do endpoint (default: produção)
 *   SISWEB_ID_SOLUCAO  — ID da solução cadastrada (default: 441)
 */

const API_URL =
  process.env.SISWEB_API_URL ||
  'https://apiapex.tesouro.gov.br/aria/v1/logos_metricas/custom/mensagem'
const TOKEN = process.env.SISWEB_API_TOKEN || ''
const ID_SOLUCAO = process.env.SISWEB_ID_SOLUCAO || '441'

const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 500
const REQUEST_TIMEOUT_MS = 5000

export interface SiswebInteractionLog {
  dataHoraReq: string
  dataHoraResp: string
  txBodyReq: string
  txBodyResp: string
  idInteracao: string
  dadosUsuario: string
  txHeaderReq?: string
  txHeaderResp?: string
  nuStatusHttp?: string
  txUrl?: string
  nomeModelo?: string
  nomeObjeto?: string
  nuMaxTokens?: string
  nuPromptTokens?: string
  nuCompletionTokens?: string
  nuTotalTokens?: string
}

// Alias para compatibilidade com imports existentes
export type SiswebLogEntry = SiswebInteractionLog

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface SiswebResult {
  ok: boolean
  /** Detalhe legível do que aconteceu (status HTTP + corpo, timeout, erro de rede) */
  detail: string
  /** Status HTTP da última tentativa, se houve resposta */
  httpStatus?: number
  /** Número de tentativas realizadas */
  attempts: number
}

/**
 * Envia um registro de interação ao SISWEB com retry/backoff.
 * Retorna um objeto com o resultado e o detalhe do erro (para diagnóstico no admin).
 * Nunca lança exceção (não deve quebrar o fluxo do chat).
 */
export async function sendInteractionLog(data: SiswebInteractionLog): Promise<SiswebResult> {
  if (!TOKEN) {
    const detail = 'SISWEB_API_TOKEN não configurado no ambiente'
    console.warn(`[sisweb] ${detail} — interação NÃO registrada: ${data.idInteracao}`)
    return { ok: false, detail, attempts: 0 }
  }

  const payload = {
    txHeaderReq: data.txHeaderReq ?? '',
    dataHoraReq: data.dataHoraReq,
    dataHoraResp: data.dataHoraResp,
    txBodyReq: data.txBodyReq,
    txBodyResp: data.txBodyResp,
    idInteracao: data.idInteracao,
    dadosUsuario: data.dadosUsuario,
    txHeaderResp: data.txHeaderResp ?? '',
    nuStatusHttp: data.nuStatusHttp ?? '200',
    txUrl: data.txUrl ?? '',
    idSolucao: ID_SOLUCAO,
    nuMaxTokens: data.nuMaxTokens ?? '',
    nomeModelo: data.nomeModelo ?? '',
    nomeObjeto: data.nomeObjeto ?? '',
    nuCompletionTokens: data.nuCompletionTokens ?? '',
    nuPromptTokens: data.nuPromptTokens ?? '',
    nuTotalTokens: data.nuTotalTokens ?? '',
  }

  const body = JSON.stringify(payload)
  let lastDetail = 'Erro desconhecido'
  let lastHttpStatus: number | undefined

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKEN}`,
        },
        body,
        signal: controller.signal,
      })
      clearTimeout(timer)
      lastHttpStatus = resp.status

      if (resp.ok) {
        console.info(`[sisweb] log enviado idInteracao=${data.idInteracao} status=${resp.status} (tentativa ${attempt})`)
        return { ok: true, detail: `HTTP ${resp.status}`, httpStatus: resp.status, attempts: attempt }
      }

      const text = await resp.text().catch(() => '')
      lastDetail = `HTTP ${resp.status}${text ? `: ${text.slice(0, 300)}` : ` ${resp.statusText || ''}`.trimEnd()}`

      // Erros 4xx (exceto 429) não devem ser repetidos — payload/credencial provavelmente inválido
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
        console.error(`[sisweb] falha definitiva idInteracao=${data.idInteracao} ${lastDetail}`)
        return { ok: false, detail: lastDetail, httpStatus: resp.status, attempts: attempt }
      }

      console.warn(`[sisweb] tentativa ${attempt}/${MAX_RETRIES} falhou idInteracao=${data.idInteracao} ${lastDetail}`)
    } catch (err: any) {
      clearTimeout(timer)
      lastDetail = err.name === 'AbortError'
        ? `Timeout após ${REQUEST_TIMEOUT_MS}ms sem resposta do SISWEB`
        : `Erro de rede: ${err.message}`
      console.warn(`[sisweb] tentativa ${attempt}/${MAX_RETRIES} erro idInteracao=${data.idInteracao}: ${lastDetail}`)
    }

    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1))
    }
  }

  const detail = `${lastDetail} (após ${MAX_RETRIES} tentativas)`
  console.error(`[sisweb] FALHA: interação ${data.idInteracao} não registrada — ${detail}`)
  return { ok: false, detail, httpStatus: lastHttpStatus, attempts: MAX_RETRIES }
}
