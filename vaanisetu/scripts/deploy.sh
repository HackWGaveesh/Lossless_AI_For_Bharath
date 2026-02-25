#!/bin/bash
set -e

echo "🚀 Deploying VaaniSetu to AWS..."

if [ -f ".env" ]; then
  set -a
  . .env
  set +a
fi

aws sts get-caller-identity >/dev/null 2>&1 || { echo "❌ AWS credentials not configured. Aborting." >&2; exit 1; }

echo "✅ AWS credentials verified"

cd infrastructure
npx cdk bootstrap 2>/dev/null || true
echo "📦 Deploying infrastructure..."
npx cdk deploy --all --require-approval never

echo "✅ Deployment complete!"
echo "🎉 VaaniSetu is deployed. Check CloudFormation outputs for API and Frontend URLs."
