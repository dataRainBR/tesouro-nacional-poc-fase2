#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy Fase 2 — Build Docker + Push ECR + Deploy EKS
# Uso: ./scripts/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

AWS_ACCOUNT="983004127488"
AWS_REGION="us-east-1"
CLUSTER_NAME="tesouro-nacional"
NAMESPACE="tesouro-fase2"
BACKEND_ECR="$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/fase2-backend"
FRONTEND_ECR="$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/fase2-frontend"

echo "=== 1. Login no ECR ==="
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com

echo "=== 2. Criando repositórios ECR (se não existirem) ==="
aws ecr describe-repositories --repository-names fase2-backend --region $AWS_REGION 2>/dev/null || \
  aws ecr create-repository --repository-name fase2-backend --region $AWS_REGION
aws ecr describe-repositories --repository-names fase2-frontend --region $AWS_REGION 2>/dev/null || \
  aws ecr create-repository --repository-name fase2-frontend --region $AWS_REGION

echo "=== 3. Build e push do backend ==="
docker buildx build --platform linux/amd64 -f backend/Dockerfile.prod -t $BACKEND_ECR:latest --push .

echo "=== 4. Build e push do frontend ==="
docker buildx build --platform linux/amd64 -f frontend/Dockerfile -t $FRONTEND_ECR:latest --push .

echo "=== 5. Configurando kubectl ==="
aws eks update-kubeconfig --name $CLUSTER_NAME --region $AWS_REGION

echo "=== 6. Aplicando manifestos K8s ==="
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/serviceaccount.yaml
kubectl apply -f k8s/configmap.yaml

# Criar secret se não existir (placeholder — preencher manualmente depois)
kubectl get secret fase2-secrets -n $NAMESPACE 2>/dev/null || \
  kubectl create secret generic fase2-secrets -n $NAMESPACE \
    --from-literal=SISWEB_API_TOKEN="${SISWEB_API_TOKEN:-placeholder}"

kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/backend-service.yaml
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/frontend-service.yaml
kubectl apply -f k8s/ingress.yaml

echo "=== 7. Aguardando deployments ==="
kubectl rollout status deployment/fase2-backend -n $NAMESPACE --timeout=120s
kubectl rollout status deployment/fase2-frontend -n $NAMESPACE --timeout=120s

echo "=== 8. Obtendo URL do ALB ==="
echo "Aguardando ALB ser provisionado (pode levar 2-3 min)..."
sleep 30
ALB_DNS=$(kubectl get ingress -n $NAMESPACE fase2-ingress -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "ainda provisionando")
echo ""
echo "================================================"
echo " DEPLOY FASE 2 CONCLUIDO!"
echo "================================================"
echo " URL: http://$ALB_DNS"
echo "================================================"
echo ""
echo "Se o DNS ainda nao aparecer, aguarde 2-3 min e execute:"
echo "  kubectl get ingress -n $NAMESPACE fase2-ingress"
