# Tesouro Nacional — Fase 2: Próximas Etapas

## Visão geral

A Fase 2 expande o Assistente Digital Fiscal com dois novos modos de operação (Parecerista e Comparativo) e integração com modelos fine-tuned, permitindo avaliação de qualidade entre agentes e auditoria detalhada de respostas.

Repositório: `dataRainBR/tesouro-nacional-poc-fase2`

---

## Etapa 1 — Infraestrutura base (1 semana)

| Task | Descrição | Estimativa |
|------|-----------|-----------|
| Pipeline CI/CD | Criar CodePipeline + buildspec para o novo repo (ECS Fargate, CloudFront) | 4h |
| Configuração AWS | Novas tabelas DynamoDB (prefixo `fase2-`), variáveis de ambiente, Cognito (reutilizar ou novo pool) | 3h |
| Validação do scaffold | `npm install`, build, deploy da base copiada funcionando em ambiente de dev | 3h |
| Testes de fumaça | Login, envio de mensagem, trace — confirmar que a base funciona isolada | 2h |

---

## Etapa 2 — Modo Parecerista (2 semanas)

O modo Parecerista permite que analistas da STN auditem respostas do agente com visibilidade total do raciocínio.

| Task | Descrição | Estimativa |
|------|-----------|-----------|
| Tela de seleção de modo | Switcher no header: Chat Normal / Parecerista / Comparativo | 4h |
| Interface Parecerista | Layout dividido: resposta à esquerda, trace expandido à direita (split panel) | 8h |
| Anotações em respostas | Campo de texto + tags para o parecerista anotar observações por mensagem | 6h |
| Aprovação/Reprovação | Botões aprovar/reprovar com motivo obrigatório, persiste no DynamoDB | 4h |
| Histórico de pareceres | Listagem de respostas avaliadas com filtros (aprovadas, reprovadas, pendentes) | 6h |
| Exportação de pareceres | Exportar relatório PDF/CSV das avaliações realizadas | 4h |
| Backend: endpoints | `POST /api/pareceres`, `GET /api/pareceres`, tabela DynamoDB `fase2-pareceres` | 4h |

---

## Etapa 3 — Modo Comparativo (2 semanas)

Envia a mesma pergunta para múltiplos agentes (base + fine-tuned) e exibe respostas lado a lado para avaliação A/B.

| Task | Descrição | Estimativa |
|------|-----------|-----------|
| Backend: invocação paralela | Endpoint que invoca N agentes simultaneamente com a mesma pergunta | 6h |
| Frontend: layout side-by-side | 2-3 colunas com resposta de cada agente, identificação do modelo | 8h |
| Votação por resposta | Usuário seleciona qual resposta é melhor (ou empate), persiste resultado | 4h |
| Métricas comparativas | Dashboard com win-rate por agente, latência média, tokens consumidos | 6h |
| Trace comparativo | Trace de cada agente visível independente para análise do caminho percorrido | 4h |
| Backend: tabela de comparações | `fase2-comparacoes` no DynamoDB (pergunta, respostas, votos, métricas) | 3h |
| Configuração de agentes | UI admin para selecionar quais agentes participam do modo comparativo | 4h |

---

## Etapa 4 — Integração com modelos Fine-tuned (1-2 semanas)

| Task | Descrição | Estimativa |
|------|-----------|-----------|
| Registro de modelos custom | CRUD para cadastrar Custom Model ARNs do Bedrock ou endpoints SageMaker | 4h |
| Invocação de modelos fine-tuned | Service que invoca `InvokeModel` com modelId custom (diferente do Agent) | 6h |
| Prompt engineering | Adaptar system prompt para modelos fine-tuned (sem orquestração de agente) | 4h |
| Fallback para agente base | Se o modelo fine-tuned não responde ou erra, roteia para agente base | 3h |
| Monitoramento de custos | Dashboard com custo por modelo (tokens input/output × preço por modelo) | 4h |
| Avaliação automática | Comparar resposta fine-tuned com ground truth (dataset de avaliação existente) | 8h |

---

## Etapa 5 — Recursos avançados de segurança (1 semana)

| Task | Descrição | Estimativa |
|------|-----------|-----------|
| Fingerprint do navegador | @fingerprintjs/fingerprintjs + header X-Device-FP + rate limit por device | 4h |
| CAPTCHA condicional | reCAPTCHA v3 invisível, ativado quando flags de bot são detectadas | 6h |
| Detecção de bots avançada | Análise de velocidade de digitação + padrões sequenciais + IP reputation | 4h |
| WAF no CloudFront/ALB | Regras AWS WAF (bot detection, geo blocking, IP rate limiting) | 4h |
| Audit log | Log imutável de todas as ações do parecerista (compliance) | 3h |

---

## Etapa 6 — Polimento e entrega (1 semana)

| Task | Descrição | Estimativa |
|------|-----------|-----------|
| Testes E2E | Fluxos críticos: login → parecerista → anotar → exportar | 6h |
| Documentação | Guia de uso para pareceristas, guia admin, API docs | 4h |
| Performance | Otimizar invocações paralelas, lazy loading de traces | 3h |
| Acessibilidade | ARIA labels, contraste, navegação por teclado nos novos modos | 3h |
| Deploy produção | Configurar ambiente prod, DNS, certificados, monitoramento | 4h |

---

## Resumo de esforço estimado

| Etapa | Duração | Horas | Status |
|-------|---------|-------|--------|
| 1. Infraestrutura base | 1 semana | 12h | ✅ Concluído |
| 2. Modo Parecerista | 2 semanas | 36h | ✅ Implementado |
| 3. Modo Comparativo | 2 semanas | 35h | ✅ Implementado |
| 4. Fine-tuning | 1-2 semanas | 29h | ✅ Implementado |
| 5. Segurança avançada | 1 semana | 21h | 🔲 Pendente |
| 6. Polimento e entrega | 1 semana | 20h | 🔲 Pendente |
| **Total** | **8-9 semanas** | **~153h** | |

---

## O que foi implementado (Fase 2 — incremento sobre Fase 1)

### Backend

| Arquivo | Descrição |
|---------|-----------|
| `src/index.ts` | Entry point Express com todas as rotas e inicialização de tabelas |
| `src/infrastructure/database/pareceres.repository.ts` | CRUD DynamoDB para pareceres (`fase2-pareceres`) com GSI por status |
| `src/infrastructure/database/comparativos.repository.ts` | CRUD DynamoDB para comparações A/B (`fase2-comparacoes`) com GSI por voter |
| `src/infrastructure/aws/bedrock-agent-discovery.service.ts` | Lista agentes e aliases Bedrock disponíveis na conta |
| `src/infrastructure/aws/title-summarizer.service.ts` | Geração de títulos inteligentes para chats |
| `src/infrastructure/sisweb/sisweb-logger.service.ts` | Log de compliance SISWEB com retry |
| `src/presentation/controllers/pareceres.controller.ts` | REST: criar, listar, atualizar pareceres + stats |
| `src/presentation/controllers/comparativos.controller.ts` | REST: invocar N agentes em paralelo, votar, listar, stats |
| `src/infrastructure/database/finetuned-models.repository.ts` | CRUD DynamoDB para modelos fine-tuned (`fase2-finetuned-models`) |
| `src/infrastructure/aws/finetuned-model.service.ts` | Invocação via `InvokeModel` (Claude/Anthropic format) com fallback automático para agente base |
| `src/presentation/controllers/finetuned-models.controller.ts` | REST: CRUD de modelos + invocação com cálculo de custo estimado |

### Frontend

| Arquivo | Descrição |
|---------|-----------|
| `src/App.tsx` | Router principal com auth guard |
| `src/main.tsx` | Entry point React |
| `src/pages/HomePage.tsx` | Página principal com Mode Switcher |
| `src/shared/components/ModeSwitcher.tsx` | Alternador Chat / Parecerista / Comparativo |
| `src/features/parecerista/components/PareceristaInterface.tsx` | Interface principal do Modo Parecerista |
| `src/features/parecerista/components/ParecerForm.tsx` | Formulário de avaliação com tags e trace |
| `src/features/parecerista/components/ParecerList.tsx` | Lista de pareceres com status visual |
| `src/features/parecerista/components/ParecerStats.tsx` | Dashboard com taxa de aprovação |
| `src/features/comparativo/components/ComparativoInterface.tsx` | Interface principal do Modo Comparativo |
| `src/features/comparativo/components/ComparativoResult.tsx` | Respostas side-by-side com votação |
| `src/features/comparativo/components/ComparativoHistory.tsx` | Histórico de comparações |
| `src/features/comparativo/components/ComparativoStats.tsx` | Win-rate por agente |
| `src/pages/SettingsPage.tsx` | Página de administração (Agentes + Modelos Fine-Tuned) |
| `src/features/admin/components/AgentsAdmin.tsx` | CRUD de agentes Bedrock |
| `src/features/admin/components/FineTunedModelsAdmin.tsx` | CRUD de modelos fine-tuned + teste de conectividade + dashboard de custo |

### Shared Types (`packages/shared/src/index.ts`)

- `Parecer`, `ParecerCreateInput`, `ParecerUpdateInput`, `ParecerFilterOptions`, `ParecerStatus`
- `ComparativoVote`, `ComparativoResposta`
- `FineTunedModel`, `FineTunedModelProvider`, `FineTunedInvokeResponse`

### ChatInterface.tsx (herdado do commit 355689e da Fase 1, mesclado)

- Toggle Comum ↔ Parecerista + Modo Comparação lado a lado dentro do próprio chat
- Modo Comparação conectado a `/api/comparativos/invoke` e `/api/comparativos/:id/vote` (persistido)
- Modo Parecerista com aprovação rápida e reprovação (motivo obrigatório) via `/api/pareceres` (persistido)

---

## Dependências externas

- Modelos fine-tuned prontos no Bedrock (treinamento feito pela equipe de ML)
- Acesso ao console AWS para criar recursos (tabelas, agentes, pipelines)
- Definição dos critérios de avaliação do modo Parecerista (quais campos, taxonomia de erros)
- Dataset de ground truth para avaliação automática dos modelos

---

## Princípios técnicos (herdados da Fase 1)

- Monorepo com workspaces (backend + frontend + shared)
- TypeScript strict em todo o stack
- DynamoDB como banco principal (pay-per-request)
- Bedrock Agents para orquestração + Custom Models para fine-tuning
- Rate limiting + abuse detection em todas as rotas sensíveis
- Trace de transparência em todas as respostas
- Deploy via CodePipeline → ECS Fargate (backend) + CloudFront/S3 (frontend)
