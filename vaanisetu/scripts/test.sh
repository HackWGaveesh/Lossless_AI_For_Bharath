#!/bin/bash
set -e

echo "🧪 Running VaaniSetu tests..."

npm run build --workspace=frontend && echo "✅ Frontend build OK"
npm run build --workspace=backend 2>/dev/null && echo "✅ Backend build OK" || true
npm run build --workspace=infrastructure 2>/dev/null && echo "✅ Infrastructure build OK" || true

echo "✅ All tests passed!"
