import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  GetUserCommand,
  GlobalSignOutCommand,
  ResendConfirmationCodeCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'
import { createHmac } from 'crypto'

// ---------------------------------------------------------------------------
// Singleton: Cognito client
// ---------------------------------------------------------------------------
let cognitoClient: CognitoIdentityProviderClient | null = null

export function getCognitoClient(): CognitoIdentityProviderClient {
  if (!cognitoClient) {
    const region = process.env.AWS_REGION || 'us-east-1'
    const credentials =
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined

    cognitoClient = new CognitoIdentityProviderClient({ region, credentials })
  }
  return cognitoClient
}

// ---------------------------------------------------------------------------
// SECRET_HASH — necessário quando o App Client possui client secret
// Fórmula: HMAC-SHA256(CLIENT_SECRET, USERNAME + CLIENT_ID)
// ---------------------------------------------------------------------------
function calculateSecretHash(
  username: string,
  clientId: string,
  clientSecret: string
): string {
  return createHmac('sha256', clientSecret)
    .update(username + clientId)
    .digest('base64')
}

function getSecretHash(username: string): string | undefined {
  const clientId = process.env.COGNITO_CLIENT_ID!
  const clientSecret = process.env.COGNITO_CLIENT_SECRET
  return clientSecret ? calculateSecretHash(username, clientId, clientSecret) : undefined
}

// ---------------------------------------------------------------------------
// Singleton: JWKS client (validação local de JWT — sem chamada à API a cada request)
// ---------------------------------------------------------------------------
let jwksClientInstance: ReturnType<typeof jwksClient> | null = null

function getJwksClient(): ReturnType<typeof jwksClient> {
  if (jwksClientInstance) return jwksClientInstance

  const region = process.env.AWS_REGION || 'us-east-1'
  const userPoolId = process.env.COGNITO_USER_POOL_ID
  if (!userPoolId) throw new Error('COGNITO_USER_POOL_ID não configurado')

  jwksClientInstance = jwksClient({
    jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
    cache: true,
    cacheMaxAge: 3_600_000, // 1 hora (Cognito raramente rotaciona chaves)
    rateLimit: true,
    jwksRequestsPerMinute: 10,
    timeout: 10_000,
  })

  return jwksClientInstance
}

function getSigningKey(header: any, callback: (err: any, key?: string) => void) {
  try {
    if (!header?.kid) {
      return callback(new Error('kid ausente no header do token'))
    }
    getJwksClient().getSigningKey(header.kid, (err, key) => {
      if (err || !key) return callback(err ?? new Error('Chave não encontrada'))
      callback(null, key.getPublicKey())
    })
  } catch (err) {
    callback(err)
  }
}

// ---------------------------------------------------------------------------
// verifyToken: valida assinatura, issuer, expiração e token_use
// Use esta função no middleware — é LOCAL (sem chamada ao Cognito)
// ---------------------------------------------------------------------------
export async function verifyToken(token: string): Promise<any> {
  const region = process.env.AWS_REGION || 'us-east-1'
  const userPoolId = process.env.COGNITO_USER_POOL_ID
  if (!userPoolId) throw new Error('COGNITO_USER_POOL_ID não configurado')

  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey as any,
      { algorithms: ['RS256'], issuer },
      (err, decoded: any) => {
        if (err) return reject(err)

        // Garantir que é um access token, não um id token
        if (decoded?.token_use !== 'access') {
          return reject(new Error('Token inválido: esperado access token'))
        }

        resolve(decoded)
      }
    )
  })
}

// ---------------------------------------------------------------------------
// signUp
// ---------------------------------------------------------------------------
export async function signUp(
  email: string,
  password: string,
  firstName: string,
  lastName: string
) {
  const client = getCognitoClient()
  const clientId = process.env.COGNITO_CLIENT_ID
  if (!clientId) throw new Error('COGNITO_CLIENT_ID não configurado')

  const givenName = firstName.trim()
  const familyName = lastName.trim()
  const fullName = `${givenName} ${familyName}`.trim()

  const command = new SignUpCommand({
    ClientId: clientId,
    Username: email,
    Password: password,
    SecretHash: getSecretHash(email),
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'name', Value: fullName },
      { Name: 'given_name', Value: givenName },
      { Name: 'family_name', Value: familyName },
    ],
  })

  const response = await client.send(command)
  return {
    userSub: response.UserSub,
    codeDeliveryDetails: response.CodeDeliveryDetails,
  }
}

// ---------------------------------------------------------------------------
// confirmSignUp
// ---------------------------------------------------------------------------
export async function confirmSignUp(email: string, code: string) {
  const client = getCognitoClient()
  const clientId = process.env.COGNITO_CLIENT_ID
  if (!clientId) throw new Error('COGNITO_CLIENT_ID não configurado')

  await client.send(
    new ConfirmSignUpCommand({
      ClientId: clientId,
      Username: email,
      ConfirmationCode: code,
      SecretHash: getSecretHash(email),
    })
  )
  return { success: true }
}

// ---------------------------------------------------------------------------
// resendConfirmationCode
// ---------------------------------------------------------------------------
export async function resendConfirmationCode(email: string) {
  const client = getCognitoClient()
  const clientId = process.env.COGNITO_CLIENT_ID
  if (!clientId) throw new Error('COGNITO_CLIENT_ID não configurado')

  await client.send(
    new ResendConfirmationCodeCommand({
      ClientId: clientId,
      Username: email,
      SecretHash: getSecretHash(email),
    })
  )
  return { success: true }
}

// ---------------------------------------------------------------------------
// signIn — usa USER_PASSWORD_AUTH (requer ALLOW_USER_PASSWORD_AUTH no App Client)
// ---------------------------------------------------------------------------
export async function signIn(usernameOrEmail: string, password: string) {
  const client = getCognitoClient()
  const clientId = process.env.COGNITO_CLIENT_ID
  if (!clientId) throw new Error('COGNITO_CLIENT_ID não configurado')

  const authParameters: Record<string, string> = {
    USERNAME: usernameOrEmail,
    PASSWORD: password,
  }

  const secretHash = getSecretHash(usernameOrEmail)
  if (secretHash) authParameters.SECRET_HASH = secretHash

  let response
  try {
    response = await client.send(
      new InitiateAuthCommand({
        ClientId: clientId,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: authParameters,
      })
    )
  } catch (error: any) {
    if (
      error.message?.includes('USER_PASSWORD_AUTH flow not enabled') ||
      error.message?.includes('flow not enabled for this client')
    ) {
      throw new Error(
        'Fluxo USER_PASSWORD_AUTH não habilitado no App Client. ' +
          'Habilite ALLOW_USER_PASSWORD_AUTH nas configurações do App Client no console AWS Cognito.'
      )
    }
    throw error
  }

  // Challenge: NEW_PASSWORD_REQUIRED (usuário criado pelo admin, primeiro login)
  if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    return {
      challenge: 'NEW_PASSWORD_REQUIRED' as const,
      session: response.Session!,
      userAttributes: response.ChallengeParameters?.userAttributes
        ? JSON.parse(response.ChallengeParameters.userAttributes)
        : {},
    }
  }

  if (!response.AuthenticationResult) {
    throw new Error('Falha na autenticação: nenhum resultado retornado')
  }

  return {
    accessToken: response.AuthenticationResult.AccessToken!,
    idToken: response.AuthenticationResult.IdToken!,
    refreshToken: response.AuthenticationResult.RefreshToken!,
    expiresIn: response.AuthenticationResult.ExpiresIn ?? 3600,
  }
}

// ---------------------------------------------------------------------------
// respondToNewPasswordChallenge — completa o challenge NEW_PASSWORD_REQUIRED
// ---------------------------------------------------------------------------
export async function respondToNewPasswordChallenge(
  username: string,
  newPassword: string,
  session: string
) {
  const client = getCognitoClient()
  const clientId = process.env.COGNITO_CLIENT_ID
  if (!clientId) throw new Error('COGNITO_CLIENT_ID não configurado')

  const challengeResponses: Record<string, string> = {
    USERNAME: username,
    NEW_PASSWORD: newPassword,
  }

  const secretHash = getSecretHash(username)
  if (secretHash) challengeResponses.SECRET_HASH = secretHash

  const response = await client.send(
    new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: session,
      ChallengeResponses: challengeResponses,
    })
  )

  if (!response.AuthenticationResult) {
    throw new Error('Falha ao definir nova senha: nenhum resultado retornado')
  }

  return {
    accessToken: response.AuthenticationResult.AccessToken!,
    idToken: response.AuthenticationResult.IdToken!,
    refreshToken: response.AuthenticationResult.RefreshToken!,
    expiresIn: response.AuthenticationResult.ExpiresIn ?? 3600,
  }
}

// ---------------------------------------------------------------------------
// getUser — obtém atributos do usuário via access token
// ---------------------------------------------------------------------------
export async function getUser(accessToken: string) {
  const client = getCognitoClient()

  const response = await client.send(
    new GetUserCommand({ AccessToken: accessToken })
  )

  const attrs: Record<string, string> = {}
  response.UserAttributes?.forEach((attr) => {
    if (attr.Name && attr.Value !== undefined) {
      attrs[attr.Name] = attr.Value
    }
  })

  return {
    username: response.Username || '',
    email: attrs.email || '',
    name: attrs.name || `${attrs.given_name || ''} ${attrs.family_name || ''}`.trim() || response.Username || '',
    sub: attrs.sub || response.Username || '',
    attributes: attrs,
  }
}

// ---------------------------------------------------------------------------
// forgotPassword
// ---------------------------------------------------------------------------
export async function forgotPassword(email: string) {
  const client = getCognitoClient()
  const clientId = process.env.COGNITO_CLIENT_ID
  if (!clientId) throw new Error('COGNITO_CLIENT_ID não configurado')

  const response = await client.send(
    new ForgotPasswordCommand({
      ClientId: clientId,
      Username: email,
      SecretHash: getSecretHash(email),
    })
  )

  return { success: true, codeDeliveryDetails: response.CodeDeliveryDetails }
}

// ---------------------------------------------------------------------------
// confirmForgotPassword
// ---------------------------------------------------------------------------
export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
) {
  const client = getCognitoClient()
  const clientId = process.env.COGNITO_CLIENT_ID
  if (!clientId) throw new Error('COGNITO_CLIENT_ID não configurado')

  await client.send(
    new ConfirmForgotPasswordCommand({
      ClientId: clientId,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
      SecretHash: getSecretHash(email),
    })
  )
  return { success: true }
}

// ---------------------------------------------------------------------------
// refreshToken — renova accessToken e idToken usando o refreshToken
// IMPORTANTE: username é OBRIGATÓRIO quando o App Client tem client secret
// ---------------------------------------------------------------------------
export async function refreshToken(refreshTokenValue: string, username: string) {
  const client = getCognitoClient()
  const clientId = process.env.COGNITO_CLIENT_ID
  const clientSecret = process.env.COGNITO_CLIENT_SECRET
  if (!clientId) throw new Error('COGNITO_CLIENT_ID não configurado')

  const authParameters: Record<string, string> = {
    REFRESH_TOKEN: refreshTokenValue,
  }

  if (clientSecret) {
    if (!username) {
      throw new Error('Username obrigatório para calcular SECRET_HASH com client secret configurado')
    }
    authParameters.SECRET_HASH = calculateSecretHash(username, clientId, clientSecret)
  }

  const response = await client.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: authParameters,
    })
  )

  if (!response.AuthenticationResult) {
    throw new Error('Falha ao renovar tokens: nenhum resultado retornado')
  }

  return {
    accessToken: response.AuthenticationResult.AccessToken!,
    idToken: response.AuthenticationResult.IdToken!,
    expiresIn: response.AuthenticationResult.ExpiresIn ?? 3600,
    // refreshToken não é retornado no refresh flow — mantém o existente
  }
}

// ---------------------------------------------------------------------------
// signOut — invalida TODOS os tokens do usuário no Cognito (global sign-out)
// ---------------------------------------------------------------------------
export async function signOut(accessToken: string) {
  const client = getCognitoClient()
  await client.send(new GlobalSignOutCommand({ AccessToken: accessToken }))
  return { success: true }
}
