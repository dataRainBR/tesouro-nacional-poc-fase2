/**
 * Rotas Administrativas — Gerenciamento de Usuários
 *
 * Requerem autenticação (JWT válido) + role admin (claim cognito:groups).
 * O role é extraído do JWT pelo authenticateToken middleware — sem chamada extra ao Cognito.
 */

import { Router } from 'express'
import {
  listUsers,
  createUserAdmin,
  deleteUser,
  updateUserRole,
  updateUserAttributes,
  setUserPassword,
  getUserGroups,
  getUserAdmin,
} from '../../infrastructure/aws/cognito-admin.service.js'
import { authenticateToken } from '../middleware/auth.js'

export const adminRoutes = Router()

// Autenticação JWT em todas as rotas admin
adminRoutes.use(authenticateToken)

// Verificação de role admin — usa o claim já extraído do JWT pelo middleware
// Não faz chamada adicional ao Cognito
const requireAdmin = (req: any, res: any, next: any) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Usuário não autenticado' })
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' })
  }
  next()
}

adminRoutes.use(requireAdmin)

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------
adminRoutes.get('/users', async (req, res) => {
  try {
    const users = await listUsers()
    return res.json(users)
  } catch (error: any) {
    console.error('[admin] listUsers error:', error.message)
    return res.status(500).json({ error: 'Erro ao listar usuários.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/admin/users/:email
// ---------------------------------------------------------------------------
adminRoutes.get('/users/:email', async (req, res) => {
  try {
    const user = await getUserAdmin(req.params.email)
    return res.json(user)
  } catch (error: any) {
    console.error('[admin] getUser error:', error.message)
    if (error.name === 'UserNotFoundException') {
      return res.status(404).json({ error: 'Usuário não encontrado.' })
    }
    return res.status(500).json({ error: 'Erro ao obter usuário.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/admin/users
// ---------------------------------------------------------------------------
adminRoutes.post('/users', async (req, res) => {
  const { email, firstName, lastName, role } = req.body

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: 'Email, nome e sobrenome são obrigatórios.' })
  }

  const validRole: 'admin' | 'user' = role === 'admin' ? 'admin' : 'user'

  try {
    const result = await createUserAdmin(email, firstName, lastName, validRole)
    return res.status(201).json({
      success: true,
      user: result.user,
      message: 'Usuário criado. Email com credenciais será enviado automaticamente.',
    })
  } catch (error: any) {
    console.error('[admin] createUser error:', error.message)
    if (error.name === 'UsernameExistsException') {
      return res.status(409).json({ error: 'Já existe um usuário com este email.' })
    }
    return res.status(400).json({ error: 'Erro ao criar usuário. Tente novamente.' })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:email
// ---------------------------------------------------------------------------
adminRoutes.delete('/users/:email', async (req, res) => {
  try {
    await deleteUser(req.params.email)
    return res.json({ success: true, message: 'Usuário removido com sucesso.' })
  } catch (error: any) {
    console.error('[admin] deleteUser error:', error.message)
    if (error.name === 'UserNotFoundException') {
      return res.status(404).json({ error: 'Usuário não encontrado.' })
    }
    return res.status(500).json({ error: 'Erro ao remover usuário.' })
  }
})

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:email/role
// ---------------------------------------------------------------------------
adminRoutes.put('/users/:email/role', async (req, res) => {
  const { role } = req.body
  if (role !== 'admin' && role !== 'user') {
    return res.status(400).json({ error: 'Role deve ser "admin" ou "user".' })
  }

  try {
    await updateUserRole(req.params.email, role)
    return res.json({ success: true, message: 'Role atualizada com sucesso.' })
  } catch (error: any) {
    console.error('[admin] updateRole error:', error.message)
    return res.status(500).json({ error: 'Erro ao atualizar role.' })
  }
})

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:email/attributes
// ---------------------------------------------------------------------------
adminRoutes.put('/users/:email/attributes', async (req, res) => {
  const { name, firstName, lastName } = req.body
  if (!name && !firstName && !lastName) {
    return res.status(400).json({ error: 'Informe ao menos um atributo.' })
  }

  try {
    await updateUserAttributes(req.params.email, { name, firstName, lastName })
    return res.json({ success: true, message: 'Atributos atualizados.' })
  } catch (error: any) {
    console.error('[admin] updateAttributes error:', error.message)
    return res.status(500).json({ error: 'Erro ao atualizar atributos.' })
  }
})

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:email/password
// ---------------------------------------------------------------------------
adminRoutes.put('/users/:email/password', async (req, res) => {
  const { password, permanent } = req.body
  if (!password) {
    return res.status(400).json({ error: 'Senha é obrigatória.' })
  }

  try {
    await setUserPassword(req.params.email, password, permanent === true)
    return res.json({ success: true, message: 'Senha definida com sucesso.' })
  } catch (error: any) {
    console.error('[admin] setPassword error:', error.message)
    return res.status(500).json({ error: 'Erro ao definir senha.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/admin/users/:email/groups
// ---------------------------------------------------------------------------
adminRoutes.get('/users/:email/groups', async (req, res) => {
  try {
    const groups = await getUserGroups(req.params.email)
    return res.json(groups)
  } catch (error: any) {
    console.error('[admin] getUserGroups error:', error.message)
    return res.status(500).json({ error: 'Erro ao verificar grupos.' })
  }
})
