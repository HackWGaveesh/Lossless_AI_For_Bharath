# VaaniSetu deployment checklist

## ⚠️ Aurora notes

- **"Engine mode serverless you requested is currently unavailable"** – Aurora Serverless v1 is deprecated/unavailable in many regions. This stack uses **Aurora Serverless v2** instead (same Data API, scales 0.5–2 ACU with auto-pause).
- **Free plan accounts:** If you see "WithExpressConfiguration" or free-plan limits, upgrade in **Billing → Account**, then redeploy.
- After any failed deploy, run **Step 0** (cleanup script) then deploy again.

---

## What’s done

- **Part 2 – Cognito:** Amplify config, AuthContext (sendOtp, verifyOtp, getAuthToken, devLogin), LoginPage OTP flow, API JWT + X-User-Id fallback.
- **Part 3 – Scripts:** CDK outputs script and frontend deploy script are in place.

## What’s left (Part 3 – run these steps)

### “Resource already exists” errors

If deploy fails with **"Resource of type 'AWS::S3::Bucket' with identifier 'vaanisetu-documents-...' already exists"** or similar for DynamoDB tables, those are **leftover resources** from a previous failed deploy. Run the cleanup script first (Step 0 below).

---

### Step 0: Load env and clean leftover resources (if deploy failed before)

In **PowerShell**, from the repo root `vaanisetu`:

```powershell
cd C:\Users\gavee\Downloads\AI_For_Bharath\vaanisetu
Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process') } }
.\scripts\cleanup-leftover-resources.ps1
```

Wait until the script finishes. If it deleted the stack, wait ~2–5 minutes. If it deleted DynamoDB tables, wait **~10 seconds** before deploying.

---

### Step 1: Pre-flight

- AWS CLI configured (`aws sts get-caller-identity` works).
- Node v20+ and `npm run build` success in both `backend/` and `frontend/`.
- In AWS Console (ap-south-1): **Bedrock → Model access** – enable **Claude 3.5 Sonnet** and **Amazon Titan Text Embeddings**.

### Step 2: Deploy infrastructure

In PowerShell, from repo root:

```powershell
cd C:\Users\gavee\Downloads\AI_For_Bharath\vaanisetu
Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process') } }
cd infrastructure
npx cdk deploy --all --require-approval never
```

(Bootstrap is only needed once per account/region; if you already ran it, skip `npx cdk bootstrap`.)

This takes **10–20 minutes**. Save the stack output (URLs, IDs, ARNs).

### Step 3: Fill env from CDK outputs

From repo root (env already loaded from Step 2, or load again):

```powershell
cd C:\Users\gavee\Downloads\AI_For_Bharath\vaanisetu
Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process') } }
node scripts/write-env-from-cdk.js
```

This updates root `.env` and writes `frontend/.env` (VITE_API_URL, VITE_USER_POOL_ID, VITE_USER_POOL_CLIENT_ID, VITE_AWS_REGION).

### Step 4: Seed the database

Load `.env` again, then run the seed script. In **Git Bash** or **WSL** (from repo root):

```bash
export $(cat .env | grep -v '^#' | xargs)
bash scripts/seed-data.sh
```

If you only have PowerShell, you can run the Node part of the seed manually; the script uses `aws rds-data` and Node. Or install Git Bash and run the above.

### Step 5: Build and deploy frontend

From repo root:

```powershell
cd C:\Users\gavee\Downloads\AI_For_Bharath\vaanisetu
node scripts/deploy-frontend.js
```

This runs `npm run build` in `frontend/`, uploads to S3, and invalidates CloudFront.

### Step 6: Live URL

After deploy, the live app URL is the **CloudFront URL** from the stack output (or printed at the end of `deploy-frontend.js`). Open it and run through the verification checklist in your main deployment prompt.

---

## Scripts reference

| Script | Purpose |
|--------|--------|
| `scripts/cleanup-leftover-resources.ps1` | Deletes failed stack (if any), S3 bucket, and DynamoDB tables so deploy can run clean. Run when you see "already exists" errors. |
| `scripts/write-env-from-cdk.js` | Reads CDK stack outputs and writes root `.env` + `frontend/.env`. |
| `scripts/deploy-frontend.js` | Builds frontend, uploads to S3, invalidates CloudFront. |
| `scripts/seed-data.sh` | Seeds schemes and jobs (requires DB_CLUSTER_ARN, DB_SECRET_ARN in `.env`). |
| `scripts/deploy.sh` | CDK bootstrap + deploy only (no seed, no frontend upload). |
