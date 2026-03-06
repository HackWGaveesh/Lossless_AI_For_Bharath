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

echo "✅ CDK deployment complete!"
echo ""
echo "📋 Writing env vars from CDK outputs..."
cd ..
node scripts/write-env-from-cdk.js || echo "⚠️  write-env-from-cdk.js not found or failed. Set env vars manually."

echo ""
echo "🗃️  Seeding Aurora database with schemes and jobs..."
node scripts/seed-data.js || echo "⚠️  Seed failed (Aurora may need 1-2 min to wake up). Re-run: node scripts/seed-data.js"

echo ""
echo "🎉 VaaniSetu is deployed!"
echo ""
echo "Next steps:"
echo "  1. cd frontend && npm run build"
echo "  2. node ../scripts/deploy-frontend.js   (uploads to S3 + invalidates CloudFront)"
echo "  3. Open the CloudFront URL from the CDK outputs"
echo ""
echo "Test with: curl -X POST \$API_URL/voice/query -H 'Content-Type: application/json' -H 'X-User-Id: test-user-001' -d '{\"transcript\":\"hello\",\"language\":\"hi-IN\",\"sessionId\":\"test-001\"}'"
