# Dockerfile para AWS Bedrock AgentCore Runtime
# Plataforma: ARM64 (Graviton)

FROM --platform=linux/arm64 node:20-slim

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./
COPY tsconfig.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código fonte
COPY src ./src

# Compilar TypeScript
RUN npm install -g typescript
RUN tsc

# Expor porta do AgentCore
EXPOSE 8080

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV AGENTCORE_PORT=8080

# Comando de inicialização
CMD ["node", "dist/agentcore-server.js"]
