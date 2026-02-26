#!/bin/bash
set -e

echo "🌱 Seeding VaaniSetu databases..."

if [ -f ".env" ]; then
  set -a
  . .env
  set +a
fi

DB_CLUSTER_ARN="${DB_CLUSTER_ARN:-}"
DB_SECRET_ARN="${DB_SECRET_ARN:-}"

if [ -z "$DB_CLUSTER_ARN" ] || [ -z "$DB_SECRET_ARN" ]; then
  echo "⚠️  DB_CLUSTER_ARN and DB_SECRET_ARN must be set (e.g. from CDK outputs or .env)"
  echo "   After CDK deploy, run: aws cloudformation describe-stacks --stack-name VaaniSetuStack --query 'Stacks[0].Outputs'"
  exit 1
fi

echo "📋 Database ARN: $DB_CLUSTER_ARN"
echo "🔐 Secret ARN: $DB_SECRET_ARN"

echo "📊 Creating schemes table (if not exists)..."
aws rds-data execute-statement \
  --resource-arn "$DB_CLUSTER_ARN" \
  --secret-arn "$DB_SECRET_ARN" \
  --database "vaanisetu" \
  --sql "CREATE TABLE IF NOT EXISTS schemes (
    scheme_id VARCHAR(50) PRIMARY KEY,
    scheme_code VARCHAR(50) UNIQUE NOT NULL,
    name_en TEXT NOT NULL,
    name_hi TEXT,
    name_ta TEXT,
    name_te TEXT,
    description TEXT,
    category VARCHAR(50),
    benefit_type VARCHAR(50),
    benefit_amount_min INTEGER,
    benefit_amount_max INTEGER,
    ministry VARCHAR(255),
    level VARCHAR(20),
    eligibility_criteria JSONB,
    documents_required JSONB,
    application_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )" 2>/dev/null || true

echo "💾 Inserting schemes from data/schemes/central-schemes.json..."
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
node -e "
const fs = require('fs');
const path = require('path');
const schemes = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/schemes/central-schemes.json'), 'utf8'));
const { RDSDataClient, ExecuteStatementCommand } = require('@aws-sdk/client-rds-data');
const rds = new RDSDataClient({ region: process.env.AWS_REGION || 'ap-south-1' });

async function insertSchemes() {
  for (const scheme of schemes) {
    await rds.send(new ExecuteStatementCommand({
      resourceArn: process.env.DB_CLUSTER_ARN,
      secretArn: process.env.DB_SECRET_ARN,
      database: 'vaanisetu',
      sql: \`INSERT INTO schemes (
        scheme_id, scheme_code, name_en, name_hi, name_ta, name_te,
        description, category, benefit_type, benefit_amount_min,
        benefit_amount_max, ministry, level, eligibility_criteria,
        documents_required, application_url, is_active
      ) VALUES (
        :scheme_id, :scheme_code, :name_en, :name_hi, :name_ta, :name_te,
        :description, :category, :benefit_type, :benefit_amount_min,
        :benefit_amount_max, :ministry, :level, CAST(:eligibility_criteria AS jsonb),
        CAST(:documents_required AS jsonb), :application_url, :is_active
      ) ON CONFLICT (scheme_id) DO NOTHING\`,
      parameters: [
        { name: 'scheme_id', value: { stringValue: scheme.scheme_id } },
        { name: 'scheme_code', value: { stringValue: scheme.scheme_code } },
        { name: 'name_en', value: { stringValue: scheme.name_en } },
        { name: 'name_hi', value: { stringValue: scheme.name_hi || '' } },
        { name: 'name_ta', value: { stringValue: scheme.name_ta || '' } },
        { name: 'name_te', value: { stringValue: scheme.name_te || '' } },
        { name: 'description', value: { stringValue: scheme.description || '' } },
        { name: 'category', value: { stringValue: scheme.category || '' } },
        { name: 'benefit_type', value: { stringValue: scheme.benefit_type || '' } },
        { name: 'benefit_amount_min', value: { longValue: scheme.benefit_amount_min || 0 } },
        { name: 'benefit_amount_max', value: { longValue: scheme.benefit_amount_max || 0 } },
        { name: 'ministry', value: { stringValue: scheme.ministry || '' } },
        { name: 'level', value: { stringValue: scheme.level || 'central' } },
        { name: 'eligibility_criteria', value: { stringValue: JSON.stringify(scheme.eligibility_criteria || {}) } },
        { name: 'documents_required', value: { stringValue: JSON.stringify(scheme.documents_required || []) } },
        { name: 'application_url', value: { stringValue: scheme.application_url || '' } },
        { name: 'is_active', value: { booleanValue: scheme.is_active !== false } }
      ]
    }));
    console.log('✅ Inserted scheme: ' + scheme.name_en);
  }
}

insertSchemes().then(() => console.log('✅ All schemes inserted!')).catch(e => { console.error(e); process.exit(1); });
"

echo "📊 Creating jobs table (if not exists)..."
aws rds-data execute-statement \
  --resource-arn "$DB_CLUSTER_ARN" \
  --secret-arn "$DB_SECRET_ARN" \
  --database "vaanisetu" \
  --sql "CREATE TABLE IF NOT EXISTS jobs (
    job_id VARCHAR(50) PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT,
    state VARCHAR(100),
    district VARCHAR(100),
    job_type VARCHAR(50),
    salary_min INTEGER,
    salary_max INTEGER,
    skills JSONB,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )" 2>/dev/null || true

echo "💾 Inserting jobs from data/jobs/sample-jobs.json..."
node -e "
const fs = require('fs');
const path = require('path');
let jobs = [];
try {
  jobs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/jobs/sample-jobs.json'), 'utf8'));
} catch (e) { console.log('No jobs file or invalid JSON'); process.exit(0); }
const { RDSDataClient, ExecuteStatementCommand } = require('@aws-sdk/client-rds-data');
const rds = new RDSDataClient({ region: process.env.AWS_REGION || 'ap-south-1' });
async function insertJobs() {
  for (const j of jobs) {
    await rds.send(new ExecuteStatementCommand({
      resourceArn: process.env.DB_CLUSTER_ARN,
      secretArn: process.env.DB_SECRET_ARN,
      database: 'vaanisetu',
      sql: \`INSERT INTO jobs (job_id, title, company, state, district, job_type, salary_min, salary_max, skills, description) VALUES (:job_id, :title, :company, :state, :district, :job_type, :salary_min, :salary_max, CAST(:skills AS jsonb), :description) ON CONFLICT (job_id) DO NOTHING\`,
      parameters: [
        { name: 'job_id', value: { stringValue: j.job_id } },
        { name: 'title', value: { stringValue: j.title } },
        { name: 'company', value: { stringValue: j.company || '' } },
        { name: 'state', value: { stringValue: j.state || '' } },
        { name: 'district', value: { stringValue: j.district || '' } },
        { name: 'job_type', value: { stringValue: j.job_type || 'Full-time' } },
        { name: 'salary_min', value: { longValue: j.salary_min || 0 } },
        { name: 'salary_max', value: { longValue: j.salary_max || 0 } },
        { name: 'skills', value: { stringValue: JSON.stringify(j.skills || []) } },
        { name: 'description', value: { stringValue: (j.description || '') } }
      ]
    }));
    console.log('✅ Inserted job: ' + j.title);
  }
}
insertJobs().then(() => console.log('✅ All jobs inserted!')).catch(e => { console.error(e); process.exit(1); });
"

echo "✅ Database seeding complete!"
