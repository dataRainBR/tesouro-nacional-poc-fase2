# Tesouro Nacional - Fase 2

Assistente Digital Fiscal com modos **Parecerista** e **Comparativo**, incluindo integração com modelos fine-tuned.

## Arquitetura

```
├── packages/shared/          → Tipos e interfaces compartilhados
├── backend/                  → API Express + Bedrock + DynamoDB
│   ├── infrastructure/
│   │   ├── aws/              → Cognito, Bedrock, Secrets Manager
│   │   ├── database/         → DynamoDB repositories
│   │   └── fine-tuning/      → Integração com modelos custom
│   └── presentation/
│       └── controllers/      → REST endpoints
├── frontend/                 → React + Vite + TailwindCSS
│   └── features/
│       ├── chat/             → Chat base (reutilizado da Fase 1)
│       ├── parecerista/      → Modo Parecerista (análise detalhada)
│       └── comparativo/      → Modo Comparativo (A/B entre agentes)
└── infra/                    → IaC (CDK/Terraform)
```

## Modos de operação

### Modo Parecerista
- Visualização detalhada do trace do agente
- Anotações e aprovação/reprovação de respostas
- Auditoria completa do raciocínio

### Modo Comparativo
- Mesma pergunta enviada a N agentes (base + fine-tuned)
- Respostas lado a lado
- Avaliação de qualidade A/B
- Métricas de acurácia por agente

## Stack

- **Backend:** Node.js, Express, TypeScript
- **Frontend:** React, Vite, TailwindCSS, shadcn/ui
- **AWS:** Bedrock (Agents + Custom Models), DynamoDB, Cognito, S3, CloudWatch
- **Deploy:** CodePipeline, ECS Fargate, CloudFront

## Setup local

```bash
npm install
npm run dev
```

## Variáveis de ambiente

Copiar `backend/.env.example` para `backend/.env` e preencher com credenciais AWS.
