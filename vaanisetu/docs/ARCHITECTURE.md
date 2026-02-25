# VaaniSetu Architecture

## High-Level Overview

VaaniSetu is a voice-first, multi-agent AI platform for rural India. The system uses AWS services end-to-end for compute, storage, AI, and communication.

## Components

### Frontend (React + Vite + Tailwind)
- **Hosting:** S3 + CloudFront
- **Auth:** Cognito (optional)
- **State:** React Query, Zustand, Context
- **i18n:** Hindi, Tamil, Telugu via LanguageContext

### Backend (Node.js Lambda)
- **API Gateway:** REST API with CORS
- **Lambdas:** Schemes (list, search), Documents (upload, process), Applications (create)
- **AI:** Bedrock (Claude 3.5 Sonnet), Bedrock Agents for scheme search
- **Document processing:** Textract + Bedrock for OCR and structuring

### Data Layer
- **Aurora Serverless v2 (PostgreSQL):** Schemes, relational data
- **DynamoDB:** Users, sessions, applications
- **S3:** Document storage (KMS-encrypted)

### Security
- **KMS:** Encryption at rest for S3, DynamoDB, RDS
- **IAM:** Least-privilege roles per Lambda
- **Secrets Manager:** DB credentials (via Aurora managed secret)

## Data Flow

1. **Scheme list:** Client → API Gateway → Lambda (list) → RDS Data API → Aurora
2. **Scheme search:** Client → API Gateway → Lambda (search) → Bedrock Agent + Aurora
3. **Document upload:** Client → API Gateway → Lambda (upload) → Presigned S3 URL → Client uploads to S3
4. **Document process:** S3 event → Lambda (process) → Textract → Bedrock → DynamoDB (documents table)

## Infrastructure (CDK)

- **VaaniSetuStack:** Single stack with VPC, S3, DynamoDB, Aurora Serverless, Lambdas (NodejsFunction), API Gateway, CloudFront, SNS
- **Region:** ap-south-1 (Mumbai)
