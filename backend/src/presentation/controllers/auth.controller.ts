import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import {
  signUp,
  confirmSignUp,
  resendConfirmationCode,
  signIn,
  respondToNewPasswordChallenge,
  getUser,
  forgotPassword,
  confirmForgotPassword,
  signOut,
  verifyToken,
  refreshToken,
} from '../../infrastructure/aws/cognito-auth.service.js'

export const authRoutes = Router()

// ---------------------------------------------------------------------------
// Schemas de validação (Zod)
// ---------------------------------------------------------------------------
const signUpSchema = z.object({
  email: z.string().email('Email inválido').max(254),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres').max(256),
  firstName: z.string().min(1).max(100).transform((s) => s.trim()),
  lastName: z.string().min(1).max(100).transform((s) => s.trim()),
})

const confirmSchema = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/, 'Código deve ter 6 dígitos'),
})

const resendSchema = z.object({
  email: z.string().email().max(254),
})

const signInSchema = z
  .object({
    email: z.string().max(254).optional(),
    username: z.string().max(254).optional(),
    password: z.string().min(1).max(256),
  })
  .refine((d) => d.email || d.username, {
    message: 'Email ou username são obrigatórios',
  })

const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
})

const resetPasswordSchema = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/, 'Código deve ter 6 dígitos'),
  newPassword: z.string().min(8).max(256),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  username: z.string().min(1).max(254),
})

// ---------------------------------------------------------------------------
// Helper para validar body e retornar erro formatado
// ---------------------------------------------------------------------------
function validate<T>(schema: z.ZodSchema<T>, body: unknown): { data: T } | { error: string } {
  const result = schema.safeParse(body)
  if (!result.success) {
    // Zod v4 usa .issues; v3 usa .errors — suporte a ambos
    const issues = (result.error as any).issues ?? (result.error as any).errors ?? []
    const first = issues[0]
    return { error: first?.message || 'Dados inválidos' }
  }
  return { data: result.data }
}

// ---------------------------------------------------------------------------
// POST /api/auth/signup
// ---------------------------------------------------------------------------
authRoutes.post('/signup', async (req, res) => {
  const parsed = validate(signUpSchema, req.body)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })

  try {
    const { email, password, firstName, lastName } = parsed.data
    const result = await signUp(email, password, firstName, lastName)

    return res.json({
      success: true,
      userSub: result.userSub,
      message: 'Conta criada com sucesso. Verifique seu email para confirmar a conta.',
    })
  } catch (error: any) {
    console.error('[auth] signup error:', error.name)
    // Não revelar se o email já existe — usar mensagem genérica
    if (
      error.name === 'UsernameExistsException' ||
      error.name === 'AliasExistsException'
    ) {
      // Retorna sucesso falso para evitar enumeração de contas
      return res.json({
        success: true,
        message: 'Se este email não estiver cadastrado, você receberá um código de confirmação.',
      })
    }
    if (error.name === 'InvalidPasswordException') {
      return res.status(400).json({
        error: 'A senha não atende aos requisitos: mínimo 8 caracteres, letras maiúsculas, minúsculas, números e símbolos.',
      })
    }
    return res.status(400).json({ error: 'Erro ao criar conta. Tente novamente.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/auth/confirm
// ---------------------------------------------------------------------------
authRoutes.post('/confirm', async (req, res) => {
  const parsed = validate(confirmSchema, req.body)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })

  try {
    await confirmSignUp(parsed.data.email, parsed.data.code)
    return res.json({ success: true, message: 'Conta confirmada com sucesso.' })
  } catch (error: any) {
    console.error('[auth] confirm error:', error.name)

    if (error.name === 'CodeMismatchException') {
      return res.status(400).json({ error: 'Código inválido. Verifique o código enviado para seu email.' })
    }
    if (error.name === 'ExpiredCodeException') {
      return res.status(400).json({ error: 'Código expirado. Solicite um novo código.' })
    }
    if (error.name === 'NotAuthorizedException') {
      return res.status(400).json({ error: 'Esta conta já foi confirmada.' })
    }
    // NÃO expor UserNotFoundException para evitar enumeração
    return res.status(400).json({ error: 'Não foi possível confirmar a conta. Tente novamente.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/auth/resend-code
// ---------------------------------------------------------------------------
authRoutes.post('/resend-code', async (req, res) => {
  const parsed = validate(resendSchema, req.body)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })

  try {
    await resendConfirmationCode(parsed.data.email)
    return res.json({ success: true, message: 'Código reenviado com sucesso.' })
  } catch (error: any) {
    console.error('[auth] resend-code error:', error.name)

    if (error.name === 'LimitExceededException') {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' })
    }
    // Resposta genérica para evitar enumeração
    return res.json({ success: true, message: 'Se a conta existir e não estiver confirmada, o código será reenviado.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/auth/signin
// ---------------------------------------------------------------------------
authRoutes.post('/signin', async (req, res) => {
  const parsed = validate(signInSchema, req.body)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })

  const { email, username, password } = parsed.data
  const identifier = email || username!

  try {
    const result = await signIn(identifier, password)

    // Challenge: usuário precisa definir nova senha (criado pelo admin)
    if ('challenge' in result) {
      return res.status(200).json({
        challenge: result.challenge,
        session: result.session,
        message: 'É necessário definir uma nova senha.',
      })
    }

    const tokens = result
    const user = await getUser(tokens.accessToken)

    // Extrair role a partir dos grupos no access token (claim seguro, assinado pelo Cognito)
    let role: 'admin' | 'user' = 'user'
    try {
      const decoded: any = jwt.decode(tokens.accessToken)
      const groups: string[] = decoded?.['cognito:groups'] || []
      if (groups.includes('admin') && !groups.includes('user')) {
        role = 'admin'
      }
    } catch {
      // mantém role = 'user'
    }

    return res.json({
      success: true,
      tokens: {
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
      user: {
        id: user.sub,
        email: user.email,
        name: user.name,
        role,
      },
    })
  } catch (error: any) {
    console.error('[auth] signin error:', error.name)

    // Mesma mensagem para usuário inexistente E senha errada (evita enumeração)
    if (
      error.name === 'UserNotFoundException' ||
      error.name === 'NotAuthorizedException' ||
      error.message?.includes('Incorrect username or password') ||
      error.message?.includes('User does not exist')
    ) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' })
    }
    if (error.name === 'UserNotConfirmedException') {
      return res.status(401).json({
        error: 'Conta não confirmada. Verifique seu email.',
        code: 'USER_NOT_CONFIRMED',
      })
    }
    if (error.name === 'PasswordResetRequiredException') {
      return res.status(401).json({
        error: 'Redefinição de senha necessária. Use "Esqueceu sua senha?".',
        code: 'PASSWORD_RESET_REQUIRED',
      })
    }
    if (error.name === 'TooManyRequestsException') {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' })
    }

    return res.status(401).json({ error: 'Falha na autenticação. Tente novamente.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/auth/new-password — completa challenge NEW_PASSWORD_REQUIRED
// ---------------------------------------------------------------------------
const newPasswordSchema = z.object({
  username: z.string().min(1).max(254),
  newPassword: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres').max(256),
  session: z.string().min(1),
})

authRoutes.post('/new-password', async (req, res) => {
  const parsed = validate(newPasswordSchema, req.body)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })

  const { username, newPassword, session } = parsed.data

  try {
    const tokens = await respondToNewPasswordChallenge(username, newPassword, session)
    const user = await getUser(tokens.accessToken)

    let role: 'admin' | 'user' = 'user'
    try {
      const decoded: any = jwt.decode(tokens.accessToken)
      const groups: string[] = decoded?.['cognito:groups'] || []
      if (groups.includes('admin') && !groups.includes('user')) {
        role = 'admin'
      }
    } catch {
      // mantém role = 'user'
    }

    return res.json({
      success: true,
      tokens: {
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
      user: {
        id: user.sub,
        email: user.email,
        name: user.name,
        role,
      },
    })
  } catch (error: any) {
    console.error('[auth] new-password error:', error.name, error.message)

    if (error.name === 'InvalidPasswordException') {
      return res.status(400).json({
        error: 'A senha não atende aos requisitos: mínimo 8 caracteres, letras maiúsculas, minúsculas, números e símbolos.',
      })
    }
    if (error.name === 'NotAuthorizedException') {
      return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' })
    }
    return res.status(400).json({ error: 'Erro ao definir nova senha. Tente novamente.' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
authRoutes.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' })
  }

  const token = authHeader.substring(7)

  try {
    // Valida token localmente via JWKS
    const decoded = await verifyToken(token)

    const user = await getUser(token)
    const groups: string[] = decoded['cognito:groups'] || []
    const role: 'admin' | 'user' =
      groups.includes('admin') && !groups.includes('user') ? 'admin' : 'user'

    return res.json({
      id: user.sub,
      email: user.email,
      name: user.name,
      role,
    })
  } catch (error: any) {
    console.error('[auth] /me error:', error.name)
    return res.status(401).json({ error: 'Token inválido ou expirado.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password
// ---------------------------------------------------------------------------
authRoutes.post('/forgot-password', async (req, res) => {
  const parsed = validate(forgotPasswordSchema, req.body)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })

  try {
    await forgotPassword(parsed.data.email)
    // Sempre retorna sucesso — não revela se o email existe ou não
    return res.json({
      success: true,
      message: 'Se o email estiver cadastrado, você receberá o código em breve.',
    })
  } catch (error: any) {
    console.error('[auth] forgot-password error:', error.name)

    if (error.name === 'LimitExceededException') {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' })
    }
    if (error.name === 'NotAuthorizedException') {
      // Conta não confirmada ou usuário desabilitado — mensagem genérica
      return res.json({
        success: true,
        message: 'Se o email estiver cadastrado, você receberá o código em breve.',
      })
    }
    // Para qualquer outro erro, incluindo UserNotFoundException, resposta genérica
    return res.json({
      success: true,
      message: 'Se o email estiver cadastrado, você receberá o código em breve.',
    })
  }
})

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password
// ---------------------------------------------------------------------------
authRoutes.post('/reset-password', async (req, res) => {
  const parsed = validate(resetPasswordSchema, req.body)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })

  const { email, code, newPassword } = parsed.data

  try {
    await confirmForgotPassword(email, code, newPassword)
    return res.json({ success: true, message: 'Senha redefinida com sucesso.' })
  } catch (error: any) {
    console.error('[auth] reset-password error:', error.name)

    if (error.name === 'CodeMismatchException') {
      return res.status(400).json({ error: 'Código inválido. Verifique o código enviado para seu email.' })
    }
    if (error.name === 'ExpiredCodeException') {
      return res.status(400).json({ error: 'Código expirado. Solicite um novo código.' })
    }
    if (error.name === 'InvalidPasswordException') {
      return res.status(400).json({
        error: 'A senha não atende aos requisitos: mínimo 8 caracteres, letras maiúsculas, minúsculas, números e símbolos.',
      })
    }
    if (error.name === 'LimitExceededException') {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' })
    }

    return res.status(400).json({ error: 'Não foi possível redefinir a senha. Tente novamente.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------
authRoutes.post('/refresh', async (req, res) => {
  const parsed = validate(refreshSchema, req.body)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })

  const { refreshToken: refreshTokenValue, username } = parsed.data

  try {
    const tokens = await refreshToken(refreshTokenValue, username)
    return res.json({
      success: true,
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      expiresIn: tokens.expiresIn,
    })
  } catch (error: any) {
    console.error('[auth] refresh error:', error.name)
    return res.status(401).json({ error: 'Refresh token inválido ou expirado. Faça login novamente.' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/auth/signout
// ---------------------------------------------------------------------------
authRoutes.post('/signout', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    // Sem token ainda é "ok" do ponto de vista do cliente — sessão já está limpa
    return res.json({ success: true, message: 'Logout realizado.' })
  }

  const token = authHeader.substring(7)

  try {
    await signOut(token)
    return res.json({ success: true, message: 'Logout realizado com sucesso.' })
  } catch (error: any) {
    console.error('[auth] signout error:', error.name)
    // Mesmo com erro no Cognito (ex: token expirado), consideramos logout bem-sucedido
    // O cliente já deve ter limpado o storage local
    return res.json({ success: true, message: 'Logout realizado.' })
  }
})
