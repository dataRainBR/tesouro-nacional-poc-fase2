/**
 * Middleware de Autenticação
 *
 * Valida tokens JWT do Cognito LOCALMENTE via JWKS (sem chamada à API a cada request).
 * A função verifyToken() busca a chave pública do Cognito uma vez e a cacheia.
 */

import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../../infrastructure/aws/cognito-auth.service.js'

interface AuthenticatedUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  token: string
  refreshToken: string
  expiresIn: number
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser
    }
  }
}

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization
  // Suporte a token via query param para SSE (EventSource não suporta headers)
  const queryToken = (req as any).query?.token as string | undefined

  if (!authHeader?.startsWith('Bearer ') && !queryToken) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido' })
  }

  const token = queryToken || authHeader!.substring(7)

  try {
    // Validação LOCAL via JWKS — sem chamada ao Cognito (rápido e sem throttling)
    const decoded = await verifyToken(token)

    const groups: string[] = decoded['cognito:groups'] || []
    const isAdmin = groups.includes('admin') && !groups.includes('user')

    req.user = {
      id: decoded.sub,
      email: decoded.email || decoded.username || '',
      name: decoded.name || '',
      token,
      refreshToken: '',
      expiresIn: decoded.exp, // Unix timestamp (segundos)
      role: isAdmin ? 'admin' : 'user',
    }

    next()
  } catch (err: any) {
    const isExpired =
      err.name === 'TokenExpiredError' || err.message?.includes('expired')

    return res.status(401).json({
      error: isExpired
        ? 'Token expirado. Faça login novamente.'
        : 'Token inválido ou expirado.',
    })
  }
}
