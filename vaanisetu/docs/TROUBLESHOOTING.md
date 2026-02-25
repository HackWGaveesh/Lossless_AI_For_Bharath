# VaaniSetu Troubleshooting

## Frontend

**Blank page / white screen**
- Check browser console for errors
- Ensure `npm run build --workspace=frontend` completes without errors
- Verify base URL and API proxy (e.g. VITE_API_URL or `/api` proxy in Vite)

**API calls failing**
- Confirm backend is running (dev: `npm run dev --workspace=backend`)
- Confirm API base URL: dev uses `/api` (proxied to 3001), prod uses VITE_API_URL
- Check CORS and API Gateway configuration

## Backend

**Lambda / API Gateway errors**
- Check CloudWatch Logs for the Lambda function
- Verify environment variables (DB_CLUSTER_ARN, DB_SECRET_ARN, DOCUMENTS_BUCKET, etc.)
- For RDS Data API: ensure Aurora cluster is not paused and secret is correct

**Scheme list returns empty**
- Run `scripts/seed-data.sh` after deployment
- Ensure `schemes` table exists and has rows in Aurora

**Document upload / process**
- Presigned URL: check DOCUMENTS_BUCKET and IAM permissions
- S3 trigger: ensure Lambda has permission to be invoked by S3
- Textract/Bedrock: ensure region supports these services (e.g. ap-south-1)

## Infrastructure (CDK)

**CDK deploy fails**
- Run `npx cdk bootstrap` in the target account/region
- Check quotas: Lambda concurrency, Aurora Serverless, S3, etc.
- Resolve any dependency errors: `npm install` in root and in infrastructure

**NodejsFunction bundling fails**
- Ensure backend `src` path is correct in stack (relative to infrastructure/lib)
- Ensure backend dependencies are installed (`npm install` in backend)

## Database

**Aurora “cluster not found” or connection errors**
- Use Data API (no VPC connectivity required for Lambdas)
- Ensure DB_SECRET_ARN is the cluster’s managed secret, not a custom one
- Check that the cluster is not in a long pause (Serverless auto-pause)

**Seed script fails**
- Export DB_CLUSTER_ARN and DB_SECRET_ARN (e.g. from .env) before running
- Ensure Aurora default database is `vaanisetu` and table `schemes` is created by the script
