import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import {
  getChats,
  createChat,
  deleteChat,
  getMessages,
  updateChatTitle,
  addMessage,
  duplicateChat,
  archiveChat,
  searchChats,
  deleteMessagesAfter,
} from '../../infrastructure/database/dynamodb-chats.repository.js'

export const chatsRoutes = Router()

// Todas as rotas requerem autenticação
chatsRoutes.use(authenticateToken)

// GET /api/chats - Lista todos os chats do usuário
chatsRoutes.get('/', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const includeArchived = req.query.archived === 'true'
    const chats = await getChats(req.user.id, includeArchived)
    return res.json(chats)
  } catch (error) {
    console.error('[chats] Erro ao buscar chats:', error)
    return res.status(500).json({ error: 'Erro ao buscar chats' })
  }
})

// GET /api/chats/search?q=termo - Pesquisa conversas
chatsRoutes.get('/search', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const query = (req.query.q as string || '').trim()
    if (!query) {
      return res.json([])
    }

    const results = await searchChats(req.user.id, query)
    return res.json(results)
  } catch (error) {
    console.error('[chats] Erro ao pesquisar chats:', error)
    return res.status(500).json({ error: 'Erro ao pesquisar chats' })
  }
})

// POST /api/chats - Cria um novo chat
chatsRoutes.post('/', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const chat = await createChat(req.user.id)
    return res.json(chat)
  } catch (error) {
    console.error('[chats] Erro ao criar chat:', error)
    return res.status(500).json({ error: 'Erro ao criar chat' })
  }
})

// GET /api/chats/:chatId/messages - Lista mensagens de um chat (com paginação)
chatsRoutes.get('/:chatId/messages', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const { chatId } = req.params
    const MAX_MESSAGES = 50
    const limit = Math.min(parseInt(req.query.limit as string) || MAX_MESSAGES, MAX_MESSAGES)
    const before = req.query.before as string | undefined

    const messages = await getMessages(chatId, limit, before)
    return res.json(messages)
  } catch (error) {
    console.error('[chats] Erro ao buscar mensagens:', error)
    return res.status(500).json({ error: 'Erro ao buscar mensagens' })
  }
})

// PUT /api/chats/:chatId/title - Renomear conversa
chatsRoutes.put('/:chatId/title', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const { chatId } = req.params
    const { title } = req.body

    if (!title?.trim()) {
      return res.status(400).json({ error: 'Título é obrigatório' })
    }

    await updateChatTitle(req.user.id, chatId, title.trim())
    return res.json({ success: true })
  } catch (error) {
    console.error('[chats] Erro ao renomear chat:', error)
    return res.status(500).json({ error: 'Erro ao renomear chat' })
  }
})

// PUT /api/chats/:chatId/archive - Arquivar/desarquivar conversa
chatsRoutes.put('/:chatId/archive', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const { chatId } = req.params
    const { archived } = req.body

    await archiveChat(req.user.id, chatId, archived !== false)
    return res.json({ success: true })
  } catch (error) {
    console.error('[chats] Erro ao arquivar chat:', error)
    return res.status(500).json({ error: 'Erro ao arquivar chat' })
  }
})

// POST /api/chats/:chatId/duplicate - Duplicar conversa
chatsRoutes.post('/:chatId/duplicate', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const { chatId } = req.params
    const newChat = await duplicateChat(req.user.id, chatId)
    return res.json(newChat)
  } catch (error) {
    console.error('[chats] Erro ao duplicar chat:', error)
    return res.status(500).json({ error: 'Erro ao duplicar chat' })
  }
})

// POST /api/chats/:chatId/delete-messages-after - Deleta mensagens após um timestamp
chatsRoutes.post('/:chatId/delete-messages-after', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const { chatId } = req.params
    const { afterTimestamp } = req.body

    if (!afterTimestamp) {
      return res.status(400).json({ error: 'afterTimestamp é obrigatório' })
    }

    const count = await deleteMessagesAfter(chatId, afterTimestamp)
    return res.json({ success: true, deleted: count })
  } catch (error) {
    console.error('[chats] Erro ao deletar mensagens:', error)
    return res.status(500).json({ error: 'Erro ao deletar mensagens' })
  }
})

// DELETE /api/chats/:chatId - Deleta um chat
chatsRoutes.delete('/:chatId', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const { chatId } = req.params
    await deleteChat(req.user.id, chatId)
    return res.json({ success: true })
  } catch (error) {
    console.error('[chats] Erro ao deletar chat:', error)
    return res.status(500).json({ error: 'Erro ao deletar chat' })
  }
})
