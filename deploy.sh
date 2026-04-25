#!/bin/bash
set -e

APP_DIR="/home/ec2-user/research360"
REGION="ap-southeast-2"

echo "==> Pulling secrets from SSM..."
get_param() {
  aws ssm get-parameter --name "$1" --with-decryption --query 'Parameter.Value' --output text --region $REGION
}

export POSTGRES_PASSWORD=$(get_param "/research360/POSTGRES_PASSWORD")
export S3_BUCKET=$(get_param "/research360/S3_BUCKET")
export OPENAI_API_KEY=$(get_param "/ethikslabs/openai/api-key")
export ANTHROPIC_API_KEY=$(get_param "/ethikslabs/anthropic/api-key")
export UNSTRUCTURED_API_KEY=$(get_param "/research360/UNSTRUCTURED_API_KEY" 2>/dev/null || echo "not-set")

echo "==> Syncing from S3..."
aws s3 sync s3://ethikslabs-core/deploy/research360/ $APP_DIR/ \
  --exclude ".git/*" \
  --exclude "node_modules/*" \
  --exclude "api/node_modules/*" \
  --exclude "frontend/node_modules/*" \
  --region $REGION

cd $APP_DIR
echo "==> Building and starting containers..."
docker compose -f docker-compose.prod.yml up -d --build

echo "==> Cleaning up old images..."
docker image prune -f

echo "==> Done. Status:"
docker compose -f docker-compose.prod.yml ps
