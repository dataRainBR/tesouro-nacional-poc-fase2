import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { updateMessageFeedback, getMessages } from '../../infrastructure/database/dynamodb-chats.repository.js'

export const messagesRoutes = Router()

// Todas as rotas requerem autenticação
messagesRoutes.use(authenticateToken)

// POST /api/messages/:messageId/feedback - Registra feedback
messagesRoutes.post('/:messageId/feedback', async (req: any, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' })
    }

    const { messageId } = req.params
    const { chatId, feedback, comment } = req.body

    if (!feedback || !['like', 'dislike'].includes(feedback)) {
      return res.status(400).json({ error: 'Feedback inválido' })
    }

    if (!chatId) {
      return res.status(400).json({ error: 'chatId é obrigatório' })
    }

    // Buscar mensagem para obter timestamp
    const messages = await getMessages(chatId)
    const message = messages.find(m => m.id === messageId)

    if (!message) {
      return res.status(404).json({ error: 'Mensagem não encontrada' })
    }

    await updateMessageFeedback(chatId, message.timestamp, feedback, comment)
    return res.json({ success: true })
  } catch (error) {
    console.error('[messages] Erro ao atualizar feedback:', error)
    return res.status(500).json({ error: 'Erro ao atualizar feedback' })
  }
})
