# Contexto para o Chat do Projeto Fase 2 (tesouro-nacional-poc-fase2)

Copie e cole este documento como primeira mensagem no chat do novo projeto para dar contexto completo.

---

## Histórico

Este projeto é a **Fase 2** do Assistente Digital Fiscal do Tesouro Nacional, evoluído a partir do repositório `dataRainBR/tesouro-nacional-poc` (Fase 1, em produção).

### Origem do código

O código base foi copiado da Fase 1 via script `setup-fase2.ps1`, incluindo:
- Autenticação Cognito (com fix do challenge NEW_PASSWORD_REQUIRED)
- Chat com Bedrock Agents (backend + frontend)
- Sistema de trace/transparência (TracePanel) — mostra o raciocínio do agente
- Rate limiting e detecção de abuso (burst, limite diário, padrão de extração)
- Exportação CSV limitada, paginação forçada no histórico

### Layout Parecerista/Comparativo

O commit `355689e` (branch `feat/modo-parecerista` da Fase 1) criou um protótipo visual **isolado, nunca mesclado na Fase 1**, especificamente para servir de base à Fase 2. Esse commit implementou no `ChatInterface.tsx`:

1. **Toggle de modo**: Comum ↔ Parecerista (botões no header)
2. **Modo Comparação**: side-by-side, envia a mesma pergunta para 2 agentes simultaneamente (Comum vs Parecerista/Fine-Tuning) e mostra as respostas em painéis paralelos
3. **Agentes fine-tuning de exemplo**: filtra agentes cujo nome contém "FINE-TUNING" ou "Parecerista" para aparecer só no modo Parecerista
4. **Upload de documentos** (visual, ainda sem backend): botão de anexo no modo Parecerista

O arquivo mesclado (layout Parecerista/Comparativo + atualizações da Fase 1: disclaimer, exemplos contextualizados, limite de 2000 caracteres) está em `docs/ChatInterface-fase2-merged.tsx` no repo da Fase 1 — deve ser usado como o `ChatInterface.tsx` definitivo da Fase 2.

---

## O que já está pronto no scaffold

```
tesouro-nacional-poc-fase2/
├── packages/shared/          — tipos (Message, Chat, TraceStep, etc.)
├── backend/src/
│   ├── infrastructure/
│   │   ├── aws/               — cognito-auth, bedrock, secrets-manager
│   │   ├── database/          — dynamodb (chats, agents)
│   │   ├── abuse-detection.ts — limite diário + anti-scraping
│   │   └── logger.ts
│   └── presentation/
│       ├── controllers/       — auth, chat, chats, agents, messages
│       └── middleware/auth.ts
├── frontend/src/
│   ├── features/chat/components/ — ChatInterface, ChatHistory, MessageBubble, TracePanel
│   ├── shared/services/          — api.ts, auth.ts
│   ├── shared/contexts/           — AuthContext
│   └── pages/LoginPage.tsx
└── (diretórios vazios para implementar: parecerista/, comparativo/, fine-tuning/)
```

## O que falta implementar (roadmap completo em docs/FASE2-ROADMAP.md)

1. **Substituir `ChatInterface.tsx`** pelo arquivo mesclado (`docs/ChatInterface-fase2-merged.tsx`)
2. **Backend do modo Parecerista**: endpoints para anotações, aprovação/reprovação de respostas, tabela `fase2-pareceres`
3. **Backend do modo Comparativo**: invocação paralela de múltiplos agentes, votação, tabela `fase2-comparacoes`
4. **Integração fine-tuning real**: substituir agentes de exemplo por Custom Models reais do Bedrock
5. **Upload de documentos**: backend para processar PDF/DOCX anexados no modo Parecerista
6. **Segurança avançada**: fingerprint, CAPTCHA condicional, WAF

## Convenções e padrões (herdados da Fase 1)

- Monorepo com npm workspaces (backend, frontend, packages/shared)
- TypeScript strict
- DynamoDB pay-per-request, prefixo de tabelas configurável via env
- Bedrock Agents com `enableTrace: true` — trace sempre capturado e persistido
- Rate limiting em todas rotas sensíveis (`express-rate-limit`)
- Componentes React funcionais, TailwindCSS, lucide-react para ícones
- Mensagens de erro e UI em português (pt-BR)
- Disclaimer fixo em todas telas de chat: "As respostas podem conter erros, a STN não se responsabiliza nem as endossa como oficiais. Sempre confira com fontes originais."

## Arquivos de referência trazidos da Fase 1

- `docs/ChatInterface-fase2-merged.tsx` — componente principal mesclado, pronto para usar
- `docs/FASE2-ROADMAP.md` — roadmap detalhado com estimativas de horas por etapa
