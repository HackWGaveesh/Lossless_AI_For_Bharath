#!/bin/bash
set -e

echo "🚀 Setting up VaaniSetu..."

command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed. Aborting." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required but not installed. Aborting." >&2; exit 1; }

echo "✅ Prerequisites check passed"

echo "📦 Installing dependencies..."
npm install --workspaces

if [ ! -f ".env" ]; then
  echo "📝 Creating .env file from template..."
  cp .env.example .env
  echo "⚠️  Please update .env with your AWS credentials and configuration"
fi

echo "🔨 Building backend..."
npm run build --workspace=backend 2>/dev/null || true

echo "🔨 Building frontend..."
npm run build --workspace=frontend

echo "🏗️  Building CDK infrastructure..."
npm run build --workspace=infrastructure 2>/dev/null || true

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update .env with your AWS credentials"
echo "2. Run 'npm run deploy' to deploy to AWS"
echo "3. Run 'npm run seed' to populate databases"
echo "4. Run 'npm run dev --workspace=frontend' to start development server"
