'use client'

import { MessageSquare, Plus, Trash2, Pencil, Archive, Copy, Search, X, ArchiveRestore, Loader2 } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import ptBR from 'date-fns/locale/pt-BR'
import type { Chat } from '@tesouro-nacional/shared'
import { api } from '@/src/shared/services/api'
import { isChatLoading, onLoadingChange } from './ChatInterface'

interface ChatHistoryProps {
  selectedChatId: string | null
  onSelectChat: (chatId: string | null) => void
}

export function ChatHistory({ selectedChatId, onSelectChat }: ChatHistoryProps) {
  const [chats, setChats] = useState<Chat[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Chat[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { fetchChats() }, [showArchived])

  // Re-render quando loading de algum chat muda (para mostrar spinner na sidebar)
  const [, forceUpdate] = useState(0)
  useEffect(() => onLoadingChange(() => forceUpdate((n) => n + 1)), [])

  useEffect(() => {
    const handler = () => fetchChats()
    window.addEventListener('chatCreated', handler as EventListener)
    window.addEventListener('chatTitleUpdated', handler as EventListener)
    return () => {
      window.removeEventListener('chatCreated', handler as EventListener)
      window.removeEventListener('chatTitleUpdated', handler as EventListener)
    }
  }, [showArchived])

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  const fetchChats = async () => {
    try {
      const url = showArchived ? '/api/chats?archived=true' : '/api/chats'
      const data = await api.get<Chat[]>(url)
      setChats(data)
    } catch (error) {
      console.error('Erro ao buscar chats:', error)
    }
  }

  const handleSearch = (value: string) => {
    setSearchQuery(value)
    clearTimeout(searchTimeout.current)

    if (!value.trim()) {
      setSearchResults(null)
      return
    }

    setSearching(true)
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await api.get<Chat[]>(`/api/chats/search?q=${encodeURIComponent(value)}`)
        setSearchResults(results)
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  const createNewChat = () => {
    onSelectChat(null)
  }

  const handleDelete = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.delete(`/api/chats/${chatId}`)
      setChats(prev => prev.filter(c => c.id !== chatId))
      if (selectedChatId === chatId) onSelectChat(null)
    } catch (error) {
      console.error('Erro ao deletar chat:', error)
    }
  }

  const handleRename = async (chatId: string) => {
    if (!editTitle.trim()) {
      setEditingId(null)
      return
    }
    try {
      await api.put(`/api/chats/${chatId}/title`, { title: editTitle.trim() })
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, title: editTitle.trim() } : c))
    } catch (error) {
      console.error('Erro ao renomear:', error)
    } finally {
      setEditingId(null)
    }
  }

  const handleArchive = async (chatId: string, archived: boolean, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.put(`/api/chats/${chatId}/archive`, { archived })
      setChats(prev => prev.filter(c => c.id !== chatId))
      if (selectedChatId === chatId) onSelectChat(null)
    } catch (error) {
      console.error('Erro ao arquivar:', error)
    }
  }

  const handleDuplicate = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const newChat = await api.post<Chat>(`/api/chats/${chatId}/duplicate`, {})
      setChats(prev => [newChat, ...prev])
      onSelectChat(newChat.id)
    } catch (error) {
      console.error('Erro ao duplicar:', error)
    }
  }

  const displayChats = searchResults !== null ? searchResults : chats

  return (
    <div className="card h-[calc(100vh-12rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-neutral-900">Conversas</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`p-1.5 rounded-md transition-colors ${showArchived ? 'text-primary-600 bg-primary-50' : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50'}`}
            aria-label={showArchived ? 'Ver ativas' : 'Ver arquivadas'}
            title={showArchived ? 'Ver ativas' : 'Ver arquivadas'}
          >
            <Archive className="w-4 h-4" />
          </button>
          <button
            onClick={createNewChat}
            className="p-1.5 text-primary-500 hover:bg-primary-50 rounded-md transition-colors"
            aria-label="Novo chat"
            title="Nova conversa"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="w-4 h-4 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Pesquisar conversas..."
          className="w-full pl-8 pr-8 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); setSearchResults(null) }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {showArchived && (
        <p className="text-xs text-neutral-500 mb-2 px-1">Mostrando conversas arquivadas</p>
      )}

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {searching ? (
          <div className="text-center py-8 text-neutral-400">
            <p className="text-sm">Pesquisando...</p>
          </div>
        ) : displayChats.length === 0 ? (
          <div className="text-center py-8 text-neutral-500">
            <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">
              {searchResults !== null ? 'Nenhum resultado' : showArchived ? 'Nenhuma conversa arquivada' : 'Nenhuma conversa'}
            </p>
            {!searchResults && !showArchived && (
              <p className="text-xs mt-1 text-neutral-400">Comece digitando uma mensagem</p>
            )}
          </div>
        ) : (
          displayChats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => { if (editingId !== chat.id) onSelectChat(chat.id) }}
              className={`px-3 py-2.5 rounded-lg cursor-pointer transition-colors group ${
                selectedChatId === chat.id
                  ? 'bg-primary-50 border border-primary-200'
                  : 'hover:bg-neutral-50 border border-transparent'
              }`}
            >
              {editingId === chat.id ? (
                <form onSubmit={(e) => { e.preventDefault(); handleRename(chat.id) }} className="flex gap-1">
                  <input
                    ref={editInputRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleRename(chat.id)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null) }}
                    className="flex-1 text-sm px-2 py-1 border border-primary-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </form>
              ) : (
                <div className="flex items-start justify-between gap-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-900 truncate flex items-center gap-1.5">
                      {chat.title}
                      {isChatLoading(chat.id) && (
                        <Loader2 className="w-3.5 h-3.5 text-primary-500 animate-spin flex-shrink-0" />
                      )}
                    </p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {format(new Date(chat.updatedAt), "dd MMM, HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingId(chat.id); setEditTitle(chat.title) }}
                      className="p-1 text-neutral-400 hover:text-neutral-600 rounded"
                      title="Renomear"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {showArchived ? (
                      <button
                        onClick={(e) => handleArchive(chat.id, false, e)}
                        className="p-1 text-neutral-400 hover:text-primary-600 rounded"
                        title="Desarquivar"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => handleArchive(chat.id, true, e)}
                        className="p-1 text-neutral-400 hover:text-amber-600 rounded"
                        title="Arquivar"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => handleDuplicate(chat.id, e)}
                      className="p-1 text-neutral-400 hover:text-neutral-600 rounded"
                      title="Duplicar"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(chat.id, e)}
                      className="p-1 text-neutral-400 hover:text-red-500 rounded"
                      title="Excluir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
