# VaaniSetu API Reference

Base URL: `https://<api-id>.execute-api.ap-south-1.amazonaws.com/prod` (or local: `http://localhost:3001/api`)

## Schemes

### GET /schemes
List government schemes with optional filters.

**Query parameters:**
- `category` (optional): e.g. agriculture, financial_inclusion
- `benefitType` (optional): e.g. direct_benefit, loan
- `limit` (optional, default 50)
- `offset` (optional, default 0)

**Response:**
```json
{
  "success": true,
  "data": {
    "schemes": [
      {
        "schemeId": "SCHEME-001",
        "nameEn": "Pradhan Mantri Kisan Samman Nidhi",
        "nameHi": "प्रधानमंत्री किसान सम्मान निधि",
        "description": "...",
        "benefitAmountMin": 6000,
        "benefitAmountMax": 6000,
        "eligibilityCriteria": {}
      }
    ],
    "total": 1
  }
}
```

### POST /schemes/search
AI-powered scheme search based on user profile and query.

**Body:**
```json
{
  "userProfile": {
    "age": 35,
    "gender": "male",
    "occupation": "farmer",
    "annualIncome": 200000,
    "casteCategory": "general",
    "state": "Bihar"
  },
  "query": "farmer loan"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "schemes": [...],
    "agentInsights": "..."
  }
}
```

## Documents

### POST /documents/upload
Get a presigned URL to upload a document.

**Body:**
```json
{
  "userId": "user-123",
  "documentType": "aadhaar",
  "fileName": "aadhaar.jpg",
  "contentType": "image/jpeg"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "documentId": "uuid",
    "uploadUrl": "https://...",
    "key": "user-123/aadhaar/uuid.jpg",
    "expiresIn": 3600
  }
}
```

## Applications

### POST /applications
Create a new scheme application.

**Body:**
```json
{
  "userId": "user-123",
  "schemeId": "SCHEME-001",
  "formData": {
    "name": "Ramesh",
    "phone": "9876543210",
    "address": "..."
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "applicationId": "APP-XXXXXXXX",
    "status": "submitted",
    "message": "Application submitted successfully."
  }
}
```

## Health

### GET /health
Returns `{ "status": "ok", "service": "vaanisetu-backend" }`.
