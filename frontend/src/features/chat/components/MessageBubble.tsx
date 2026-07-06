'use client'

import { Copy, ThumbsUp, ThumbsDown, User, Bot, Pencil, RotateCcw, Check, X, Download, MoreHorizontal } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { format } from 'date-fns'
import ptBR from 'date-fns/locale/pt-BR'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { Message } from '@tesouro-nacional/shared'
import { TracePanel } from './TracePanel'

/**
 * Preprocessa o conteúdo para evitar que "$" isolado seja interpretado como delimitador LaTeX.
 * Preserva blocos math reais ($$...$$ e $...$) quando contêm comandos LaTeX.
 */
function preprocessMathContent(content: string): string {
  // Preservar blocos $$ ... $$ (math display) que contêm LaTeX real
  // LaTeX real contém comandos como \frac, \text, \left, \right, \sum, etc.
  const hasRealLatex = /\$\$[\s\S]*?\\(frac|text|left|right|sum|int|sqrt|cdot)[\s\S]*?\$\$/.test(content)
  
  if (hasRealLatex) {
    // Tem LaTeX real — deixar o KaTeX renderizar
    return content
  }
  
  // Não tem LaTeX real — escapar todos os $ para evitar falsos positivos
  // Escapar $ que não faz parte de $$ (math block)
  return content.replace(/\$/g, '\\$')
}

interface MessageBubbleProps {
  message: Message
  onCopy: () => void
  onFeedback: (feedback: 'like' | 'dislike') => void
  onEdit?: (newContent: string) => void
  onRetry?: () => void
  isLastUserMessage?: boolean
}

export function MessageBubble({ message, onCopy, onFeedback, onEdit, onRetry }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isError = !isUser && message.content.startsWith('Desculpe, ocorreu um erro')
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(message.content)
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus()
      editRef.current.setSelectionRange(editValue.length, editValue.length)
    }
  }, [editing])

  const handleEditConfirm = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== message.content && onEdit) {
      onEdit(trimmed)
    }
    setEditing(false)
  }

  const handleEditCancel = () => {
    setEditValue(message.content)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleEditConfirm()
    }
    if (e.key === 'Escape') {
      handleEditCancel()
    }
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser ? 'bg-primary-500' : 'bg-neutral-200'
      }`}>
        {isUser ? (
          <User className="w-5 h-5 text-white" />
        ) : (
          <Bot className="w-5 h-5 text-neutral-700" />
        )}
      </div>

      <div className={`flex-1 ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`rounded-lg px-4 py-3 ${
          isUser && editing
            ? 'w-full max-w-[95%]'
            : 'max-w-[80%]'
        } ${
          isUser
            ? 'bg-primary-500 text-white'
            : isError
              ? 'bg-red-50 text-neutral-900 border border-red-200'
              : 'bg-neutral-100 text-neutral-900'
        }`}>
          {isUser && editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                ref={editRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={Math.min(editValue.split('\n').length + 1, 12)}
                className="w-full bg-white/20 text-white placeholder-white/60 rounded px-3 py-2 text-sm resize-y min-h-[150px] max-h-[400px] focus:outline-none focus:ring-1 focus:ring-white/50"
              />
              <div className="flex items-center gap-1.5 justify-end">
                <button
                  onClick={handleEditCancel}
                  className="p-1 text-white/70 hover:text-white rounded transition-colors"
                  title="Cancelar (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  onClick={handleEditConfirm}
                  className="p-1 text-white/70 hover:text-white rounded transition-colors"
                  title="Confirmar (Enter)"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : isUser ? (
            <p className="text-sm whitespace-pre-wrap break-words">
              {message.content}
            </p>
          ) : (
            <div className="text-sm prose prose-sm max-w-none prose-neutral">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  h1: ({ node, ...props }) => <h1 className="text-lg font-bold text-neutral-900 mt-4 mb-3 first:mt-0" {...props} />,
                  h2: ({ node, ...props }) => <h2 className="text-base font-bold text-neutral-900 mt-4 mb-3 first:mt-0" {...props} />,
                  h3: ({ node, ...props }) => <h3 className="text-sm font-bold text-neutral-900 mt-3 mb-2 first:mt-0" {...props} />,
                  h4: ({ node, ...props }) => <h4 className="text-sm font-semibold text-neutral-900 mt-3 mb-2 first:mt-0" {...props} />,
                  p: ({ node, ...props }) => <p className="text-sm text-neutral-900 leading-relaxed my-3 first:mt-0 last:mb-0" {...props} />,
                  ul: ({ node, ...props }) => <ul className="list-disc list-outside ml-5 space-y-2 my-3 text-sm" {...props} />,
                  ol: ({ node, ...props }) => <ol className="list-decimal list-outside ml-5 space-y-2 my-3 text-sm" {...props} />,
                  li: ({ node, ...props }) => <li className="text-neutral-900 leading-relaxed pl-1" {...props} />,
                  strong: ({ node, ...props }) => <strong className="font-semibold text-neutral-900" {...props} />,
                  em: ({ node, ...props }) => <em className="italic text-neutral-800" {...props} />,
                  code: ({ node, inline, ...props }: any) => 
                    inline ? (
                      <code className="bg-neutral-200 text-neutral-900 px-1.5 py-0.5 rounded text-xs font-mono" {...props} />
                    ) : (
                      <code className="block bg-neutral-200 text-neutral-900 p-3 rounded text-xs font-mono overflow-x-auto my-3" {...props} />
                    ),
                  pre: ({ node, ...props }) => <pre className="bg-neutral-200 p-3 rounded overflow-x-auto my-3" {...props} />,
                  blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-primary-500 pl-4 py-2 my-3 italic text-neutral-700" {...props} />,
                  a: ({ node, ...props }) => <a className="text-primary-600 hover:text-primary-700 underline" target="_blank" rel="noopener noreferrer" {...props} />,
                  table: ({ node, ...props }) => {
                    const handleTableAction = (e: React.MouseEvent, action: 'export' | 'copy') => {
                      const MAX_EXPORT_ROWS = 200
                      const wrapper = (e.currentTarget as HTMLElement).closest('[data-tw]')
                      const tableEl = wrapper?.querySelector('table')
                      if (!tableEl) return
                      const rows = tableEl.querySelectorAll('tr')
                      let data = Array.from(rows).map(row =>
                        Array.from(row.querySelectorAll('th, td')).map(cell => (cell.textContent?.trim() || '').replace(/\*\*/g, ''))
                      )
                      const details = (e.currentTarget as HTMLElement).closest('details')
                      if (details) details.removeAttribute('open')
                      const toast = wrapper?.querySelector('[data-toast]') as HTMLElement | null
                      const totalRows = data.length - 1 // excluir header
                      const truncated = totalRows > MAX_EXPORT_ROWS
                      if (truncated) {
                        data = data.slice(0, MAX_EXPORT_ROWS + 1) // header + 200 linhas
                        data.push([`⚠️ Exportação limitada a ${MAX_EXPORT_ROWS} linhas de ${totalRows}. Consulte as fontes oficiais para o conjunto completo.`])
                      }
                      if (action === 'export') {
                        const csv = data.map(row => row.map(c => c.includes(',') || c.includes('"') ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\n')
                        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url; a.download = `tabela-${Date.now()}.csv`; a.click()
                        URL.revokeObjectURL(url)
                        if (toast) { toast.textContent = truncated ? `Exportado (limitado a ${MAX_EXPORT_ROWS} linhas)` : 'Exportado com sucesso'; toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 3000) }
                      } else {
                        const copyData = data.slice(0, MAX_EXPORT_ROWS + 1)
                        navigator.clipboard.writeText(copyData.map(row => row.join('\t')).join('\n'))
                        if (toast) { toast.textContent = truncated ? `Copiado (limitado a ${MAX_EXPORT_ROWS} linhas)` : 'Copiado para área de transferência'; toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 3000) }
                      }
                    }
                    return (
                      <div className="relative my-3" data-tw="">
                        <div className="overflow-x-auto">
                          <table className="min-w-full border-collapse border border-neutral-300" {...props} />
                        </div>
                        <div className="mt-1">
                          <details className="relative inline-block">
                            <summary className="list-none p-1.5 bg-white border border-neutral-200 rounded-full shadow-sm hover:bg-neutral-50 cursor-pointer inline-flex" title="Mais opções">
                              <MoreHorizontal className="w-4 h-4 text-neutral-500" />
                            </summary>
                            <div className="absolute bottom-full left-0 mb-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-50 py-1 min-w-[200px]">
                              <button onClick={(e) => handleTableAction(e, 'export')} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50">
                                <Download className="w-3.5 h-3.5" /> Exportar para Planilhas
                              </button>
                              <button onClick={(e) => handleTableAction(e, 'copy')} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50">
                                <Copy className="w-3.5 h-3.5" /> Copiar
                              </button>
                            </div>
                          </details>
                        </div>
                        <div data-toast="" className="hidden absolute left-12 bottom-1 px-3 py-1.5 bg-neutral-800 text-white text-[11px] rounded-lg shadow-lg z-50"></div>
                      </div>
                    )
                  },
                  thead: ({ node, ...props }) => <thead className="bg-neutral-200" {...props} />,
                  tbody: ({ node, ...props }) => <tbody {...props} />,
                  tr: ({ node, ...props }) => <tr className="border-b border-neutral-300" {...props} />,
                  th: ({ node, ...props }) => <th className="border border-neutral-300 px-3 py-2 text-left text-sm font-semibold" {...props} />,
                  td: ({ node, ...props }) => <td className="border border-neutral-300 px-3 py-2 text-sm" {...props} />,
                  hr: ({ node, ...props }) => <hr className="my-4 border-neutral-300" {...props} />,
                }}
              >
                {preprocessMathContent(message.content)}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Trace: raciocínio do agente */}
        {!isUser && message.trace && message.trace.length > 0 && (
          <div className="max-w-[80%]">
            <TracePanel trace={message.trace} />
          </div>
        )}

        {/* Ações do assistente */}
        {!isUser && (
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={onCopy}
              className="p-1.5 text-neutral-500 hover:text-primary-500 hover:bg-primary-50 rounded-md transition-colors"
              aria-label="Copiar resposta"
              title="Copiar resposta"
            >
              <Copy className="w-4 h-4" />
            </button>
            {/* Retry — aparece em mensagens de erro */}
            {isError && onRetry && (
              <button
                onClick={onRetry}
                className="p-1.5 text-neutral-500 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors"
                aria-label="Tentar novamente"
                title="Tentar novamente"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            {!isError && (
              <>
                <button
                  onClick={() => onFeedback('like')}
                  className={`p-1.5 rounded-md transition-colors ${
                    message.feedback === 'like'
                      ? 'text-success bg-success/10'
                      : 'text-neutral-500 hover:text-success hover:bg-success/10'
                  }`}
                  aria-label="Curtir resposta"
                  title="Curtir resposta"
                >
                  <ThumbsUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onFeedback('dislike')}
                  className={`p-1.5 rounded-md transition-colors ${
                    message.feedback === 'dislike'
                      ? 'text-error bg-error/10'
                      : 'text-neutral-500 hover:text-error hover:bg-error/10'
                  }`}
                  aria-label="Não curtir resposta"
                  title="Não curtir resposta"
                >
                  <ThumbsDown className="w-4 h-4" />
                </button>
              </>
            )}
            <span className="text-xs text-neutral-400 ml-2">
              {format(new Date(message.timestamp), "HH:mm", { locale: ptBR })}
            </span>
          </div>
        )}

        {/* Ações do usuário */}
        {isUser && !editing && (
          <div className="flex items-center gap-1.5">
            {onEdit && (
              <button
                onClick={() => { setEditValue(message.content); setEditing(true) }}
                className="p-1 text-neutral-400 hover:text-primary-500 rounded transition-colors"
                aria-label="Editar mensagem"
                title="Editar mensagem"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <span className="text-xs text-neutral-400">
              {format(new Date(message.timestamp), "HH:mm", { locale: ptBR })}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
