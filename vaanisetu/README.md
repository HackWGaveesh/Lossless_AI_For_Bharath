# VaaniSetu (वाणी सेतु - Voice Bridge)

**India's first voice-first AI platform bridging the digital divide for 900 million rural Indians.**

## Overview

VaaniSetu enables rural Indians to access government schemes, apply for benefits, and get job matches through **voice** in Hindi, Tamil, Telugu, and 19+ other languages—no typing or reading required.

## Features

- **Voice-first**: Natural conversations in local languages
- **Multi-language**: Hindi, Tamil, Telugu with dialect support
- **Autonomous AI**: Agents fill forms, check status, complete applications
- **AWS-powered**: 15+ AWS services (Bedrock, Aurora, Connect, S3, etc.)
- **Secure**: End-to-end encryption, DPDP compliance

## Prerequisites

- **Node.js** 20.x or higher
- **npm** 10.x or higher
- **AWS CLI** configured with credentials
- **Git**

## Quick Start

### 1. Clone and setup

```bash
cd vaanisetu
npm install
cp .env.example .env
# Edit .env with your AWS_ACCOUNT_ID and CDK_DEFAULT_ACCOUNT
```

### 2. One-command setup (recommended)

```bash
bash scripts/setup.sh
```

### 3. Local development

```bash
# Terminal 1: Frontend
npm run dev --workspace=frontend

# Terminal 2: Backend (if using dev server)
npm run dev --workspace=backend
```

Frontend: http://localhost:3000

### 4. Deploy to AWS

```bash
bash scripts/deploy.sh
```

### 5. Seed databases

```bash
bash scripts/seed-data.sh
```

### 6. Run tests

```bash
npm run test
```

## Project Structure

```
vaanisetu/
├── frontend/     # React + TypeScript + Vite + Tailwind
├── backend/      # Lambda handlers, agents, services
├── infrastructure/ # AWS CDK stacks
├── data/         # Seed data (schemes, jobs, users)
├── scripts/      # setup, deploy, seed, test
└── docs/         # Architecture, API, DEMO, Deployment
```

## Environment Variables

See `.env.example` for required variables. Key ones:

- `AWS_REGION`, `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`
- `BEDROCK_AGENT_ID`, `BEDROCK_AGENT_ALIAS_ID` (for AI scheme search)
- `DB_CLUSTER_ARN`, `DB_SECRET_ARN` (set by CDK / Secrets Manager)

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Demo Script](docs/DEMO.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License

Proprietary - AWS AI for Bharat Hackathon.
