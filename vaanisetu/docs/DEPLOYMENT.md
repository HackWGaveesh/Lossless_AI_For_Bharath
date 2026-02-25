# VaaniSetu Deployment Guide

## Prerequisites

- Node.js 20+
- npm 10+
- AWS CLI configured (`aws configure`)
- AWS account with sufficient quotas (Lambda, Aurora Serverless, etc.)

## One-Command Setup

```bash
cd vaanisetu
bash scripts/setup.sh
```

Edit `.env` and set:
- `AWS_ACCOUNT_ID` / `CDK_DEFAULT_ACCOUNT`
- `CDK_DEFAULT_REGION` (e.g. ap-south-1)
- Optionally `BEDROCK_AGENT_ID` and `BEDROCK_AGENT_ALIAS_ID` for AI scheme search

## Deploy to AWS

```bash
bash scripts/deploy.sh
```

This will:
1. Bootstrap CDK (if needed)
2. Deploy the VaaniSetu stack (VPC, S3, DynamoDB, Aurora, Lambdas, API Gateway, CloudFront)
3. Output API endpoint and CloudFront URL

## Seed Database

After deploy, get the cluster and secret ARNs from CloudFormation outputs, then set in `.env`:

```
DB_CLUSTER_ARN=arn:aws:rds:ap-south-1:...
DB_SECRET_ARN=arn:aws:secretsmanager:ap-south-1:...
```

Run:

```bash
bash scripts/seed-data.sh
```

## Build & Upload Frontend

After deployment:
1. Set `VITE_API_URL` in frontend to your API Gateway URL (e.g. `https://xxx.execute-api.ap-south-1.amazonaws.com/prod`)
2. Build: `npm run build --workspace=frontend`
3. Upload `frontend/dist/*` to the S3 bucket (name in stack outputs)
4. Invalidate CloudFront cache if needed

## Local Development

**Terminal 1 – Backend:**
```bash
npm run dev --workspace=backend
```
Runs Express on http://localhost:3001 with routes under `/api`.

**Terminal 2 – Frontend:**
```bash
npm run dev --workspace=frontend
```
Runs Vite on http://localhost:3000 with proxy `/api` → localhost:3001.

## Destroy Stack

```bash
cd infrastructure
npx cdk destroy --all --force
```

Note: S3 buckets and DynamoDB tables with RETAIN policy will remain; delete manually if needed.
