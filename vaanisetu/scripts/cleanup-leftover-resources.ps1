# Remove ALL VaaniSetu resources so CDK deploy can run clean.
# Run from repo root: .\scripts\cleanup-leftover-resources.ps1
# Requires: .env loaded with AWS credentials, or aws configure already set.

$ErrorActionPreference = "Continue"
$region = "ap-south-1"
$stackName = "VaaniSetuStack"

# 0. Delete CloudFormation stack if it exists (any status)
$stackStatus = (aws cloudformation describe-stacks --stack-name $stackName --region $region --query "Stacks[0].StackStatus" --output text 2>$null)
if ($stackStatus) {
    Write-Host "Deleting stack $stackName (status: $stackStatus)..."
    aws cloudformation delete-stack --stack-name $stackName --region $region 2>$null
    Write-Host "Waiting for stack deletion (2-5 min)..."
    aws cloudformation wait stack-delete-complete --stack-name $stackName --region $region 2>$null
    Write-Host "Stack deleted."
} else {
    Write-Host "No stack $stackName found (ok)."
}

# 1. List ALL buckets and delete any vaanisetu-* (head-bucket can miss; list is reliable)
$accountId = (aws sts get-caller-identity --query Account --output text 2>$null)
if (-not $accountId) {
    Write-Host "ERROR: AWS credentials not configured. Load .env first."
    exit 1
}

$allBuckets = (aws s3api list-buckets --output json 2>$null) | ConvertFrom-Json
$vaanisetuBuckets = @($allBuckets.Buckets | Where-Object { $_.Name -like "vaanisetu-*" })
if ($vaanisetuBuckets.Count -gt 0) {
    foreach ($b in $vaanisetuBuckets) {
        $name = $b.Name
        Write-Host "Emptying and deleting S3 bucket: $name"
        aws s3 rm "s3://$name" --recursive 2>$null
        # Remove all object versions (versioned bucket)
        $versions = (aws s3api list-object-versions --bucket $name --output json 2>$null) | ConvertFrom-Json
        if ($versions.Versions) {
            foreach ($v in $versions.Versions) {
                aws s3api delete-object --bucket $name --key $v.Key --version-id $v.VersionId 2>$null
            }
        }
        if ($versions.DeleteMarkers) {
            foreach ($d in $versions.DeleteMarkers) {
                aws s3api delete-object --bucket $name --key $d.Key --version-id $d.VersionId 2>$null
            }
        }
        aws s3api delete-bucket --bucket $name 2>$null
        if ($LASTEXITCODE -eq 0) { Write-Host "  Deleted $name" } else { Write-Host "  Delete failed (retry or check console)" }
    }
} else {
    Write-Host "No vaanisetu-* S3 buckets found (ok)."
}

# 2. Delete DynamoDB tables
$tables = @("vaanisetu-users", "vaanisetu-documents", "vaanisetu-applications", "vaanisetu-sessions")
foreach ($table in $tables) {
    Write-Host "Deleting DynamoDB table: $table"
    aws dynamodb delete-table --table-name $table --region $region 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Host "  Deleted $table" } else { Write-Host "  $table not found or already deleted" }
}

Write-Host ""
Write-Host "Cleanup done. Wait ~10 seconds, then run: cd infrastructure; npx cdk deploy --all --require-approval never"
