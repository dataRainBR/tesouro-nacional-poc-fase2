/**
 * Cognito Admin Service — Gerenciamento Administrativo de Usuários
 *
 * Operações que exigem permissões administrativas no AWS Cognito.
 */

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminGetUserCommand,
  AdminResetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { randomInt } from 'crypto'
import { getCognitoClient } from './cognito-auth.service.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserPoolId(): string {
  const id = process.env.COGNITO_USER_POOL_ID
  if (!id) throw new Error('COGNITO_USER_POOL_ID não configurado')
  return id
}

// ---------------------------------------------------------------------------
// Lógica canônica de role — usada em todos os lugares
//
// Regra: se o usuário está no grupo "admin" E NÃO no grupo "user" → é admin.
// Grupos aceitos para admin: 'admin' (case-insensitive)
// Se estiver em ambos, o grupo "user" tem prioridade.
// ---------------------------------------------------------------------------
function resolveRoleFromGroups(groupNames: string[]): 'admin' | 'user' {
  const lower = groupNames.map((g) => g.toLowerCase())
  const isAdmin = lower.includes('admin')
  const isUser = lower.includes('user')

  if (isAdmin && !isUser) return 'admin'
  return 'user'
}

// ---------------------------------------------------------------------------
// generateTemporaryPassword — usa crypto.randomInt (CSPRNG)
// ---------------------------------------------------------------------------
export function generateTemporaryPassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const digits = '0123456789'
  const special = '!@#$%^&*'
  const all = upper + lower + digits + special

  // Garante ao menos 1 de cada categoria
  const chars: string[] = [
    upper[randomInt(upper.length)],
    lower[randomInt(lower.length)],
    digits[randomInt(digits.length)],
    special[randomInt(special.length)],
    ...Array.from({ length: 8 }, () => all[randomInt(all.length)]),
  ]

  // Fisher-Yates shuffle com randomInt
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join('')
}

// ---------------------------------------------------------------------------
// isUserInAdminGroup — verifica role via API (use apenas quando necessário)
// Prefira usar o claim cognito:groups do JWT quando disponível
// ---------------------------------------------------------------------------
export async function isUserInAdminGroup(username: string): Promise<boolean> {
  const client = getCognitoClient()
  const groupsResponse = await client.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: getUserPoolId(),
      Username: username,
    })
  )
  const groupNames = groupsResponse.Groups?.map((g) => g.GroupName || '') || []
  return resolveRoleFromGroups(groupNames) === 'admin'
}

// ---------------------------------------------------------------------------
// getUserGroups — retorna grupos e role do usuário
// ---------------------------------------------------------------------------
export async function getUserGroups(username: string) {
  const client = getCognitoClient()
  const response = await client.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: getUserPoolId(),
      Username: username,
    })
  )
  const groups = response.Groups?.map((g) => g.GroupName || '') || []
  const role = resolveRoleFromGroups(groups)
  return { isAdmin: role === 'admin', groups, role }
}

// ---------------------------------------------------------------------------
// addUserToAdminGroup / addUserToUserGroup / removeUserFromGroup
// ---------------------------------------------------------------------------
export async function addUserToAdminGroup(username: string): Promise<void> {
  const client = getCognitoClient()
  await client.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: getUserPoolId(),
      Username: username,
      GroupName: 'admin',
    })
  )
}

export async function addUserToUserGroup(username: string): Promise<void> {
  const client = getCognitoClient()
  await client.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: getUserPoolId(),
      Username: username,
      GroupName: 'user',
    })
  )
}

export async function removeUserFromGroup(
  username: string,
  groupName: string
): Promise<void> {
  const client = getCognitoClient()
  await client.send(
    new AdminRemoveUserFromGroupCommand({
      UserPoolId: getUserPoolId(),
      Username: username,
      GroupName: groupName,
    })
  )
}

// ---------------------------------------------------------------------------
// listUsers — com paginação completa (evita o limite silencioso de 60 usuários)
// NOTA: ainda faz N+1 chamadas por usuário para grupos — aceitável em PoC
// Para produção: use ListUsersInGroup ou armazene role como custom attribute
// ---------------------------------------------------------------------------
export async function listUsers() {
  const client = getCognitoClient()
  const allCognitoUsers: any[] = []
  let paginationToken: string | undefined

  // Paginar todos os usuários
  do {
    const command = new ListUsersCommand({
      UserPoolId: getUserPoolId(),
      PaginationToken: paginationToken,
    })
    const response = await client.send(command)
    allCognitoUsers.push(...(response.Users || []))
    paginationToken = response.PaginationToken
  } while (paginationToken)

  const users = await Promise.all(
    allCognitoUsers.map(async (cognitoUser) => {
      const attrs: Record<string, string> = {}
      cognitoUser.Attributes?.forEach((a: any) => {
        if (a.Name) attrs[a.Name] = a.Value || ''
      })

      const username = cognitoUser.Username || attrs.email || ''
      const email = attrs.email || ''
      const name =
        attrs.name ||
        `${attrs.given_name || ''} ${attrs.family_name || ''}`.trim() ||
        email

      let role: 'admin' | 'user' = 'user'
      try {
        role = (await getUserGroups(username)).role
      } catch {
        // falha ao buscar grupos → assume 'user' (princípio do menor privilégio)
      }

      return {
        id: username,
        email,
        name,
        role,
        isActive: cognitoUser.Enabled ?? false,
        createdAt:
          cognitoUser.UserCreateDate?.toISOString() ?? new Date().toISOString(),
        permissions: getPermissions(role),
      }
    })
  )

  return users
}

function getPermissions(role: 'admin' | 'user'): string[] {
  if (role === 'admin') {
    return ['chat', 'analytics', 'finops', 'operators', 'feedback', 'guardrails', 'logs', 'about']
  }
  return ['chat']
}

// ---------------------------------------------------------------------------
// createUserAdmin — cria usuário via API admin (sem self-service)
// NÃO retorna a senha temporária na resposta (Cognito envia o email)
// ---------------------------------------------------------------------------
export async function createUserAdmin(
  email: string,
  firstName: string,
  lastName: string,
  role: 'admin' | 'user' = 'user'
) {
  const client = getCognitoClient()
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()

  const response = await client.send(
    new AdminCreateUserCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: fullName },
        { Name: 'given_name', Value: firstName.trim() },
        { Name: 'family_name', Value: lastName.trim() },
      ],
      TemporaryPassword: generateTemporaryPassword(),
      DesiredDeliveryMediums: ['EMAIL'],
    })
  )

  if (!response.User) {
    throw new Error('Falha ao criar usuário no Cognito: resposta vazia')
  }

  // Adicionar ao grupo correto
  try {
    if (role === 'admin') {
      await addUserToAdminGroup(email)
    } else {
      await addUserToUserGroup(email)
    }
  } catch (groupError) {
    console.error(`[cognito-admin] Usuário criado mas falha ao adicionar ao grupo "${role}":`, groupError)
    // Não lança erro — usuário foi criado. Admin pode corrigir o grupo manualmente.
  }

  return {
    user: {
      id: response.User.Username || email,
      email,
      name: fullName,
      role,
      isActive: true,
      createdAt: new Date().toISOString(),
      permissions: getPermissions(role),
      // temporaryPassword REMOVIDO intencionalmente — Cognito envia por email
    },
  }
}

// ---------------------------------------------------------------------------
// deleteUser
// ---------------------------------------------------------------------------
export async function deleteUser(email: string): Promise<void> {
  const client = getCognitoClient()
  await client.send(
    new AdminDeleteUserCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
    })
  )
}

// ---------------------------------------------------------------------------
// updateUserRole — remove de todos os grupos e adiciona ao correto
// Operação não atômica; em caso de falha parcial, loga e relança
// ---------------------------------------------------------------------------
export async function updateUserRole(
  email: string,
  role: 'admin' | 'user'
): Promise<void> {
  // Remover grupos anteriores (ignora erros "usuário não está no grupo")
  for (const group of ['admin', 'user']) {
    try {
      await removeUserFromGroup(email, group)
    } catch (err: any) {
      // ResourceNotFoundException ou similar — usuário não estava no grupo, ok
      if (!err.message?.includes('not found') && !err.name?.includes('ResourceNotFoundException')) {
        console.error(`[cognito-admin] Erro ao remover do grupo "${group}":`, err.message)
      }
    }
  }

  // Adicionar ao grupo correto
  if (role === 'admin') {
    await addUserToAdminGroup(email)
  } else {
    await addUserToUserGroup(email)
  }
}

// ---------------------------------------------------------------------------
// updateUserAttributes
// ---------------------------------------------------------------------------
export async function updateUserAttributes(
  email: string,
  attributes: { name?: string; firstName?: string; lastName?: string }
): Promise<void> {
  const client = getCognitoClient()
  const userAttributes: Array<{ Name: string; Value: string }> = []

  if (attributes.name !== undefined) {
    userAttributes.push({ Name: 'name', Value: attributes.name })
  }
  if (attributes.firstName !== undefined) {
    userAttributes.push({ Name: 'given_name', Value: attributes.firstName })
  }
  if (attributes.lastName !== undefined) {
    userAttributes.push({ Name: 'family_name', Value: attributes.lastName })
  }

  if (userAttributes.length === 0) return

  await client.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
      UserAttributes: userAttributes,
    })
  )
}

// ---------------------------------------------------------------------------
// setUserPassword
// ---------------------------------------------------------------------------
export async function setUserPassword(
  email: string,
  password: string,
  permanent = false
): Promise<void> {
  const client = getCognitoClient()
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
      Password: password,
      Permanent: permanent,
    })
  )
}

// ---------------------------------------------------------------------------
// getUserAdmin
// ---------------------------------------------------------------------------
export async function getUserAdmin(email: string) {
  const client = getCognitoClient()
  const response = await client.send(
    new AdminGetUserCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
    })
  )

  const attrs: Record<string, string> = {}
  response.UserAttributes?.forEach((a) => {
    if (a.Name) attrs[a.Name] = a.Value || ''
  })

  const { role } = await getUserGroups(email)

  return {
    id: response.Username || email,
    email: attrs.email || email,
    name:
      attrs.name ||
      `${attrs.given_name || ''} ${attrs.family_name || ''}`.trim() ||
      email,
    role,
    isActive: response.Enabled ?? false,
    createdAt: response.UserCreateDate?.toISOString() ?? new Date().toISOString(),
    permissions: getPermissions(role),
  }
}

// ---------------------------------------------------------------------------
// adminResetUserPassword — força o Cognito a enviar email de reset
// ---------------------------------------------------------------------------
export async function adminResetUserPassword(email: string) {
  const client = getCognitoClient()
  await client.send(
    new AdminResetUserPasswordCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
    })
  )
  return { success: true }
}
