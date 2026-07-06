FROM public.ecr.aws/docker/library/node:20-slim AS builder

WORKDIR /app

# Copy root workspace files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY frontend/package*.json ./frontend/

# Install only the workspaces needed for the frontend build
RUN npm ci --workspace=packages/shared --workspace=frontend --include-workspace-root

# Build shared package
WORKDIR /app/packages/shared
RUN npx tsc

# Build frontend (VITE_API_URL empty = relative URLs via nginx proxy)
WORKDIR /app/frontend
COPY frontend/ .
RUN VITE_API_URL="" npm run build

# Production image - nginx
FROM public.ecr.aws/docker/library/nginx:1.27-alpine

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
