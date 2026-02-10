# VaaniSetu — System Design Document

## 1. System Overview

### Introduction

VaaniSetu is a **multi-channel, voice-first, agentic AI platform** designed to bridge India's digital divide by enabling rural and underserved communities to access government services, education, healthcare, and economic opportunities through natural voice conversations in their native languages.

### Core Characteristics

**Voice-First Architecture:**
- Voice is the primary interface, not an add-on feature
- Designed for users with zero digital literacy
- Natural conversation flow without menu navigation
- Works on basic feature phones (₹1,500 devices)

**Agentic AI System:**
- Multiple specialized AI agents that can perform actions autonomously
- Not just information retrieval — actual task execution
- Agents coordinate to complete complex workflows
- Human-in-the-loop for high-stakes decisions

**Cloud-Native on AWS:**
- Built entirely on AWS services (15+ services integrated)
- Serverless-first architecture for scalability
- Event-driven design for loose coupling
- Infrastructure as Code for reproducibility

**Multi-Channel Access:**
- Voice calls (Amazon Connect)
- WhatsApp messaging (Meta Business API)
- Web dashboard (AWS Amplify)
- SMS notifications (Amazon SNS)

### Key Capabilities

1. **Multilingual Voice Conversation**: 3 languages (Hindi, Tamil, Telugu) with dialect support
2. **Government Scheme Discovery**: Match users to 50+ schemes based on eligibility
3. **Document Processing**: OCR and structured data extraction from identity documents
4. **Autonomous Form Filling**: Navigate and fill government forms (demo portal)
5. **Proactive Assistance**: Reminders, status updates, opportunity alerts
6. **Job Matching**: Connect users to relevant employment opportunities
7. **Secure Document Wallet**: Encrypted storage of user documents


---

## 2. High-Level Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACES                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Voice   │  │ WhatsApp │  │   Web    │  │   SMS    │       │
│  │  Calls   │  │ Messages │  │Dashboard │  │ Alerts   │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
└───────┼─────────────┼─────────────┼─────────────┼──────────────┘
        │             │             │             │
        │             │             │             │
┌───────▼─────────────▼─────────────▼─────────────▼──────────────┐
│              API GATEWAY & AUTHENTICATION                       │
│         (Amazon API Gateway + Amazon Cognito)                   │
└───────┬─────────────┬─────────────┬─────────────┬──────────────┘
        │             │             │             │
┌───────▼─────┐ ┌─────▼──────┐ ┌───▼────────┐ ┌─▼──────────┐
│   Amazon    │ │  WhatsApp  │ │    Web     │ │   Amazon   │
│   Connect   │ │  Webhook   │ │  Backend   │ │    SNS     │
│  (Voice)    │ │  Handler   │ │ (Amplify)  │ │   (SMS)    │
└───────┬─────┘ └─────┬──────┘ └───┬────────┘ └────────────┘
        │             │             │
        └─────────────┼─────────────┘
                      │
        ┌─────────────▼─────────────┐
        │    MESSAGE ROUTING        │
        │  (SQS + EventBridge)      │
        └─────────────┬─────────────┘
                      │
        ┌─────────────▼─────────────────────────────┐
        │      AI ORCHESTRATION LAYER               │
        │  ┌─────────────────────────────────────┐  │
        │  │   Orchestrator Agent (Bedrock)      │  │
        │  │   (Claude 3.5 Sonnet)               │  │
        │  └──────────┬──────────────────────────┘  │
        │             │                              │
        │  ┌──────────┼──────────────────────────┐  │
        │  │          │                          │  │
        │  ▼          ▼                          ▼  │
        │ ┌────┐   ┌────┐   ┌────┐   ┌────┐  ┌────┐│
        │ │Sch │   │Doc │   │Nav │   │Not │  │Mem ││
        │ │eme │   │ument│   │igat│   │ify │  │ory││
        │ │Agt │   │ Agt │   │or  │   │Agt │  │Agt││
        │ └─┬──┘   └─┬──┘   └─┬──┘   └─┬──┘  └─┬──┘│
        └───┼────────┼────────┼────────┼──────┼────┘
            │        │        │        │      │
    ┌───────┼────────┼────────┼────────┼──────┼────────┐
    │       │        │        │        │      │        │
    ▼       ▼        ▼        ▼        ▼      ▼        │
┌────────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌────────┐     │
│Bedrock │ │Text- │ │Lambda│ │Event │ │DynamoDB│     │
│  KB    │ │tract │ │Fargate│ │Bridge│ │        │     │
│(Schemes│ │(OCR) │ │(Browser│ │(Notif│ │(Session│     │
└────────┘ └──────┘ │ Auto) │ │Queue)│ │ State) │     │
                    └──────┘ └──────┘ └────────┘     │
                                                      │
    ┌─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                    DATA LAYER                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │  Aurora  │  │ DynamoDB │  │    S3    │             │
│  │PostgreSQL│  │ (NoSQL)  │  │(Documents│             │
│  │(Schemes, │  │(Sessions,│  │  Vault)  │             │
│  │  Jobs)   │  │  Users)  │  │          │             │
│  └──────────┘  └──────────┘  └──────────┘             │
└─────────────────────────────────────────────────────────┘
                      │
    ┌─────────────────▼─────────────────┐
    │   MONITORING & ANALYTICS          │
    │  (CloudWatch, X-Ray, QuickSight)  │
    └───────────────────────────────────┘
```

### Data Flow Overview

**Voice Interaction Flow:**
1. User calls toll-free number → Amazon Connect
2. Audio streamed to Lambda via Kinesis Video Streams
3. Lambda sends audio to Bhashini API (STT)
4. Text transcript sent to Bedrock Orchestrator Agent
5. Orchestrator routes to appropriate specialist agent
6. Agent performs action (query database, process document, fill form)
7. Response text sent to Bhashini (TTS)
8. Audio response streamed back to user via Connect

**WhatsApp Interaction Flow:**
1. User sends message → Meta WhatsApp API → Webhook
2. API Gateway receives POST request
3. Lambda validates and enqueues to SQS
4. Processor Lambda consumes message
5. Routes to Bedrock Orchestrator Agent
6. Agent processes and generates response
7. Response sent back via Meta API to user

**Document Processing Flow:**
1. User uploads image via WhatsApp or web
2. Image stored in S3 bucket
3. Lambda triggers Amazon Textract
4. Textract extracts text and structure
5. Bedrock Agent validates and structures data
6. Confirmation sent to user for review
7. Approved data stored in DynamoDB


---

## 3. System Components

### 3.1 Frontend Layer

#### Voice Interface (Amazon Connect)

**Purpose:** Primary user interface for voice-based interactions

**Components:**
- **Contact Flow**: IVR logic for call routing and language selection
- **Media Streaming**: Real-time audio streaming to Lambda
- **Call Recording**: Optional recording for quality assurance
- **DTMF Support**: Fallback for users who prefer button press

**Implementation:**
- Toll-free number provisioned in Amazon Connect
- Contact flow designed with language detection
- Streams audio to Kinesis Video Streams
- Integrates with Lambda for custom logic

**User Experience:**
1. User dials toll-free number
2. Welcome message: "Welcome to VaaniSetu. Press 1 for Hindi, 2 for Tamil, 3 for Telugu"
3. Language confirmed, call connected to AI agent
4. Natural conversation begins
5. AI responds with voice synthesis

#### WhatsApp Interface (Meta Business API)

**Purpose:** Text and voice messaging for users who prefer WhatsApp

**Components:**
- **Webhook Endpoint**: Receives incoming messages from Meta
- **Message Parser**: Extracts text, voice notes, images
- **Response Formatter**: Formats responses with buttons, lists, media
- **Session Manager**: Maintains conversation context

**Implementation:**
- WhatsApp Business API account with verified number
- Webhook hosted on API Gateway + Lambda
- Signature verification for security
- Interactive message templates

**User Experience:**
1. User sends "Hi" to VaaniSetu WhatsApp number
2. Bot responds: "नमस्ते! मैं वाणी सेतु हूं। मैं आपकी कैसे मदद कर सकता हूं?"
3. User can send text, voice notes, or images
4. Bot responds with text, buttons, or voice notes
5. Persistent chat history

#### Web Dashboard (AWS Amplify)

**Purpose:** Visual interface for digitally literate users and administrators

**Components:**
- **User Portal**: View applications, upload documents, track status
- **Admin Dashboard**: Monitor system metrics, user analytics
- **Voice Widget**: Embedded voice interface on web
- **Document Viewer**: Preview uploaded documents

**Implementation:**
- React-based Progressive Web App (PWA)
- Hosted on AWS Amplify with CI/CD
- CloudFront CDN for fast global delivery
- Cognito for authentication

**Features:**
- Responsive design (mobile, tablet, desktop)
- Offline-capable (service workers)
- Accessibility compliant (WCAG 2.1 AA)
- Multilingual UI

#### SMS Notifications (Amazon SNS)

**Purpose:** One-way alerts and reminders for users with basic phones

**Components:**
- **SNS Topic**: Notification distribution
- **Message Templates**: Predefined message formats
- **Delivery Tracking**: Monitor delivery status

**Implementation:**
- SNS configured with SMS channel
- Lambda triggers SNS publish
- Supports Unicode (regional languages)

**Use Cases:**
- OTP delivery
- Application status updates
- Deadline reminders
- Scheme launch alerts

### 3.2 Backend Layer

#### API Gateway

**Purpose:** Central entry point for all API requests

**Configuration:**
- REST API for synchronous requests (web, WhatsApp)
- WebSocket API for real-time updates (future)
- IAM authentication for internal services
- API key authentication for external partners

**Features:**
- Request validation
- Rate limiting (100 req/min per user)
- CORS configuration
- Request/response transformation

#### Message Routing (SQS + EventBridge)

**Purpose:** Decouple services and enable asynchronous processing

**SQS Queues:**
- `whatsapp-incoming-queue`: Incoming WhatsApp messages
- `document-processing-queue`: Document OCR tasks
- `notification-queue`: Outgoing notifications
- `form-submission-queue`: Form filling tasks

**EventBridge Rules:**
- `application-status-changed`: Trigger notifications
- `deadline-approaching`: Trigger reminders
- `new-scheme-launched`: Trigger alerts

**Benefits:**
- Fault tolerance (retry on failure)
- Load leveling (handle traffic spikes)
- Loose coupling (services don't call each other directly)

#### Lambda Functions

**Purpose:** Serverless compute for business logic

**Key Functions:**
1. **VoiceSessionManager**: Manages Connect call sessions
2. **KinesisAudioProcessor**: Processes audio streams
3. **WhatsAppWebhookHandler**: Receives WhatsApp messages
4. **MessageProcessor**: Routes messages to AI agents
5. **DocumentProcessor**: Triggers Textract and validates data
6. **FormFillerOrchestrator**: Coordinates browser automation
7. **NotificationScheduler**: Sends proactive notifications
8. **StatusChecker**: Polls government portals for status updates

**Configuration:**
- Runtime: Python 3.12
- Memory: 512 MB - 3 GB (based on function)
- Timeout: 30 seconds - 15 minutes
- Concurrency: Auto-scaling (0-1000)
- Environment variables: Stored in Secrets Manager

#### ECS Fargate (Browser Automation)

**Purpose:** Run headless browser for form filling

**Why Fargate (not Lambda):**
- Lambda has 15-minute timeout (form filling may take longer)
- Lambda has 10 GB disk limit (browser needs more)
- Fargate allows persistent connections

**Implementation:**
- Docker container with Playwright + Chrome
- Task definition with 2 vCPU, 4 GB RAM
- Runs on-demand (triggered by SQS message)
- Logs to CloudWatch

**Workflow:**
1. Lambda receives form filling request
2. Lambda sends message to SQS
3. ECS task launched
4. Task runs Playwright script
5. Fills form, captures screenshot
6. Sends result to Lambda
7. Task terminates


### 3.3 AI Agent System

#### Orchestrator Agent (Supervisor)

**Model:** Anthropic Claude 3.5 Sonnet (via AWS Bedrock)

**Role:** Main brain that understands user intent and coordinates specialist agents

**Responsibilities:**
- Parse user input and identify intent
- Decompose complex tasks into subtasks
- Route subtasks to appropriate specialist agents
- Synthesize responses from multiple agents
- Maintain conversation context
- Handle errors and fallbacks

**Prompt Structure:**
```
You are VaaniSetu, an AI assistant helping rural Indians access government services.

Context:
- User: {name}, {age}, {location}, {language}
- Current task: {task_description}
- Conversation history: {last_5_turns}

Available agents:
1. SchemeAgent: Find and recommend government schemes
2. DocumentAgent: Process uploaded documents
3. NavigatorAgent: Fill online forms
4. NotificationAgent: Send reminders and alerts
5. MemoryAgent: Retrieve user history

User message: "{user_input}"

Think step-by-step:
1. What is the user asking for?
2. Which agent(s) should handle this?
3. What information do I need to collect?
4. What should I respond?

Response:
```

**Decision Logic:**
- If user asks about schemes → Route to SchemeAgent
- If user uploads document → Route to DocumentAgent
- If user wants to apply → Route to NavigatorAgent
- If user asks about status → Route to MemoryAgent + StatusChecker

#### Specialist Agents

**1. Scheme Matching Agent**

**Model:** Claude 3.5 Sonnet + Custom Scoring Logic

**Purpose:** Recommend relevant government schemes based on user eligibility

**Tools Available:**
- `search_schemes(criteria)`: Query scheme database
- `calculate_eligibility(user_profile, scheme)`: Check if user qualifies
- `get_scheme_details(scheme_id)`: Fetch full scheme information

**Workflow:**
1. Receive user profile from Orchestrator
2. Query Aurora database for schemes matching basic criteria (age, location)
3. For each scheme, calculate eligibility score (0-100%)
4. Rank schemes by score × benefit_amount
5. Return top 5 schemes with explanations

**Example Output:**
```json
{
  "schemes": [
    {
      "name": "PM-KISAN",
      "eligibility_score": 95,
      "benefit": "₹6,000/year",
      "reason": "You are a farmer with <2 hectares land",
      "documents_needed": ["Aadhaar", "Land Record"],
      "deadline": "2026-03-31"
    },
    ...
  ]
}
```

**2. Document Processing Agent**

**Model:** AWS Bedrock Nova Pro (vision) + Amazon Textract

**Purpose:** Extract structured data from uploaded identity documents

**Tools Available:**
- `extract_text(image_url)`: OCR via Textract
- `validate_aadhaar(number)`: Verify Aadhaar checksum
- `validate_pan(number)`: Verify PAN format
- `validate_ifsc(code)`: Check IFSC code against RBI database

**Workflow:**
1. Receive S3 URL of uploaded image
2. Call Textract AnalyzeDocument API
3. Extract key-value pairs (Name: "Ramesh Kumar", DOB: "15/08/1982")
4. Validate extracted data (checksums, formats)
5. Structure data as JSON
6. Send to user for confirmation
7. Store in DynamoDB after approval

**Textract Configuration:**
- Feature: FORMS (key-value pairs)
- Feature: TABLES (for bank passbooks)
- Language: Hindi, Tamil, Telugu (via AnalyzeID)

**3. Navigator Agent (Form Filler)**

**Model:** Claude 3.5 Sonnet (vision + reasoning)

**Purpose:** Autonomously navigate government portals and fill forms

**Tools Available:**
- `launch_browser(url)`: Start headless Chrome
- `find_element(selector)`: Locate form field
- `fill_field(selector, value)`: Enter data
- `click_button(selector)`: Submit form
- `solve_captcha(image)`: Use vision model to solve CAPTCHA
- `take_screenshot()`: Capture page state

**Workflow:**
1. Receive form filling request with user data
2. Launch Playwright browser in Fargate container
3. Navigate to portal URL
4. Identify form fields using DOM inspection
5. Fill fields with user data from DynamoDB
6. Handle dropdowns, checkboxes, radio buttons
7. Solve CAPTCHA using Claude 3.5 Sonnet vision
8. Show preview to user (screenshot)
9. Wait for user confirmation
10. Click submit button
11. Capture acknowledgment number
12. Return result to Orchestrator

**Safety Measures:**
- Only operates on whitelisted demo portal (not real government sites)
- Requires explicit user confirmation before submission
- Logs all actions for audit
- Rate limited (max 5 forms per user per day)

**4. Notification Agent**

**Model:** Claude 3.5 Haiku (fast, cost-efficient)

**Purpose:** Send proactive reminders and status updates

**Tools Available:**
- `schedule_notification(user_id, message, channel, time)`: Schedule future notification
- `send_immediate(user_id, message, channel)`: Send now
- `check_deadlines()`: Query applications with approaching deadlines
- `check_status_updates()`: Poll for status changes

**Workflow:**
1. Cron job triggers Lambda every hour
2. Query DynamoDB for:
   - Applications with deadline in 3 days
   - Applications with status change since last check
   - Users who haven't logged in for 7 days
3. For each, generate personalized message
4. Send via appropriate channel (SMS, WhatsApp, call)
5. Log delivery status

**Example Notifications:**
- "आपका PM-KISAN आवेदन स्वीकृत हो गया! ₹2,000 कल आएगा।"
- "3 दिन में छात्रवृत्ति की अंतिम तिथि। अभी आवेदन करें।"
- "आपके लिए 5 नई नौकरियां उपलब्ध हैं। देखें?"

**5. Memory Agent**

**Model:** Claude 3.5 Haiku

**Purpose:** Manage conversation context and user history

**Tools Available:**
- `store_context(session_id, context)`: Save conversation state
- `retrieve_context(session_id)`: Load previous context
- `get_user_history(user_id)`: Fetch past applications, interactions
- `update_user_profile(user_id, updates)`: Modify user data

**Workflow:**
1. After each conversation turn, store context in DynamoDB
2. When user returns, retrieve last session
3. Resume conversation: "Welcome back! Last time you were applying for MUDRA loan. Want to continue?"
4. Provide personalized responses based on history

**Context Structure:**
```json
{
  "session_id": "sess-12345",
  "user_id": "user-67890",
  "language": "hi",
  "current_intent": "apply_mudra_loan",
  "collected_data": {
    "name": "Ramesh Kumar",
    "age": 42,
    "documents_uploaded": ["aadhaar", "bank_passbook"]
  },
  "next_step": "fill_form",
  "timestamp": "2026-02-11T10:30:00Z"
}
```


---

## 4. AWS Architecture (Detailed Service Mapping)

### 4.1 Compute Services

**Amazon Connect**
- **Purpose**: Cloud contact center for voice calls
- **Configuration**: 
  - Toll-free number: +91-1800-XXX-VAANI
  - Contact flow with language selection
  - Media streaming enabled
  - Call recording optional
- **Integration**: Streams audio to Kinesis Video Streams
- **Cost**: $0.018 per minute (estimated ₹1.5 per minute)

**AWS Lambda**
- **Purpose**: Serverless compute for all business logic
- **Functions**: 15+ Lambda functions (see Backend Layer)
- **Runtime**: Python 3.12
- **Triggers**: API Gateway, SQS, EventBridge, S3, Kinesis
- **Cost**: Free tier covers 1M requests/month

**Amazon ECS Fargate**
- **Purpose**: Containerized browser automation
- **Task Definition**: 
  - Image: Custom Docker with Playwright + Chrome
  - CPU: 2 vCPU
  - Memory: 4 GB
  - Networking: VPC with NAT Gateway
- **Launch Type**: Fargate (serverless containers)
- **Cost**: $0.04 per vCPU-hour + $0.004 per GB-hour

### 4.2 AI & Machine Learning Services

**AWS Bedrock**
- **Purpose**: Foundation models for reasoning and generation
- **Models Used**:
  - **Claude 3.5 Sonnet** (anthropic.claude-3-5-sonnet-20250514): 
    - Orchestrator Agent, Scheme Agent, Navigator Agent
    - 200K context window
    - Vision capability for CAPTCHA solving
  - **Claude 3.5 Haiku** (anthropic.claude-3-5-haiku-20250514):
    - Notification Agent, Memory Agent
    - Fast, cost-efficient for simple tasks
- **Configuration**:
  - Region: ap-south-1 (Mumbai)
  - Inference: On-demand (no provisioned throughput)
  - Guardrails: Content filtering enabled
- **Cost**: 
  - Sonnet: $3 per 1M input tokens, $15 per 1M output tokens
  - Haiku: $0.25 per 1M input tokens, $1.25 per 1M output tokens

**AWS Bedrock Agents**
- **Purpose**: Multi-agent orchestration framework
- **Configuration**:
  - Agent name: VaaniSetu-Orchestrator
  - Foundation model: Claude 3.5 Sonnet
  - Action groups: 5 (SchemeSearch, DocumentProcess, FormFill, Notify, Memory)
  - Knowledge bases: 1 (Schemes-KB)
- **Features**:
  - Automatic prompt engineering
  - Tool calling (function invocation)
  - Memory management
  - Session persistence

**AWS Bedrock Knowledge Bases**
- **Purpose**: RAG (Retrieval Augmented Generation) for scheme information
- **Data Source**: S3 bucket with scheme PDFs
- **Vector Store**: Amazon OpenSearch Serverless
- **Embedding Model**: Titan Embeddings G1 - Text
- **Configuration**:
  - Chunking: 300 tokens with 20% overlap
  - Retrieval: Top 5 results
  - Metadata filtering: By state, category, deadline

**Amazon Textract**
- **Purpose**: OCR for document data extraction
- **APIs Used**:
  - `AnalyzeDocument`: Extract key-value pairs from forms
  - `AnalyzeID`: Extract data from Aadhaar, PAN cards
- **Features**:
  - Supports Hindi, Tamil, Telugu text
  - Table extraction (for bank passbooks)
  - Signature detection
- **Cost**: $1.50 per 1,000 pages (AnalyzeDocument)

**Amazon Rekognition** (Optional)
- **Purpose**: Image quality validation, face matching
- **Use Cases**:
  - Validate document image quality before OCR
  - Match user photo with Aadhaar photo
- **Cost**: $1 per 1,000 images

### 4.3 Data & Storage Services

**Amazon Aurora Serverless v2 (PostgreSQL)**
- **Purpose**: Relational database for structured data
- **Tables**: schemes, jobs, applications, users (master data)
- **Configuration**:
  - Engine: PostgreSQL 15.4
  - Capacity: 0.5 - 2 ACUs (auto-scaling)
  - Multi-AZ: No (single AZ for cost)
  - Encryption: Enabled (KMS)
- **Backup**: Automated daily backups, 7-day retention
- **Cost**: $0.12 per ACU-hour (estimated ₹50-200/day)

**Amazon DynamoDB**
- **Purpose**: NoSQL database for high-speed reads/writes
- **Tables**:
  - `sessions`: Conversation state (TTL: 24 hours)
  - `documents`: Document metadata
  - `notifications`: Scheduled notifications
  - `user_profiles`: User demographic data
- **Configuration**:
  - Capacity mode: On-demand (pay per request)
  - Encryption: AWS owned key
  - Point-in-time recovery: Enabled
- **Cost**: $1.25 per million write requests, $0.25 per million read requests

**Amazon S3**
- **Purpose**: Object storage for documents, logs, data lake
- **Buckets**:
  - `vaanisetu-documents-dev`: User uploaded documents
  - `vaanisetu-schemes-kb`: Scheme PDFs for Knowledge Base
  - `vaanisetu-logs`: Application logs archive
  - `vaanisetu-data-lake`: Analytics data (Parquet format)
- **Configuration**:
  - Encryption: SSE-KMS (customer managed key)
  - Versioning: Enabled for documents bucket
  - Lifecycle: Delete documents after 90 days
  - Access: IAM role-based, bucket policies
- **Cost**: $0.023 per GB-month (first 50 TB)

**Amazon OpenSearch Serverless**
- **Purpose**: Vector database for Bedrock Knowledge Base
- **Configuration**:
  - Collection: vaanisetu-schemes-vectors
  - Capacity: Auto-scaling (0.5 - 2 OCUs)
  - Encryption: Enabled
- **Cost**: $0.24 per OCU-hour

### 4.4 Integration & Messaging Services

**Amazon API Gateway**
- **Purpose**: REST API for web and WhatsApp integrations
- **Endpoints**:
  - `POST /whatsapp/webhook`: Receive WhatsApp messages
  - `POST /documents/upload`: Upload documents from web
  - `GET /applications/{id}`: Get application status
  - `POST /voice/callback`: Voice session callbacks
- **Configuration**:
  - Stage: dev, prod
  - Throttling: 100 requests/second per user
  - CORS: Enabled for web frontend
  - Authentication: IAM, API keys
- **Cost**: $3.50 per million requests

**Amazon SQS**
- **Purpose**: Message queuing for asynchronous processing
- **Queues**:
  - `whatsapp-incoming-queue`: FIFO queue for message ordering
  - `document-processing-queue`: Standard queue
  - `notification-queue`: Standard queue
  - `form-submission-queue`: Standard queue
- **Configuration**:
  - Visibility timeout: 30 seconds - 15 minutes
  - Message retention: 4 days
  - Dead letter queue: Enabled (after 3 retries)
- **Cost**: $0.40 per million requests (first 1M free)

**Amazon EventBridge**
- **Purpose**: Event bus for event-driven architecture
- **Rules**:
  - `application-status-changed`: Trigger notification Lambda
  - `deadline-approaching`: Trigger reminder Lambda
  - `daily-job-matching`: Trigger job recommendation Lambda (cron)
- **Configuration**:
  - Event bus: default
  - Archive: 7 days retention
- **Cost**: $1 per million events

**Amazon SNS**
- **Purpose**: SMS notifications
- **Topics**:
  - `vaanisetu-alerts`: Critical alerts
  - `vaanisetu-reminders`: Deadline reminders
- **Configuration**:
  - SMS type: Transactional (high priority)
  - Sender ID: VAANISETU
- **Cost**: $0.00645 per SMS in India

**Amazon Kinesis Video Streams**
- **Purpose**: Real-time audio streaming from Amazon Connect
- **Configuration**:
  - Stream: vaanisetu-call-audio-stream
  - Retention: 24 hours
  - Encryption: Enabled
- **Cost**: $0.0085 per GB ingested


### 4.5 Security & Compliance Services

**AWS IAM (Identity and Access Management)**
- **Purpose**: Access control for all AWS resources
- **Roles**:
  - `VaaniSetuLambdaExecutionRole`: Minimal permissions for Lambda functions
  - `VaaniSetuFargateTaskRole`: Permissions for ECS tasks
  - `VaaniSetuBedrockAgentRole`: Permissions for Bedrock to invoke Lambda
- **Policies**: Least privilege principle (only required permissions)
- **MFA**: Enabled for admin console access

**AWS KMS (Key Management Service)**
- **Purpose**: Encryption key management
- **Keys**:
  - `vaanisetu-documents-key`: For S3 document encryption
  - `vaanisetu-db-key`: For Aurora and DynamoDB encryption
  - `vaanisetu-logs-key`: For CloudWatch Logs encryption
- **Configuration**:
  - Key type: Symmetric
  - Key rotation: Enabled (annual)
  - Key policy: Restrict to specific IAM roles

**AWS Secrets Manager**
- **Purpose**: Store API keys and credentials
- **Secrets**:
  - `bhashini-api-key`: Bhashini API credentials
  - `whatsapp-api-token`: Meta WhatsApp Business API token
  - `db-master-password`: Aurora master password
  - `aadhaar-hash-salt`: Salt for Aadhaar hashing
- **Configuration**:
  - Encryption: KMS
  - Rotation: Enabled for database passwords (30 days)
  - Access: IAM role-based

**AWS WAF (Web Application Firewall)**
- **Purpose**: Protect API Gateway from attacks
- **Rules**:
  - Rate limiting: 100 requests/minute per IP
  - Geo-blocking: Allow only India
  - SQL injection protection
  - XSS protection
- **Configuration**:
  - Web ACL: vaanisetu-api-protection
  - Associated with: API Gateway

**Amazon GuardDuty**
- **Purpose**: Threat detection
- **Configuration**:
  - Enabled for VPC, S3, IAM
  - Findings sent to SNS topic for alerts
- **Cost**: $0.50 per million CloudTrail events analyzed

**AWS Security Hub**
- **Purpose**: Centralized security monitoring
- **Standards**: AWS Foundational Security Best Practices
- **Integrations**: GuardDuty, IAM Access Analyzer, Secrets Manager

### 4.6 DevOps & Monitoring Services

**Amazon CloudWatch**
- **Purpose**: Logging, metrics, and monitoring
- **Log Groups**:
  - `/aws/lambda/vaanisetu-*`: All Lambda function logs
  - `/aws/connect/vaanisetu`: Amazon Connect call logs
  - `/aws/ecs/vaanisetu-browser`: Fargate task logs
- **Metrics**:
  - Custom metrics: Call duration, agent latency, OCR accuracy
  - Lambda metrics: Invocations, errors, duration, throttles
  - API Gateway metrics: Request count, latency, 4xx/5xx errors
- **Alarms**:
  - Error rate > 5%: Alert via SNS
  - Latency > 5 seconds: Alert via SNS
  - Cost > ₹10,000/day: Alert via email
- **Dashboards**: Real-time metrics visualization
- **Cost**: $0.50 per GB ingested, $0.03 per GB stored

**AWS X-Ray**
- **Purpose**: Distributed tracing for debugging
- **Configuration**:
  - Enabled for Lambda, API Gateway, ECS
  - Sampling rate: 10% (to reduce cost)
- **Features**:
  - Service map: Visualize request flow
  - Trace analysis: Identify bottlenecks
  - Error analysis: Root cause identification
- **Cost**: $5 per million traces recorded

**Amazon QuickSight** (Optional)
- **Purpose**: Business intelligence dashboards
- **Data Sources**: S3 data lake, Aurora, DynamoDB
- **Dashboards**:
  - User analytics: DAU, MAU, retention
  - Application metrics: Success rate, time to completion
  - Impact metrics: Schemes accessed, money disbursed
- **Cost**: $9 per user per month (author), $0.30 per session (reader)

**AWS CodePipeline + CodeBuild**
- **Purpose**: CI/CD automation
- **Pipeline Stages**:
  1. Source: GitHub repository
  2. Build: CodeBuild (run tests, build Docker images)
  3. Deploy: Update Lambda functions, ECS task definitions
- **Configuration**:
  - Trigger: On push to main branch
  - Approval: Manual approval for production
- **Cost**: $1 per active pipeline per month

**AWS CloudFormation / CDK**
- **Purpose**: Infrastructure as Code
- **Stacks**:
  - `vaanisetu-network`: VPC, subnets, security groups
  - `vaanisetu-data`: Aurora, DynamoDB, S3
  - `vaanisetu-compute`: Lambda, ECS, Connect
  - `vaanisetu-ai`: Bedrock agents, Knowledge Bases
- **Benefits**:
  - Reproducible deployments
  - Version control for infrastructure
  - Easy rollback on failure

### 4.7 Cost Optimization Services

**AWS Cost Explorer**
- **Purpose**: Analyze and forecast costs
- **Reports**:
  - Daily cost breakdown by service
  - Cost per user (tagged resources)
  - Forecast for next 30 days

**AWS Budgets**
- **Purpose**: Set cost alerts
- **Budgets**:
  - Monthly budget: ₹10,000
  - Alert at 80% threshold
  - Alert at 100% threshold

**AWS Compute Optimizer**
- **Purpose**: Right-size Lambda and Fargate resources
- **Recommendations**: Reduce memory for underutilized functions


---

## 5. Data Flow (Step-by-Step)

### 5.1 Voice Interaction Flow (Complete Journey)

**Scenario:** User calls to apply for PM-KISAN scheme

**Step 1: Call Initiation**
- User dials toll-free number: 1800-XXX-VAANI
- Call routed to Amazon Connect
- Connect assigns unique Contact ID: `contact-abc123`

**Step 2: Language Selection**
- Contact Flow plays welcome message (default Hindi)
- "Press 1 for Hindi, 2 for Tamil, 3 for Telugu, or say your language"
- User presses 1 or says "Hindi"
- Language preference stored in DynamoDB: `{contact_id: "contact-abc123", language: "hi"}`

**Step 3: Media Streaming Setup**
- Contact Flow executes "Start Media Streaming" block
- Audio streamed to Kinesis Video Streams: `vaanisetu-call-audio-stream`
- Lambda function `VoiceSessionManager` triggered with:
  - Contact ID
  - Caller phone number: +919876543210
  - Language: Hindi

**Step 4: Audio Processing**
- Lambda `KinesisAudioProcessor` consumes audio fragments
- Audio decoded from PCMU to PCM, resampled to 16kHz
- Audio chunks sent to Bhashini WebSocket (STT)
- Bhashini returns interim transcripts: "मुझे पीएम..." → "मुझे पीएम किसान..."
- Final transcript: "मुझे पीएम किसान के बारे में जानकारी चाहिए"

**Step 5: AI Agent Invocation**
- Transcript sent to Bedrock Orchestrator Agent
- Agent prompt includes:
  - User transcript
  - User profile (fetched from DynamoDB by phone number)
  - Conversation history (last 5 turns)
- Agent reasoning:
  - Intent: User wants information about PM-KISAN scheme
  - Action: Route to SchemeAgent for details

**Step 6: Scheme Agent Processing**
- SchemeAgent invoked with query: "PM-KISAN"
- Agent searches Bedrock Knowledge Base (RAG)
- Retrieves PM-KISAN scheme document
- Checks user eligibility:
  - User profile: Farmer, 2 hectares land, age 42
  - Eligibility: ✓ (farmer with <2 hectares)
- Generates response: "पीएम किसान योजना के तहत आपको साल में 6,000 रुपये मिलेंगे..."

**Step 7: Text-to-Speech**
- Response text sent to Bhashini TTS WebSocket
- Bhashini synthesizes audio (Hindi female voice)
- Audio streamed back to Lambda

**Step 8: Audio Playback**
- Lambda injects audio into Kinesis Video Stream (TO_CUSTOMER track)
- Amazon Connect plays audio to user
- User hears: "पीएम किसान योजना के तहत..."

**Step 9: Follow-up Conversation**
- User responds: "मैं आवेदन करना चाहता हूं" (I want to apply)
- Steps 4-8 repeat
- Orchestrator Agent decides: Route to DocumentAgent
- Agent asks: "कृपया अपना आधार कार्ड और बैंक पासबुक की फोटो WhatsApp पर भेजें"

**Step 10: Session Persistence**
- Conversation state saved to DynamoDB:
  ```json
  {
    "session_id": "sess-12345",
    "user_id": "user-67890",
    "contact_id": "contact-abc123",
    "language": "hi",
    "current_intent": "apply_pm_kisan",
    "next_step": "upload_documents",
    "timestamp": "2026-02-11T10:30:00Z"
  }
  ```

**Step 11: Call Termination**
- User hangs up or says "धन्यवाद" (Thank you)
- Lambda closes WebSocket connections
- Call summary stored in S3: `s3://vaanisetu-logs/calls/2026/02/11/contact-abc123.json`
- CloudWatch metrics updated: call_duration, turns, intent

### 5.2 Document Upload & Processing Flow

**Scenario:** User uploads Aadhaar card via WhatsApp

**Step 1: Image Upload**
- User sends image to VaaniSetu WhatsApp number
- Meta WhatsApp API receives image
- Meta uploads image to their CDN
- Webhook POST sent to API Gateway:
  ```json
  {
    "messages": [{
      "from": "919876543210",
      "type": "image",
      "image": {
        "id": "media-xyz789",
        "mime_type": "image/jpeg"
      }
    }]
  }
  ```

**Step 2: Webhook Processing**
- API Gateway routes to Lambda `WhatsAppWebhookHandler`
- Lambda validates webhook signature (security)
- Lambda downloads image from Meta API using media ID
- Image stored in S3: `s3://vaanisetu-documents-dev/user-67890/aadhaar/2026-02-11-10-35-00.jpg`
- Message enqueued to SQS: `document-processing-queue`

**Step 3: Document Processing**
- Lambda `DocumentProcessor` consumes SQS message
- Lambda invokes Amazon Textract `AnalyzeID` API:
  ```python
  response = textract.analyze_id(
      DocumentPages=[{
          'S3Object': {
              'Bucket': 'vaanisetu-documents-dev',
              'Name': 'user-67890/aadhaar/2026-02-11-10-35-00.jpg'
          }
      }]
  )
  ```

**Step 4: Data Extraction**
- Textract returns structured data:
  ```json
  {
    "IdentityDocuments": [{
      "IdentityDocumentFields": [
        {"Type": "FIRST_NAME", "ValueDetection": {"Text": "Ramesh"}},
        {"Type": "LAST_NAME", "ValueDetection": {"Text": "Kumar"}},
        {"Type": "DATE_OF_BIRTH", "ValueDetection": {"Text": "15/08/1982"}},
        {"Type": "ID_NUMBER", "ValueDetection": {"Text": "1234 5678 9012"}}
      ]
    }]
  }
  ```

**Step 5: Data Validation**
- Lambda invokes DocumentAgent (Bedrock)
- Agent validates:
  - Aadhaar number format: 12 digits
  - Verhoeff checksum: ✓
  - Date format: DD/MM/YYYY
- Agent structures data:
  ```json
  {
    "document_type": "aadhaar",
    "name": "Ramesh Kumar",
    "dob": "1982-08-15",
    "aadhaar_number": "1234 5678 9012",
    "confidence": 0.98
  }
  ```

**Step 6: User Confirmation**
- Lambda sends WhatsApp message with extracted data:
  - "आपका नाम: Ramesh Kumar"
  - "जन्म तिथि: 15/08/1982"
  - "आधार नंबर: XXXX XXXX 9012"
  - "क्या यह सही है? हां/ना"
- Interactive buttons: [हां] [ना]

**Step 7: Data Storage**
- User clicks "हां" (Yes)
- Lambda stores in DynamoDB:
  ```json
  {
    "user_id": "user-67890",
    "document_id": "doc-aadhaar-123",
    "document_type": "aadhaar",
    "s3_url": "s3://vaanisetu-documents-dev/user-67890/aadhaar/...",
    "extracted_data": {
      "name": "Ramesh Kumar",
      "dob": "1982-08-15",
      "aadhaar_hash": "sha256_hash_here"
    },
    "verification_status": "verified",
    "uploaded_at": "2026-02-11T10:35:00Z"
  }
  ```
- Aadhaar number hashed with SHA-256 + salt (never stored in plain text)

**Step 8: Next Steps**
- Lambda sends WhatsApp message:
  - "बहुत अच्छा! अब बैंक पासबुक की फोटो भेजें।"
  - (Great! Now send bank passbook photo.)

### 5.3 Form Filling & Submission Flow

**Scenario:** Auto-fill PM-KISAN application form

**Step 1: Form Filling Request**
- User confirms: "हां, फॉर्म भरें" (Yes, fill the form)
- Orchestrator Agent routes to NavigatorAgent
- Lambda `FormFillerOrchestrator` triggered
- Lambda sends message to SQS: `form-submission-queue`

**Step 2: ECS Task Launch**
- SQS message consumed by ECS service
- ECS launches Fargate task:
  - Task definition: `vaanisetu-browser-automation`
  - Container: Playwright + Chrome headless
  - Environment variables: User data, form URL

**Step 3: Browser Automation**
- Playwright script starts:
  ```python
  browser = playwright.chromium.launch(headless=True)
  page = browser.new_page()
  page.goto('https://demo-portal.vaanisetu.in/pm-kisan-form')
  ```

**Step 4: Form Field Identification**
- NavigatorAgent (Claude 3.5 Sonnet) analyzes page DOM
- Identifies form fields:
  - `input[name="applicant_name"]`
  - `input[name="dob"]`
  - `input[name="aadhaar"]`
  - `select[name="state"]`
  - `input[name="bank_account"]`

**Step 5: Data Filling**
- Agent fills fields with user data from DynamoDB:
  ```python
  page.fill('input[name="applicant_name"]', 'Ramesh Kumar')
  page.fill('input[name="dob"]', '15/08/1982')
  page.fill('input[name="aadhaar"]', '1234 5678 9012')
  page.select_option('select[name="state"]', 'Bihar')
  page.fill('input[name="bank_account"]', '1234567890')
  ```

**Step 6: CAPTCHA Solving**
- Page has CAPTCHA: `<img src="/captcha/abc123.png">`
- Agent captures CAPTCHA image
- Sends to Claude 3.5 Sonnet (vision):
  - Prompt: "What text is shown in this CAPTCHA image?"
  - Response: "7K3M9"
- Agent fills CAPTCHA field: `page.fill('input[name="captcha"]', '7K3M9')`

**Step 7: Preview & Confirmation**
- Agent takes screenshot of filled form
- Screenshot uploaded to S3
- Lambda sends WhatsApp message:
  - "यह आपका भरा हुआ फॉर्म है। [Screenshot]"
  - "सब सही है? सबमिट करें?"
  - Buttons: [सबमिट करें] [रद्द करें]

**Step 8: Form Submission**
- User clicks "सबमिट करें" (Submit)
- Agent clicks submit button: `page.click('button[type="submit"]')`
- Waits for confirmation page: `page.wait_for_selector('.success-message')`

**Step 9: Acknowledgment Capture**
- Agent extracts acknowledgment number from page:
  - Text: "आपका आवेदन सफलतापूर्वक जमा हो गया। संदर्भ संख्या: PMKISAN2026BH123456"
  - Regex: `PMKISAN\d{10}`
  - Captured: `PMKISAN2026BH123456`

**Step 10: Result Storage**
- Agent stores application in DynamoDB:
  ```json
  {
    "application_id": "app-12345",
    "user_id": "user-67890",
    "scheme_id": "scheme-pm-kisan",
    "reference_number": "PMKISAN2026BH123456",
    "status": "submitted",
    "submitted_at": "2026-02-11T11:00:00Z",
    "form_data": {...},
    "screenshot_url": "s3://..."
  }
  ```

**Step 11: User Notification**
- Lambda sends WhatsApp message:
  - "बधाई हो! आपका PM-KISAN आवेदन जमा हो गया।"
  - "संदर्भ संख्या: PMKISAN2026BH123456"
  - "SMS भी भेजा गया है।"
- Lambda sends SMS via SNS with same message

**Step 12: Proactive Tracking Setup**
- NotificationAgent schedules follow-up:
  - Check status in 7 days
  - Send reminder if no update in 30 days
- EventBridge rule created: `check-status-app-12345`


---

## 6. Model Strategy

### 6.1 Pretrained Models Only (No Training)

**Hackathon Constraint:** Use pretrained SOTA models under 1GB each, inference only

**Models Used:**

**1. Anthropic Claude 3.5 Sonnet (via AWS Bedrock)**
- **Size:** Not disclosed by Anthropic, but accessed via API (no local storage)
- **Purpose:** Primary reasoning engine for all AI agents
- **Capabilities:**
  - 200K token context window (handles long conversations)
  - Multilingual understanding (Hindi, Tamil, Telugu, English)
  - Vision capability (for CAPTCHA solving, document analysis)
  - Function calling (tool use for agent actions)
  - Chain-of-thought reasoning
- **Use Cases:**
  - Orchestrator Agent: Intent classification, task routing
  - Scheme Agent: Eligibility reasoning, recommendation generation
  - Navigator Agent: DOM analysis, form field identification
  - Document Agent: Data validation, structuring

**2. Anthropic Claude 3.5 Haiku (via AWS Bedrock)**
- **Size:** Smaller than Sonnet, accessed via API
- **Purpose:** Fast, cost-efficient tasks
- **Capabilities:**
  - Fast inference (<1 second)
  - Good for simple classification and generation
  - Multilingual support
- **Use Cases:**
  - Notification Agent: Message generation
  - Memory Agent: Context summarization
  - Quick responses (greetings, confirmations)

**3. Amazon Titan Embeddings G1 - Text (via AWS Bedrock)**
- **Size:** Not disclosed, accessed via API
- **Purpose:** Generate embeddings for RAG (Knowledge Base)
- **Capabilities:**
  - 1,536-dimensional embeddings
  - Supports English and Hindi
  - Optimized for semantic search
- **Use Cases:**
  - Embed scheme documents for vector search
  - Embed user queries for similarity matching

**4. Bhashini ASR/TTS Models (via API)**
- **Size:** Not disclosed, accessed via API
- **Purpose:** Speech-to-Text and Text-to-Speech for Indian languages
- **Capabilities:**
  - 22 Indian languages + 100 dialects
  - Real-time streaming
  - Code-mixing support (Hinglish, Tanglish)
- **Use Cases:**
  - Voice input transcription
  - Voice output synthesis
- **Fallback:** Amazon Transcribe (Hindi, English) + Amazon Polly

**5. Amazon Textract (Managed Service)**
- **Size:** Not applicable (cloud service)
- **Purpose:** OCR for document data extraction
- **Capabilities:**
  - Form extraction (key-value pairs)
  - Table extraction
  - Identity document analysis (Aadhaar, PAN)
  - Supports Hindi, Tamil, Telugu text
- **Use Cases:**
  - Extract data from uploaded documents
  - Validate document authenticity

### 6.2 Why No Custom Training?

**Reasons:**
1. **Time Constraint:** Hackathon duration (48 hours) insufficient for data collection, labeling, training
2. **Data Availability:** No access to real user data (privacy concerns)
3. **Pretrained Models Suffice:** Claude 3.5 Sonnet already handles Indian languages and complex reasoning
4. **Cost:** Training large models expensive (GPU hours)
5. **Hackathon Rules:** Models must be <1GB each (pretrained models accessed via API don't count)

**Advantages of Pretrained Models:**
- Immediate deployment (no training time)
- State-of-the-art performance out-of-the-box
- Regular updates by model providers (Anthropic, AWS)
- Cost-effective (pay per token, not per GPU hour)

### 6.3 Model Selection Rationale

**Why Claude 3.5 Sonnet?**
- Best-in-class reasoning for complex tasks
- Excellent multilingual support (Hindi, Tamil, Telugu)
- Vision capability (CAPTCHA solving, document analysis)
- Function calling (tool use for agent actions)
- 200K context window (handles long conversations)
- Proven performance on Indian language benchmarks

**Why Claude 3.5 Haiku?**
- 10x faster than Sonnet
- 5x cheaper than Sonnet
- Sufficient for simple tasks (notifications, greetings)
- Reduces overall cost without sacrificing quality

**Why Bhashini over Amazon Transcribe?**
- Government of India initiative (alignment with hackathon theme)
- Better support for Indian dialects (Bhojpuri, Kongu, etc.)
- Free for government-aligned startups
- Fallback to Transcribe if Bhashini unavailable

**Why Textract over Tesseract?**
- Managed service (no infrastructure management)
- Better accuracy on Indian documents (trained on diverse data)
- Supports Hindi, Tamil, Telugu out-of-the-box
- Identity document analysis (Aadhaar, PAN) built-in

### 6.4 Model Performance Expectations

**Claude 3.5 Sonnet:**
- Intent classification accuracy: >95%
- Eligibility reasoning accuracy: >90%
- Response generation quality: High (human-like)
- Latency: 2-4 seconds per request (200-500 tokens output)

**Claude 3.5 Haiku:**
- Simple task accuracy: >90%
- Latency: <1 second per request

**Bhashini ASR:**
- Word Error Rate (WER): <10% for clear speech
- Latency: <3 seconds (real-time streaming)

**Bhashini TTS:**
- Naturalness (MOS): >4.0/5.0
- Latency: <1 second for 10-second speech

**Textract:**
- OCR accuracy: >95% for clear images
- Key-value extraction accuracy: >90%
- Latency: 3-5 seconds per document


---

## 7. Orchestration

### 7.1 Multi-Agent Coordination

**Orchestration Pattern:** Supervisor-Worker

**Supervisor (Orchestrator Agent):**
- Receives all user inputs
- Analyzes intent and context
- Decomposes complex tasks into subtasks
- Delegates subtasks to specialist agents
- Aggregates results from multiple agents
- Generates final response to user

**Workers (Specialist Agents):**
- Each agent has a specific domain expertise
- Agents operate independently (no direct communication)
- Agents report results back to Orchestrator
- Agents can invoke tools (Lambda functions, APIs)

### 7.2 Task Routing Logic

**Intent Classification:**

Orchestrator Agent uses Claude 3.5 Sonnet to classify user intent:

```
User Input: "मुझे मुद्रा लोन चाहिए"
Intent: apply_for_scheme
Sub-intent: mudra_loan
Confidence: 0.95

Routing Decision:
1. Check if user profile exists → MemoryAgent
2. Check scheme eligibility → SchemeAgent
3. Collect required documents → DocumentAgent
4. Fill application form → NavigatorAgent
5. Send confirmation → NotificationAgent
```

**Decision Tree:**

```
User Input
    │
    ├─ Greeting ("नमस्ते") → Orchestrator (direct response)
    │
    ├─ Scheme Query ("PM-KISAN क्या है?") → SchemeAgent
    │
    ├─ Document Upload (image) → DocumentAgent
    │
    ├─ Application Status ("मेरा आवेदन कहां है?") → MemoryAgent + StatusChecker
    │
    ├─ Form Filling ("फॉर्म भरें") → NavigatorAgent
    │
    ├─ Job Search ("नौकरी चाहिए") → OpportunityAgent (not in MVP)
    │
    └─ Complex Query → Multi-agent coordination
```

### 7.3 Agent Communication Protocol

**Message Format (EventBridge):**

```json
{
  "source": "orchestrator-agent",
  "detail-type": "TaskDelegation",
  "detail": {
    "task_id": "task-12345",
    "session_id": "sess-67890",
    "user_id": "user-abc",
    "agent": "scheme-agent",
    "action": "search_schemes",
    "parameters": {
      "user_profile": {
        "age": 42,
        "occupation": "farmer",
        "income": 250000,
        "state": "Bihar"
      },
      "query": "agricultural loans"
    },
    "timeout": 30,
    "priority": "high"
  }
}
```

**Response Format:**

```json
{
  "task_id": "task-12345",
  "agent": "scheme-agent",
  "status": "success",
  "result": {
    "schemes": [
      {
        "name": "PM-KISAN",
        "eligibility_score": 95,
        "benefit": "₹6,000/year"
      },
      {
        "name": "Kisan Credit Card",
        "eligibility_score": 88,
        "benefit": "₹3 lakh loan @ 7%"
      }
    ]
  },
  "execution_time": 2.3,
  "timestamp": "2026-02-11T11:05:00Z"
}
```

### 7.4 Workflow Orchestration (AWS Step Functions)

**Use Case:** Complex multi-step workflows (e.g., complete application process)

**Step Function Definition:**

```json
{
  "Comment": "PM-KISAN Application Workflow",
  "StartAt": "CheckUserProfile",
  "States": {
    "CheckUserProfile": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-south-1:xxx:function:MemoryAgent",
      "Next": "CheckEligibility"
    },
    "CheckEligibility": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-south-1:xxx:function:SchemeAgent",
      "Next": "IsEligible"
    },
    "IsEligible": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.eligibility_score",
          "NumericGreaterThan": 70,
          "Next": "CollectDocuments"
        }
      ],
      "Default": "NotifyIneligible"
    },
    "CollectDocuments": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-south-1:xxx:function:DocumentAgent",
      "Next": "ValidateDocuments"
    },
    "ValidateDocuments": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-south-1:xxx:function:DocumentAgent",
      "Next": "AreDocumentsValid"
    },
    "AreDocumentsValid": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.validation_status",
          "StringEquals": "valid",
          "Next": "FillForm"
        }
      ],
      "Default": "RequestReupload"
    },
    "FillForm": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-south-1:xxx:function:NavigatorAgent",
      "Next": "ConfirmSubmission"
    },
    "ConfirmSubmission": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-south-1:xxx:function:NotificationAgent",
      "End": true
    },
    "NotifyIneligible": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-south-1:xxx:function:NotificationAgent",
      "End": true
    },
    "RequestReupload": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:ap-south-1:xxx:function:NotificationAgent",
      "Next": "CollectDocuments"
    }
  }
}
```

**Benefits:**
- Visual workflow representation
- Automatic retry on failure
- State persistence (resume from failure point)
- Execution history for debugging
- Parallel execution support

### 7.5 Error Handling & Retry Logic

**Retry Strategy:**

**Transient Errors (network, timeout):**
- Retry 3 times with exponential backoff
- Backoff: 1s, 2s, 4s
- If all retries fail, escalate to human agent

**Permanent Errors (invalid data, unauthorized):**
- No retry
- Log error
- Notify user with clear error message

**Example (Lambda Retry Configuration):**

```python
# Lambda function with retry decorator
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type(TransientError)
)
def invoke_bedrock_agent(prompt):
    response = bedrock.invoke_agent(
        agentId='agent-12345',
        sessionId='sess-67890',
        inputText=prompt
    )
    return response
```

**Fallback Mechanisms:**

**Bhashini API Failure:**
- Fallback to Amazon Transcribe (Hindi, English)
- Fallback to Amazon Polly (TTS)
- Notify user: "We're experiencing technical issues. Switching to backup system."

**Bedrock Rate Limit:**
- Queue request in SQS
- Retry after 1 minute
- Use Haiku instead of Sonnet for non-critical tasks

**Textract Failure:**
- Ask user to re-upload with better lighting
- Provide guidance: "Please ensure document is clear and well-lit"
- Manual review option (human agent)

### 7.6 Monitoring & Observability

**CloudWatch Metrics:**

**Agent Performance:**
- `agent.invocations`: Count of agent invocations
- `agent.latency`: Time taken by each agent
- `agent.errors`: Error count per agent
- `agent.success_rate`: Percentage of successful completions

**Workflow Metrics:**
- `workflow.started`: Count of workflows initiated
- `workflow.completed`: Count of successful completions
- `workflow.failed`: Count of failures
- `workflow.duration`: End-to-end time

**Custom Dashboards:**
- Real-time agent activity (which agents are busy)
- Error rate by agent (identify problematic agents)
- Latency distribution (P50, P95, P99)
- Cost per agent invocation

**Alarms:**
- Agent error rate > 5% → SNS alert
- Agent latency > 10 seconds → SNS alert
- Workflow failure rate > 10% → SNS alert

**X-Ray Tracing:**
- Trace request flow across all agents
- Identify bottlenecks (which agent is slow)
- Visualize service map (agent dependencies)


---

## 8. Error Handling

### 8.1 Error Categories

**1. User Errors (Recoverable)**
- Invalid input (e.g., wrong date format)
- Missing information (e.g., forgot to upload document)
- Unclear speech (high WER in transcription)

**Handling:**
- Polite clarification: "मुझे समझ नहीं आया। कृपया फिर से बोलें।" (I didn't understand. Please repeat.)
- Provide examples: "जन्म तिथि इस तरह बोलें: 15 अगस्त 1982"
- Offer alternatives: "आप WhatsApp पर टाइप कर सकते हैं।"

**2. System Errors (Transient)**
- API timeout (Bhashini, Bedrock)
- Network connectivity issues
- Rate limiting (Bedrock, Textract)

**Handling:**
- Automatic retry (3 attempts with exponential backoff)
- Fallback to alternative service (Transcribe instead of Bhashini)
- User notification: "कृपया थोड़ा इंतजार करें, मैं फिर से कोशिश कर रहा हूं।"

**3. Data Errors (Validation Failures)**
- Invalid Aadhaar number (checksum failure)
- Expired document (e.g., old certificate)
- Mismatched data (name on Aadhaar ≠ name on PAN)

**Handling:**
- Clear error message: "आधार नंबर गलत है। कृपया जांचें।"
- Request correction: "कृपया सही आधार नंबर बोलें।"
- Offer help: "क्या आपको आधार नंबर ढूंढने में मदद चाहिए?"

**4. Business Logic Errors (Ineligibility)**
- User doesn't meet scheme criteria (e.g., age > 60 for youth scheme)
- Duplicate application (already applied)
- Scheme deadline passed

**Handling:**
- Empathetic explanation: "आप इस योजना के लिए योग्य नहीं हैं क्योंकि..."
- Suggest alternatives: "लेकिन आप इन 3 योजनाओं के लिए योग्य हैं..."
- Provide guidance: "अगले साल फिर से आवेदन कर सकते हैं।"

**5. Critical Errors (Unrecoverable)**
- Database connection failure
- AWS service outage
- Security breach detected

**Handling:**
- Graceful degradation: "हम तकनीकी समस्या का सामना कर रहे हैं।"
- Human escalation: "कृपया 1 घंटे बाद फिर से कॉल करें या हमारे एजेंट से बात करें।"
- Incident logging: Alert DevOps team via PagerDuty

### 8.2 Speech Recognition Error Handling

**Low Confidence Transcription:**

```python
if transcript_confidence < 0.6:
    response = "मुझे आपकी बात स्पष्ट नहीं सुनाई दी। कृपया फिर से बोलें।"
    play_audio(response)
    retry_count += 1
    
    if retry_count > 2:
        response = "क्या आप WhatsApp पर टाइप करना पसंद करेंगे?"
        offer_alternative_channel()
```

**Background Noise Detection:**

```python
if noise_level > 60_dB:
    response = "बहुत शोर है। कृपया शांत जगह पर जाएं या WhatsApp पर संदेश भेजें।"
    play_audio(response)
```

**Unsupported Language:**

```python
if detected_language not in ['hi', 'ta', 'te', 'en']:
    response = "Sorry, I currently support Hindi, Tamil, Telugu, and English. Which language would you prefer?"
    play_audio(response)
```

### 8.3 Document Processing Error Handling

**Poor Image Quality:**

```python
if image_quality_score < 0.7:
    response = "फोटो साफ नहीं है। कृपया अच्छी रोशनी में फिर से फोटो लें।"
    send_whatsapp_message(response)
    send_example_image()  # Show good vs bad example
```

**OCR Extraction Failure:**

```python
try:
    extracted_data = textract.analyze_id(image)
except ExtractionError:
    response = "दस्तावेज़ पढ़ने में समस्या हुई। कृपया दूसरी फोटो भेजें।"
    send_whatsapp_message(response)
    
    # Offer manual entry
    response += "\nया आप मुझे बोलकर जानकारी दे सकते हैं।"
```

**Data Validation Failure:**

```python
if not validate_aadhaar_checksum(aadhaar_number):
    response = "आधार नंबर गलत है। कृपया जांचें और फिर से भेजें।"
    send_whatsapp_message(response)
    
    # Provide format guidance
    response += "\nआधार नंबर 12 अंकों का होना चाहिए। उदाहरण: 1234 5678 9012"
```

### 8.4 Form Filling Error Handling

**Portal Unavailable:**

```python
try:
    page.goto(portal_url, timeout=30000)
except TimeoutError:
    response = "सरकारी वेबसाइट अभी उपलब्ध नहीं है। मैं 10 मिनट बाद फिर से कोशिश करूंगा।"
    send_notification(response)
    schedule_retry(delay=600)  # 10 minutes
```

**CAPTCHA Solving Failure:**

```python
captcha_text = solve_captcha(captcha_image)
page.fill('input[name="captcha"]', captcha_text)
page.click('button[type="submit"]')

if page.locator('.error-message').is_visible():
    # CAPTCHA was wrong, retry
    retry_count += 1
    if retry_count < 3:
        captcha_text = solve_captcha(captcha_image)
    else:
        # Manual intervention needed
        response = "CAPTCHA हल करने में समस्या हो रही है। कृपया बाद में कोशिश करें।"
        send_notification(response)
```

**Form Validation Error:**

```python
if page.locator('.validation-error').is_visible():
    error_message = page.locator('.validation-error').text_content()
    
    # Parse error and ask user for correction
    if 'invalid date' in error_message.lower():
        response = "जन्म तिथि गलत है। कृपया सही तिथि बोलें।"
        ask_user_for_correction('dob')
```

### 8.5 Notification Delivery Failure

**SMS Delivery Failure:**

```python
try:
    sns.publish(PhoneNumber=user_phone, Message=message)
except SNSError as e:
    # Fallback to WhatsApp
    send_whatsapp_message(user_phone, message)
    log_error(f"SMS failed for {user_phone}, sent via WhatsApp")
```

**WhatsApp Delivery Failure:**

```python
try:
    send_whatsapp_message(user_phone, message)
except WhatsAppAPIError as e:
    # Fallback to SMS
    sns.publish(PhoneNumber=user_phone, Message=message)
    log_error(f"WhatsApp failed for {user_phone}, sent via SMS")
```

### 8.6 Logging & Alerting

**Error Logging Structure:**

```json
{
  "timestamp": "2026-02-11T11:30:00Z",
  "level": "ERROR",
  "service": "document-agent",
  "error_type": "OCRExtractionError",
  "error_message": "Failed to extract Aadhaar number",
  "user_id": "user-67890",
  "session_id": "sess-12345",
  "document_id": "doc-aadhaar-123",
  "retry_count": 2,
  "stack_trace": "...",
  "context": {
    "image_quality": 0.65,
    "image_size": "1024x768",
    "file_format": "jpeg"
  }
}
```

**Alert Thresholds:**

- Error rate > 5% in 5 minutes → SNS alert to DevOps
- Critical error (database down) → Immediate PagerDuty alert
- User-facing error > 10 occurrences → Slack notification
- Cost spike > ₹5,000/hour → Email alert to admin


---

## 9. Security

### 9.1 Security Principles

**1. Defense in Depth**
- Multiple layers of security (network, application, data)
- No single point of failure
- Assume breach mentality (limit blast radius)

**2. Least Privilege**
- IAM roles with minimal permissions
- Service-to-service authentication
- No hardcoded credentials

**3. Encryption Everywhere**
- Data at rest: AES-256 (KMS)
- Data in transit: TLS 1.3
- End-to-end encryption for sensitive data

**4. Privacy by Design**
- Data minimization (collect only what's needed)
- Purpose limitation (use data only for stated purpose)
- User consent (explicit opt-in)
- Right to deletion (user can delete their data)

### 9.2 Network Security

**VPC Architecture:**

```
VPC: 10.0.0.0/16

Public Subnets (10.0.1.0/24, 10.0.2.0/24):
- API Gateway
- NAT Gateway
- Application Load Balancer

Private Subnets (10.0.10.0/24, 10.0.11.0/24):
- Lambda functions
- ECS Fargate tasks
- Aurora database

Isolated Subnets (10.0.20.0/24, 10.0.21.0/24):
- Sensitive data processing
- Aadhaar validation
```

**Security Groups:**

```
Lambda Security Group:
- Inbound: None (Lambda doesn't accept inbound)
- Outbound: 
  - 443 to Aurora SG (database queries)
  - 443 to 0.0.0.0/0 (API calls to Bedrock, Textract)

Aurora Security Group:
- Inbound: 
  - 5432 from Lambda SG only
- Outbound: None

Fargate Security Group:
- Inbound: None
- Outbound:
  - 443 to 0.0.0.0/0 (browser automation)
  - 443 to Aurora SG (database queries)
```

**Network ACLs:**
- Deny all inbound by default
- Allow only HTTPS (443) from trusted sources
- Allow outbound to whitelisted government domains only

**AWS WAF Rules:**

```yaml
Rules:
  - Name: RateLimitRule
    Priority: 1
    Action: Block
    Condition: Requests > 100 per minute per IP
  
  - Name: GeoBlockingRule
    Priority: 2
    Action: Block
    Condition: Country not in [IN]
  
  - Name: SQLInjectionRule
    Priority: 3
    Action: Block
    Condition: SQL injection pattern detected
  
  - Name: XSSRule
    Priority: 4
    Action: Block
    Condition: XSS pattern detected
```

### 9.3 Identity & Access Management

**IAM Roles (Least Privilege):**

**Lambda Execution Role:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:ap-south-1:*:log-group:/aws/lambda/vaanisetu-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:ap-south-1:*:table/vaanisetu-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::vaanisetu-documents-dev/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeAgent"
      ],
      "Resource": "arn:aws:bedrock:ap-south-1:*:agent/*"
    }
  ]
}
```

**Bedrock Agent Role:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:InvokeFunction"
      ],
      "Resource": "arn:aws:lambda:ap-south-1:*:function:vaanisetu-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:Retrieve"
      ],
      "Resource": "arn:aws:bedrock:ap-south-1:*:knowledge-base/*"
    }
  ]
}
```

**User Authentication:**
- Phone number as primary identifier
- OTP-based login (6-digit, 5-minute expiry)
- No passwords (reduces attack surface)
- Optional Aadhaar authentication via DigiLocker

### 9.4 Data Protection

**Encryption at Rest:**

**S3 Buckets:**
```yaml
Bucket: vaanisetu-documents-dev
Encryption: SSE-KMS
KMS Key: arn:aws:kms:ap-south-1:xxx:key/vaanisetu-documents-key
Key Policy:
  - Allow: Lambda execution role
  - Deny: All others
```

**Aurora Database:**
```yaml
Encryption: Enabled
KMS Key: arn:aws:kms:ap-south-1:xxx:key/vaanisetu-db-key
Backup Encryption: Enabled
```

**DynamoDB:**
```yaml
Encryption: AWS owned key (for cost efficiency)
Sensitive Tables: Customer managed key
```

**Encryption in Transit:**
- All API calls: TLS 1.3
- Amazon Connect: Encrypted voice streams
- Database connections: SSL/TLS enforced

**Sensitive Data Handling:**

**Aadhaar Number:**
```python
import hashlib
import os

def hash_aadhaar(aadhaar_number):
    # Fetch salt from Secrets Manager
    salt = get_secret('aadhaar-hash-salt')
    
    # Hash with SHA-256
    hashed = hashlib.sha256(f"{aadhaar_number}{salt}".encode()).hexdigest()
    
    # Never store plain text
    return hashed

# Usage
aadhaar_plain = "1234 5678 9012"
aadhaar_hashed = hash_aadhaar(aadhaar_plain)
store_in_db(aadhaar_hashed)  # Only hash stored

# Logging
log.info(f"Aadhaar processed: XXXX XXXX {aadhaar_plain[-4:]}")  # Mask in logs
```

**PAN Number:**
```python
from cryptography.fernet import Fernet

def encrypt_pan(pan_number):
    # Fetch encryption key from KMS
    key = get_kms_data_key()
    cipher = Fernet(key)
    
    # Encrypt
    encrypted = cipher.encrypt(pan_number.encode())
    return encrypted

# Usage
pan_plain = "ABCDE1234F"
pan_encrypted = encrypt_pan(pan_plain)
store_in_db(pan_encrypted)
```

**Bank Account Number:**
```python
def tokenize_account(account_number):
    # Store only last 4 digits + token
    token = generate_random_token()
    last_4 = account_number[-4:]
    
    # Store mapping in secure vault
    store_in_vault(token, account_number)
    
    # Store token in main database
    return f"TOKEN-{token}-{last_4}"

# Display to user
display = f"Account: XXXXXX{last_4}"
```

### 9.5 Application Security

**Input Validation:**

```python
def validate_user_input(input_text):
    # Sanitize input
    sanitized = bleach.clean(input_text)
    
    # Check for SQL injection patterns
    if re.search(r"(union|select|insert|update|delete|drop)", sanitized, re.IGNORECASE):
        raise SecurityError("Invalid input detected")
    
    # Check for XSS patterns
    if re.search(r"(<script|javascript:|onerror=)", sanitized, re.IGNORECASE):
        raise SecurityError("Invalid input detected")
    
    return sanitized
```

**Aadhaar Validation:**

```python
def validate_aadhaar(aadhaar_number):
    # Remove spaces
    aadhaar = aadhaar_number.replace(" ", "")
    
    # Check length
    if len(aadhaar) != 12:
        return False
    
    # Check if all digits
    if not aadhaar.isdigit():
        return False
    
    # Verhoeff checksum validation
    return verify_verhoeff_checksum(aadhaar)

def verify_verhoeff_checksum(number):
    # Verhoeff algorithm implementation
    d_table = [[0,1,2,3,4,5,6,7,8,9], ...]  # Multiplication table
    p_table = [[0,1,2,3,4,5,6,7,8,9], ...]  # Permutation table
    inv_table = [0,4,3,2,1,5,6,7,8,9]       # Inverse table
    
    c = 0
    for i, digit in enumerate(reversed(number)):
        c = d_table[c][p_table[(i % 8)][int(digit)]]
    
    return c == 0
```

**Session Security:**

```python
def create_session(user_id):
    session_id = secrets.token_urlsafe(32)  # Cryptographically random
    
    # Store in DynamoDB with TTL
    dynamodb.put_item(
        TableName='sessions',
        Item={
            'session_id': session_id,
            'user_id': user_id,
            'created_at': int(time.time()),
            'ttl': int(time.time()) + 86400  # 24 hours
        }
    )
    
    return session_id

def validate_session(session_id):
    # Check if session exists and not expired
    response = dynamodb.get_item(
        TableName='sessions',
        Key={'session_id': session_id}
    )
    
    if 'Item' not in response:
        raise SessionExpiredError()
    
    return response['Item']['user_id']
```

### 9.6 Compliance (DPDP Act 2023)

**Consent Management:**

```python
def collect_consent(user_id, purpose):
    consent_text = f"""
    मैं, {user_name}, सहमति देता/देती हूं कि वाणी सेतु मेरी निम्नलिखित जानकारी का उपयोग करे:
    - आवाज रिकॉर्डिंग (केवल सेवा प्रदान करने के लिए)
    - दस्तावेज़ (आधार, पैन, बैंक पासबुक)
    - व्यक्तिगत जानकारी (नाम, उम्र, पता)
    
    उद्देश्य: {purpose}
    
    मैं समझता/समझती हूं कि:
    - मेरा डेटा सुरक्षित रखा जाएगा
    - मैं किसी भी समय अपना डेटा हटा सकता/सकती हूं
    - मेरा डेटा तीसरे पक्ष को नहीं बेचा जाएगा
    
    क्या आप सहमत हैं? हां/ना बोलें।
    """
    
    # Record verbal consent
    user_response = get_voice_input()
    
    if user_response.lower() in ['हां', 'yes', 'हाँ']:
        store_consent(user_id, purpose, timestamp=now(), audio_url=s3_url)
        return True
    else:
        return False
```

**Data Deletion (Right to be Forgotten):**

```python
def delete_user_data(user_id):
    # Delete from all databases
    dynamodb.delete_item(TableName='users', Key={'user_id': user_id})
    dynamodb.delete_item(TableName='sessions', Key={'user_id': user_id})
    
    # Delete documents from S3
    s3.delete_objects(
        Bucket='vaanisetu-documents-dev',
        Delete={'Objects': [{'Key': f'{user_id}/'}]}
    )
    
    # Anonymize logs (replace user_id with 'DELETED')
    anonymize_logs(user_id)
    
    # Send confirmation
    send_notification(user_id, "आपका सभी डेटा हटा दिया गया है।")
```

**Audit Logging:**

```python
def log_data_access(user_id, accessor, action, data_type):
    audit_log = {
        'timestamp': datetime.now().isoformat(),
        'user_id': user_id,
        'accessor': accessor,  # Which service/person accessed
        'action': action,  # read, write, delete
        'data_type': data_type,  # aadhaar, pan, etc.
        'ip_address': get_client_ip(),
        'session_id': get_session_id()
    }
    
    # Store in immutable log (S3 with Object Lock)
    s3.put_object(
        Bucket='vaanisetu-audit-logs',
        Key=f'audit/{datetime.now().strftime("%Y/%m/%d")}/{uuid4()}.json',
        Body=json.dumps(audit_log),
        ObjectLockMode='COMPLIANCE',
        ObjectLockRetainUntilDate=datetime.now() + timedelta(days=2555)  # 7 years
    )
```


---

## 10. Future Enhancements

### 10.1 Post-Hackathon Roadmap

**Phase 1: Production Readiness (Months 1-3)**

**Full Language Support:**
- Expand from 3 to 22 official languages
- Add 100+ dialect support
- Improve code-mixing accuracy (Hinglish, Tanglish)

**Real Government Portal Integration:**
- Legal agreements with government departments
- API access to live portals (not demo)
- Real-time status tracking from government databases
- DigiLocker integration for verified documents

**Enhanced Security:**
- Full DPDP Act 2023 compliance audit
- Penetration testing
- Bug bounty program
- ISO 27001 certification

**Scalability Improvements:**
- Multi-region deployment (Mumbai + Singapore)
- Auto-scaling to 1M concurrent users
- CDN for global content delivery
- Database read replicas

**Phase 2: Feature Expansion (Months 4-6)**

**Advanced AI Capabilities:**
- Sentiment analysis (detect user frustration → escalate)
- Emotion-aware responses (empathetic tone)
- Predictive recommendations (suggest schemes before user asks)
- Personalized learning paths (skill development)

**Job Marketplace:**
- Real-time job matching (10,000+ jobs)
- Resume builder (voice-based)
- Interview preparation (AI mock interviews)
- Employer dashboard (post jobs, search candidates)

**Financial Services:**
- Credit score building (report to CIBIL)
- Micro-savings (round-up savings)
- Insurance recommendations (crop, life, health)
- Loan facilitation (pre-qualified offers)

**Healthcare Navigation:**
- Ayushman Bharat integration (check eligibility, find hospitals)
- Telemedicine (connect with doctors via voice)
- Medicine delivery (PharmEasy, 1mg integration)
- Health records digitization

**Phase 3: Social Impact (Months 7-12)**

**Community Features:**
- Peer network (connect beneficiaries in same village)
- Success story sharing
- Mentorship matching (successful users guide new users)
- Local events (job fairs, training camps)

**Grievance Redressal:**
- Complaint filing (CPGRAMS integration)
- RTI assistance (Right to Information)
- Escalation to human agents
- Resolution tracking

**Impact Measurement:**
- Real-time impact dashboard (schemes accessed, money disbursed)
- UN SDG alignment tracking
- Government reporting (monthly impact reports)
- Academic research partnerships

### 10.2 Advanced Features (Future Vision)

**1. Blockchain-Based Document Verification**

**Problem:** Document forgery, lack of trust in digital certificates

**Solution:**
- Issue tamper-proof certificates on blockchain
- Employer/bank can verify authenticity via QR code
- User owns and controls their credentials
- Interoperable across government departments

**Technology:**
- Hyperledger Fabric or Ethereum
- IPFS for document storage
- Smart contracts for verification logic

**2. AI-Powered Grievance Resolution**

**Problem:** Government complaints take months to resolve

**Solution:**
- AI analyzes complaint and suggests resolution
- Auto-routes to correct department
- Tracks resolution progress
- Escalates if unresolved in 30 days

**Technology:**
- NLP for complaint classification
- Knowledge graph for department mapping
- Automated follow-up via RPA

**3. Voice Commerce**

**Problem:** Rural users can't access e-commerce due to literacy barriers

**Solution:**
- Order products via voice (seeds, fertilizers, groceries)
- Price comparison across suppliers
- Delivery to doorstep
- Payment via credit (against harvest)

**Technology:**
- Integration with Amazon, Flipkart, local suppliers
- Voice-based product search
- Cash-on-delivery option

**4. Multilingual Content Generation**

**Problem:** Government schemes explained only in English/Hindi

**Solution:**
- AI generates scheme explainers in 22 languages
- Audio, video, infographic formats
- Personalized to user's education level
- Shareable on WhatsApp

**Technology:**
- Bedrock for content generation
- Amazon Polly for audio
- Amazon Nova Reel for video generation

**5. Predictive Analytics for Policy Makers**

**Problem:** Government doesn't know which schemes are effective

**Solution:**
- Analyze VaaniSetu data (anonymized)
- Identify underutilized schemes
- Predict scheme demand
- Recommend policy changes

**Technology:**
- Amazon QuickSight for dashboards
- SageMaker for predictive models
- Athena for data lake queries

**6. Offline Mode**

**Problem:** Rural areas have intermittent internet connectivity

**Solution:**
- Offline-capable mobile app (PWA)
- Sync when internet available
- Local speech recognition (on-device)
- SMS-based fallback

**Technology:**
- Service workers for offline caching
- IndexedDB for local storage
- Whisper model for on-device STT

**7. Voice Biometrics for Authentication**

**Problem:** OTP-based auth requires SMS, which may fail

**Solution:**
- Enroll user's voice as biometric
- Authenticate via voice match
- More secure than OTP (can't be stolen)
- Convenient (no need to remember password)

**Technology:**
- Amazon Connect Voice ID
- Liveness detection (prevent replay attacks)

**8. AI-Powered Business Planning**

**Problem:** Rural entrepreneurs lack business planning skills

**Solution:**
- AI generates complete business plan
- Market analysis (demand, competition)
- Financial projections (revenue, expenses, profit)
- Operational guidance (suppliers, customers, logistics)

**Technology:**
- Bedrock for reasoning and generation
- External APIs for market data
- PDF generation for business plan document

### 10.3 Research & Innovation

**1. Low-Resource Language Models**

**Challenge:** Current models (Claude, GPT) are trained primarily on English

**Research Direction:**
- Fine-tune models on Indian language corpora
- Develop dialect-specific models (Bhojpuri, Marwari)
- Improve code-mixing understanding

**2. Multimodal AI for Rural Context**

**Challenge:** Rural users may have difficulty describing problems in words

**Research Direction:**
- Image-based queries (show crop disease photo, AI diagnoses)
- Video-based skill assessment (show welding technique, AI evaluates)
- Audio-based emotion detection (detect distress, escalate)

**3. Federated Learning for Privacy**

**Challenge:** Centralized data storage raises privacy concerns

**Research Direction:**
- Train models on-device (user's phone)
- Aggregate learnings without sharing raw data
- Preserve privacy while improving AI

**4. Explainable AI for Trust**

**Challenge:** Users don't trust "black box" AI decisions

**Research Direction:**
- Generate explanations for AI recommendations
- "You're eligible because you're a farmer with <2 hectares land"
- Visualize decision-making process

### 10.4 Partnerships & Ecosystem

**Government Partnerships:**
- Ministry of Electronics & IT (MeitY)
- Ministry of Rural Development
- NITI Aayog
- State governments (28 states + 8 UTs)

**Corporate Partnerships:**
- CSR programs (TCS, Infosys, Wipro)
- Skill training (NSDC, Skill India)
- Financial services (banks, NBFCs)
- E-commerce (Amazon, Flipkart)

**NGO Partnerships:**
- Haqdarshak (scheme awareness)
- Digital Green (agricultural extension)
- Pratham (education)
- Aga Khan Foundation (rural development)

**Academic Partnerships:**
- IITs, IIMs (research collaboration)
- IIIT Hyderabad (NLP research)
- ISI Kolkata (data science)
- International universities (MIT, Stanford)

**Technology Partnerships:**
- AWS (cloud infrastructure)
- Anthropic (AI models)
- Meta (WhatsApp integration)
- Google (Bhashini collaboration)

---

## 11. Conclusion

VaaniSetu represents a paradigm shift in how rural India accesses digital services. By combining voice-first design, agentic AI, and comprehensive AWS cloud architecture, we're building a platform that can truly bridge the digital divide.

**Key Differentiators:**
1. **Voice-First, Not Voice-Optional**: Designed for zero digital literacy
2. **Agentic AI**: Performs actions, not just provides information
3. **End-to-End AWS**: 15+ services orchestrated seamlessly
4. **Privacy-by-Design**: DPDP Act 2023 compliant from day one
5. **Scalable Architecture**: Serverless design can handle 1M+ users
6. **Measurable Impact**: Unlocks ₹2.8 lakh crore in unutilized benefits

**Hackathon Readiness:**
- Complete technical architecture documented
- Clear implementation plan with AWS services
- Realistic scope for 48-hour development
- Alignment with "AI for Communities, Access & Public Impact"
- Demonstrable prototype with real data flow

**Social Impact Potential:**
- Serve 900 million digitally excluded Indians
- Reduce application time from hours to minutes
- Eliminate middlemen and corruption
- Increase government scheme utilization by 3x
- Create economic opportunities for millions

VaaniSetu is not just a hackathon project — it's a blueprint for inclusive digital transformation in India.

---

**Document Version:** 1.0  
**Last Updated:** February 11, 2026  
**Prepared For:** AI for Bharat Hackathon 2026  
**Team:** Lossless
**Track:** Student Track — Challenge 6 (AI for Communities, Access & Public Impact)
