#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy do stack CloudFormation do CodePipeline Fase 2 (isolado da Fase 1)
# Uso: ./infra/deploy-pipeline.sh [--delete]
# ─────────────────────────────────────────────────────────────────────────────
set -e

STACK_NAME="fase2-pipeline"
TEMPLATE="infra/codepipeline-fase2.yaml"
REGION="${AWS_REGION:-us-east-1}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Delete mode ──
if [ "$1" = "--delete" ]; then
  echo -e "${YELLOW}⚠️  Deletando stack $STACK_NAME...${NC}"
  aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
  echo -e "${GREEN}✅ Stack em processo de deleção.${NC}"
  exit 0
fi

# ── Validar template ──
echo -e "${GREEN}🔍 Validando template...${NC}"
aws cloudformation validate-template \
  --template-body "file://$TEMPLATE" \
  --region "$REGION" > /dev/null

# ── Parâmetros ──
CONNECTION_ARN="${CONNECTION_ARN:-arn:aws:codeconnections:us-east-1:983004127488:connection/2031c29f-e77b-4a02-bfc6-90235e40394a}"
REPO_ID="${REPO_ID:-dataRainBR/tesouro-nacional-poc-fase2}"
BRANCH="${BRANCH:-main}"
EKS_CLUSTER="${EKS_CLUSTER:-tesouro-nacional}"
EKS_NAMESPACE="${EKS_NAMESPACE:-tesouro-fase2}"
BACKEND_ECR="${BACKEND_ECR:-fase2-backend}"
FRONTEND_ECR="${FRONTEND_ECR:-fase2-frontend}"

echo -e "${GREEN}🚀 Deploying stack: $STACK_NAME${NC}"
echo "   Region:     $REGION"
echo "   Repo:       $REPO_ID"
echo "   Branch:     $BRANCH"
echo "   EKS:        $EKS_CLUSTER / $EKS_NAMESPACE"
echo ""

aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    ConnectionArn="$CONNECTION_ARN" \
    FullRepositoryId="$REPO_ID" \
    BranchName="$BRANCH" \
    EksClusterName="$EKS_CLUSTER" \
    EksNamespace="$EKS_NAMESPACE" \
    BackendEcrRepo="$BACKEND_ECR" \
    FrontendEcrRepo="$FRONTEND_ECR" \
  --no-fail-on-empty-changeset

echo ""
echo -e "${GREEN}✅ Stack deployed com sucesso!${NC}"
echo ""

# ── Mostrar outputs ──
echo -e "${GREEN}📋 Outputs:${NC}"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

echo ""
echo -e "${YELLOW}⚠️  IMPORTANTE: Adicione a role do CodeBuild ao aws-auth ConfigMap do EKS:${NC}"
echo ""
echo "   kubectl edit configmap aws-auth -n kube-system"
echo ""
echo "   Adicione em mapRoles:"
echo "   - rolearn: arn:aws:iam::983004127488:role/fase2-codebuild-role"
echo "     username: fase2-codebuild"
echo "     groups:"
echo "       - system:masters"
echo ""
