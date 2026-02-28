#!/usr/bin/env node
/**
 * VaaniSetu database seed script.
 * Run from PowerShell (from vaanisetu folder): node scripts/seed-data.js
 * Or: npm run seed:node
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Load .env from project root
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const DB_CLUSTER_ARN = process.env.DB_CLUSTER_ARN || '';
const DB_SECRET_ARN = process.env.DB_SECRET_ARN || '';
const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';

if (!DB_CLUSTER_ARN || !DB_SECRET_ARN) {
  console.error('DB_CLUSTER_ARN and DB_SECRET_ARN must be set. Run from vaanisetu folder after: node scripts/write-env-from-cdk.js');
  process.exit(1);
}

console.log('Seeding VaaniSetu databases...');
console.log('Database ARN:', DB_CLUSTER_ARN);
console.log('Secret ARN:', DB_SECRET_ARN);

const { RDSDataClient, ExecuteStatementCommand } = require('@aws-sdk/client-rds-data');
const rds = new RDSDataClient({ region: AWS_REGION });

async function runSql(sql) {
  await rds.send(new ExecuteStatementCommand({
    resourceArn: DB_CLUSTER_ARN,
    secretArn: DB_SECRET_ARN,
    database: 'vaanisetu',
    sql,
  }));
}

async function main() {
  try {
    console.log('Creating schemes table (if not exists)...');
    await runSql(`
      CREATE TABLE IF NOT EXISTS schemes (
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
      )
    `).catch(() => {});

    const schemesPath = path.join(ROOT, 'data', 'schemes', 'central-schemes.json');
    if (!fs.existsSync(schemesPath)) {
      console.log('No data/schemes/central-schemes.json found. Skip schemes.');
    } else {
      const schemes = JSON.parse(fs.readFileSync(schemesPath, 'utf8'));
      console.log('Inserting', schemes.length, 'schemes...');
      for (const s of schemes) {
        await rds.send(new ExecuteStatementCommand({
          resourceArn: DB_CLUSTER_ARN,
          secretArn: DB_SECRET_ARN,
          database: 'vaanisetu',
          sql: `INSERT INTO schemes (
            scheme_id, scheme_code, name_en, name_hi, name_ta, name_te,
            description, category, benefit_type, benefit_amount_min,
            benefit_amount_max, ministry, level, eligibility_criteria,
            documents_required, application_url, is_active
          ) VALUES (
            :scheme_id, :scheme_code, :name_en, :name_hi, :name_ta, :name_te,
            :description, :category, :benefit_type, :benefit_amount_min,
            :benefit_amount_max, :ministry, :level, CAST(:eligibility_criteria AS jsonb),
            CAST(:documents_required AS jsonb), :application_url, :is_active
          ) ON CONFLICT (scheme_id) DO NOTHING`,
          parameters: [
            { name: 'scheme_id', value: { stringValue: s.scheme_id } },
            { name: 'scheme_code', value: { stringValue: s.scheme_code } },
            { name: 'name_en', value: { stringValue: s.name_en } },
            { name: 'name_hi', value: { stringValue: s.name_hi || '' } },
            { name: 'name_ta', value: { stringValue: s.name_ta || '' } },
            { name: 'name_te', value: { stringValue: s.name_te || '' } },
            { name: 'description', value: { stringValue: s.description || '' } },
            { name: 'category', value: { stringValue: s.category || '' } },
            { name: 'benefit_type', value: { stringValue: s.benefit_type || '' } },
            { name: 'benefit_amount_min', value: { longValue: s.benefit_amount_min || 0 } },
            { name: 'benefit_amount_max', value: { longValue: s.benefit_amount_max || 0 } },
            { name: 'ministry', value: { stringValue: s.ministry || '' } },
            { name: 'level', value: { stringValue: s.level || 'central' } },
            { name: 'eligibility_criteria', value: { stringValue: JSON.stringify(s.eligibility_criteria || {}) } },
            { name: 'documents_required', value: { stringValue: JSON.stringify(s.documents_required || []) } },
            { name: 'application_url', value: { stringValue: s.application_url || '' } },
            { name: 'is_active', value: { booleanValue: s.is_active !== false } },
          ],
        }));
        console.log('  Inserted scheme:', s.name_en);
      }
      console.log('All schemes inserted.');
    }

    console.log('Creating jobs table (if not exists)...');
    await runSql(`
      CREATE TABLE IF NOT EXISTS jobs (
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
      )
    `).catch(() => {});

    const jobsPath = path.join(ROOT, 'data', 'jobs', 'sample-jobs.json');
    if (!fs.existsSync(jobsPath)) {
      console.log('No data/jobs/sample-jobs.json found. Skip jobs.');
    } else {
      const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
      console.log('Inserting', jobs.length, 'jobs...');
      for (const j of jobs) {
        await rds.send(new ExecuteStatementCommand({
          resourceArn: DB_CLUSTER_ARN,
          secretArn: DB_SECRET_ARN,
          database: 'vaanisetu',
          sql: `INSERT INTO jobs (job_id, title, company, state, district, job_type, salary_min, salary_max, skills, description) VALUES (:job_id, :title, :company, :state, :district, :job_type, :salary_min, :salary_max, CAST(:skills AS jsonb), :description) ON CONFLICT (job_id) DO NOTHING`,
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
            { name: 'description', value: { stringValue: String(j.description || '') } },
          ],
        }));
        console.log('  Inserted job:', j.title);
      }
      console.log('All jobs inserted.');
    }

    console.log('Database seeding complete.');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

main();
