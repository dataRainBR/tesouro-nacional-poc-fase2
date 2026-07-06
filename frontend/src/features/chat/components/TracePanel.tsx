'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight} from 'lucide-react'
import type { TraceStep } from '@tesouro-nacional/shared'

interface TracePanelProps {
  trace: TraceStep[]
}

interface DisplayStep {
  emoji: string
  text: string
  detail?: string
}

/** Traduz nomes técnicos de action groups para nomes amigáveis */
function friendlyAgentName(actionGroup: string): string {
  const map: Record<string, string> = {
    'action_group_time_series_api': 'Base de Séries Temporais (Redshift)',
    'action_group_sql': 'AgenteSQL',
    'action_group_pdf': 'AgentePDF',
  }
  // Tentar match parcial
  for (const [key, name] of Object.entries(map)) {
    if (actionGroup.toLowerCase().includes(key.replace('action_group_', ''))) return name
  }
  return map[actionGroup] || actionGroup
}

/**
 * Agrupa action_invoke + action_result em um passo único e legível.
 * Extrai informações ricas dos resultados JSON para mostrar séries, subtemas, etc.
 */
function summarizeTrace(trace: TraceStep[]): DisplayStep[] {
  const steps: DisplayStep[] = []

  // Identificar agentes/action groups únicos usados neste trace
  const agentsUsed = new Set<string>()
  for (const s of trace) {
    if (s.type === 'sub_agent_invoke' && s.content.agentCollaboratorName) {
      agentsUsed.add(s.content.agentCollaboratorName)
    }
    if (s.type === 'actionGroup_invoke' && s.content.actionGroup) {
      agentsUsed.add(friendlyAgentName(s.content.actionGroup))
    }
  }

  // Adicionar resumo dos agentes/módulos acionados no início
  if (agentsUsed.size > 0) {
    steps.push({
      emoji: '📡',
      text: `Base(s) consultada(s): ${[...agentsUsed].join(', ')}`,
    })
  }

  for (let i = 0; i < trace.length; i++) {
    const step = trace[i]

    switch (step.type) {
      case 'rationale':
        steps.push({ emoji: '💭', text: step.content.text })
        break

      case 'sub_agent_invoke': {
        const name = step.content.agentCollaboratorName || 'sub-agente'
        steps.push({ emoji: '🤖', text: `Agente acionado: ${name}` })
        if (step.content.input) {
          steps.push({ emoji: '🔍', text: `Consulta: "${step.content.input}"` })
        }
        break
      }

      case 'sub_agent_result': {
        const name = step.content.agentCollaboratorName || 'sub-agente'
        const output = step.content.output || ''
        const statusMatch = output.match(/STATUS_AGENTE_\w+:\s*\w+/)
        if (statusMatch) {
          const found = statusMatch[0].includes('DADOS_ENCONTRADOS')
          steps.push({ emoji: found ? '✅' : '❌', text: statusMatch[0] })
        }
        const cleanOutput = output.replace(/STATUS_AGENTE_\w+:\s*\w+/g, '').trim()
        if (cleanOutput.length > 0) {
          steps.push({ emoji: '📋', text: `Resposta de ${name}:`, detail: cleanOutput.slice(0, 600) })
        }
        break
      }

      case 'knowledgeBase_lookup':
        steps.push({ emoji: '🔍', text: `Busca na KB: "${step.content.text?.slice(0, 150)}"` })
        break

      case 'knowledgeBase_result': {
        const refs = step.content.references || []
        if (refs.length > 0) {
          const sources = refs
            .map((r: any) => r.uri?.split('/').pop()?.replace(/\.pdf$/i, '') || null)
            .filter(Boolean)
            .slice(0, 5)
          steps.push({
            emoji: '📄',
            text: `${refs.length} fonte(s) encontrada(s)`,
            detail: sources.length > 0 ? sources.join(', ') : undefined,
          })
        } else {
          steps.push({ emoji: '📄', text: 'Nenhuma fonte encontrada' })
        }
        break
      }

      case 'actionGroup_invoke': {
        const apiPath = step.content.apiPath || ''
        const actionGroup = step.content.actionGroup || ''
        const params = step.content.parameters
        const requestBody = step.content.requestBody

        const actionLabel = getActionLabel(apiPath, actionGroup)
        const paramStr = extractParams(params, requestBody)

        // Olhar o próximo step: se for actionGroup_result, unificar
        const nextStep = i + 1 < trace.length ? trace[i + 1] : null
        if (nextStep?.type === 'actionGroup_result') {
          const resultInfo = parseActionResult(nextStep.content.text || '')
          i++ // pular o result no loop

          if (resultInfo.isError) {
            steps.push({ emoji: '⚙️', text: actionLabel, detail: paramStr || undefined })
            steps.push({ emoji: '⚠️', text: resultInfo.summary })
          } else {
            steps.push({
              emoji: resultInfo.emoji || '⚙️',
              text: resultInfo.summary || actionLabel,
              detail: resultInfo.detail || paramStr || undefined,
            })
          }
        } else {
          steps.push({ emoji: '⚙️', text: actionLabel, detail: paramStr || undefined })
        }
        break
      }

      case 'actionGroup_result': {
        // Caso isolado (não precedido por invoke)
        const resultInfo = parseActionResult(step.content.text || '')
        steps.push({
          emoji: resultInfo.emoji || '📊',
          text: resultInfo.summary || 'Resultado recebido',
          detail: resultInfo.detail || undefined,
        })
        break
      }
    }
  }

  return steps
}

function getActionLabel(apiPath: string, actionGroup: string): string {
  const map: Record<string, string> = {
    '/get-subtema-tree': 'Consultando séries disponíveis no subtema',
    '/get-series-values': 'Buscando valores da série temporal',
    '/get-subtema-values': 'Buscando valores do subtema',
    '/get-series-aggregate': 'Calculando agregação dos dados',
    '/get-ipca-index': 'Consultando IPCA para deflação',
    '/get-serie-by-name': 'Buscando série por nome',
  }
  return map[apiPath] || `Executando ${apiPath || actionGroup}`
}

/** Extrai parâmetros tanto de `parameters` (array) quanto de `requestBody` */
function extractParams(parameters: any, requestBody: any): string | null {
  const parts: string[] = []

  // Tentar parameters (array de {name, type, value})
  if (Array.isArray(parameters)) {
    for (const p of parameters) {
      if (p.name && p.value != null) {
        parts.push(`${p.name}: ${String(p.value)}`)
      }
    }
  }

  // Tentar requestBody: { "application/json": { properties: [...] } }
  if (requestBody && typeof requestBody === 'object') {
    const jsonBody = requestBody['application/json'] || requestBody
    if (jsonBody?.properties && Array.isArray(jsonBody.properties)) {
      for (const p of jsonBody.properties) {
        if (p.name && p.value != null) {
          parts.push(`${p.name}: ${String(p.value)}`)
        }
      }
    }
  }

  return parts.length > 0 ? parts.join(' | ') : null
}

/** Parseia o JSON do resultado de um action group e retorna info legível */
function parseActionResult(text: string): { summary: string; detail?: string; emoji?: string; isError?: boolean } {
  if (!text) return { summary: 'Sem resultado' }

  // Erro
  if (text.includes('"error"')) {
    try {
      const parsed = JSON.parse(text)
      if (parsed.error) return { summary: `${String(parsed.error).slice(0, 200)}`, isError: true }
    } catch { /* fallback */ }
    const m = text.match(/"error"\s*:\s*"([^"]*)"/)
    if (m) return { summary: m[1].slice(0, 200), isError: true }
  }

  // Tentar parsear como JSON
  try {
    const parsed = JSON.parse(text)

    // Resultado de agregação
    if (parsed.serie_id != null && parsed.periodo) {
      const detailParts: string[] = []
      detailParts.push(`Série: "${parsed.serie}" (ID: ${parsed.serie_id})`)
      if (parsed.subtema) detailParts.push(`Subtema: ${parsed.subtema}`)
      if (parsed.unidade) detailParts.push(`Unidade: ${parsed.unidade}`)
      detailParts.push(`Período: ${parsed.periodo.inicio} a ${parsed.periodo.fim}`)
      if (parsed.qtde_meses) detailParts.push(`${parsed.qtde_meses} meses`)
      if (parsed.soma != null) detailParts.push(`Soma: R$ ${fmtNum(parsed.soma)} ${parsed.unidade || ''}`)
      if (parsed.media_mensal != null) detailParts.push(`Média mensal: R$ ${fmtNum(parsed.media_mensal)} ${parsed.unidade || ''}`)

      return {
        emoji: '📊',
        summary: `Dados obtidos: ${parsed.serie}`,
        detail: detailParts.join('\n'),
      }
    }

    // Resultado de subtema (lista de séries)
    if (parsed.subtema && parsed.total_series != null) {
      const serieLines = (parsed.series || [])
        .slice(0, 8)
        .map((s: any) => `  • ${s.codigo || ''} ${s.descricao || ''} (${s.periodicidade || ''}, ${s.unidade || ''})`)
        .join('\n')
      const more = parsed.total_series > 8 ? `\n  ... e mais ${parsed.total_series - 8}` : ''

      return {
        emoji: '📋',
        summary: `Subtema "${parsed.subtema}" — ${parsed.total_series} séries disponíveis`,
        detail: serieLines + more || undefined,
      }
    }

    // IPCA
    if (parsed.indice != null || parsed.valor_deflacionado != null) {
      return {
        emoji: '📈',
        summary: `IPCA obtido${parsed.mes_referencia ? ` (ref: ${parsed.mes_referencia})` : ''}`,
        detail: parsed.valor_deflacionado ? `Valor deflacionado: R$ ${fmtNum(parsed.valor_deflacionado)}` : undefined,
      }
    }

  } catch { /* texto não é JSON válido - pode estar truncado */ }

  // Tentar parse parcial de JSON truncado
  const subtemaMatch = text.match(/"subtema"\s*:\s*"([^"]+)"/)
  const totalSeriesMatch = text.match(/"total_series"\s*:\s*(\d+)/)
  if (subtemaMatch && totalSeriesMatch) {
    return {
      emoji: '📋',
      summary: `Subtema "${subtemaMatch[1]}" — ${totalSeriesMatch[1]} séries disponíveis`,
      detail: extractSeriesFromTruncated(text),
    }
  }

  const serieMatch = text.match(/"serie"\s*:\s*"([^"]+)"/)
  const somaMatch = text.match(/"soma"\s*:\s*([\d.]+)/)
  if (serieMatch && somaMatch) {
    return {
      emoji: '📊',
      summary: `Dados obtidos: ${serieMatch[1]} — Soma: R$ ${fmtNum(Number(somaMatch[1]))}`,
    }
  }

  // Fallback
  if (text.length < 200) return { summary: text }
  return { summary: text.slice(0, 150) + '...' }
}

/** Extrai séries de JSON truncado usando regex */
function extractSeriesFromTruncated(text: string): string | undefined {
  const seriesRegex = /"codigo"\s*:\s*"([^"]+)"\s*,\s*"descricao"\s*:\s*"([^"]+)"/g
  const found: string[] = []
  let match
  while ((match = seriesRegex.exec(text)) !== null && found.length < 8) {
    found.push(`  • ${match[1]} ${match[2]}`)
  }
  return found.length > 0 ? found.join('\n') : undefined
}

function fmtNum(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function TraceStepItem({ step }: { step: DisplayStep }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = !!step.detail

  return (
    <li className="flex items-start gap-2 py-1">
      <span className="flex-shrink-0 w-5 text-center text-sm leading-5">{step.emoji}</span>
      <div className="flex-1 min-w-0">
        <div
          className={`text-xs text-neutral-700 leading-relaxed ${hasDetail ? 'cursor-pointer hover:text-neutral-900' : ''}`}
          onClick={() => hasDetail && setExpanded(!expanded)}
        >
          <span>{step.text}</span>
          {hasDetail && (
            <span className="inline-flex ml-1 text-neutral-400 align-middle">
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </span>
          )}
        </div>
        {expanded && step.detail && (
          <pre className="mt-1 text-[11px] text-neutral-500 whitespace-pre-wrap bg-neutral-50 rounded px-2 py-1.5 border border-neutral-100 leading-relaxed">
            {step.detail}
          </pre>
        )}
      </div>
    </li>
  )
}

export function TracePanel({ trace }: TracePanelProps) {
  const [open, setOpen] = useState(false)

  if (!trace || trace.length === 0) return null

  const steps = summarizeTrace(trace)
  if (steps.length === 0) return null

  return (
    <div className="mt-2 border border-neutral-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span className="font-medium">Como cheguei nessa resposta</span>
        <span className="text-neutral-400 ml-auto">{steps.length} passo(s)</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-neutral-100">
          <ol className="mt-2 space-y-0.5">
            {steps.map((step, i) => (
              <TraceStepItem key={i} step={step} />
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
