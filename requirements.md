# VaaniSetu — Voice-First AI Platform for Rural India

## 1. Project Title

**VaaniSetu — Voice-First AI Platform for Rural India**

*वाणी सेतु* (Voice Bridge): Bridging the digital divide through AI-powered voice assistance for underserved communities.

---

## 2. Problem Statement

### The Digital Exclusion Crisis

India faces a severe digital divide that prevents 896 million rural citizens from accessing essential government services, despite 98.8% mobile phone penetration. This paradox exists because:

**Language Barriers:**
- Only 11% of rural Indians can communicate effectively in English
- 287 million adults are functionally illiterate
- 22 official languages + 100+ dialects create fragmentation
- 89% of government portals are English or Hindi only
- Current digital interfaces assume literacy and English proficiency

**Government Scheme Underutilization:**
- Over 1,000 central government schemes exist, but average awareness is only 2.3 schemes per eligible citizen
- ₹2.8 lakh crore worth of schemes go unutilized annually
- 47% of eligible beneficiaries miss government schemes due to complexity
- Average government application requires 42 fields, 6+ documents, and 3.4 visits
- Success rate on first attempt: only 42%

**Existing Solution Failures:**
- **UMANG App**: 120M downloads but only 3.5% retention due to text-heavy, English-centric design
- **Common Service Centers (CSCs)**: Limited hours, high costs (₹100-500 per service), inconsistent quality
- **Private Agents**: Exploitative pricing (₹500-5,000), zero transparency, 40% bribery involvement
- **Text-Based Apps**: Require literacy, smartphone, 4G connectivity, and digital literacy

**The Human Cost:**
- Average rural citizen travels 84 km and spends ₹2,500-4,000 per successful application
- ₹1.97 trillion economic loss projected by 2030 (World Bank)
- Rural women face 3x barriers compared to urban counterparts
- Agricultural productivity loss of ₹84,000 crore due to information gaps

### Why Voice-First + Agentic AI is Necessary

**Voice-First Design:**
- 82% of rural users prefer voice over text in their regional language
- Voice eliminates literacy barriers completely
- Natural conversation requires no training or digital literacy
- Works on basic feature phones (₹1,500 devices)

**Agentic AI (Not Rule-Based):**
- **Traditional chatbots fail** because they only provide information, cannot perform actions
- **Agentic AI can**:
  - Navigate complex government portals autonomously
  - Fill forms by understanding context and requirements
  - Extract data from handwritten documents in regional languages
  - Make intelligent decisions based on user's unique situation
  - Coordinate multiple specialized tasks (document processing, eligibility checking, form submission)
- **Generative AI enables**:
  - Understanding 100+ dialects and code-mixing (Hinglish, Tanglish)
  - Contextual conversations spanning multiple turns
  - Adaptive responses based on user's education level and comprehension
  - Handling ambiguity and incomplete information gracefully

### Alignment with "AI for Communities, Access & Public Impact"

VaaniSetu directly addresses:
- **Inclusion**: Serves 900M digitally excluded Indians through voice-first, multilingual design
- **Accessibility**: Works on basic phones, low bandwidth, zero digital literacy required
- **Community Impact**: Unlocks ₹2.8 lakh crore in unutilized government benefits
- **Public Good**: Bridges government-citizen gap, reduces corruption, increases transparency
- **AI-Powered**: Uses generative AI for reasoning, multi-agent orchestration, and autonomous action execution

---

## 3. Vision & Objectives

### Vision Statement

Create India's first comprehensive, voice-first AI platform that empowers rural and underserved communities to access government services, education, healthcare, and economic opportunities through natural conversations in their native languages.

### Measurable Objectives for Hackathon Prototype

**Technical Objectives:**
1. Build a working voice-first prototype using Amazon Connect and AWS Bedrock
2. Implement end-to-end AWS cloud architecture with 15+ integrated services
3. Deploy at least 3 specialized AI agents with clear task delegation
4. Demonstrate real data flow from voice input → AI processing → structured output
5. Implement document OCR with structured data extraction using Amazon Textract
6. Support at least 3 Indian languages (Hindi, Tamil, Telugu) in demo
7. Enable both Voice (Amazon Connect) and WhatsApp channels
8. Show autonomous form-filling capability on demo government portal
9. Implement secure document wallet with encryption (S3 + KMS)
10. Deploy comprehensive logging and monitoring (CloudWatch)

**Functional Objectives:**
1. Enable users to discover eligible government schemes through voice conversation
2. Process uploaded documents (Aadhaar, certificates) and extract structured data
3. Auto-fill government application forms with user data
4. Provide proactive reminders and status updates
5. Match users to relevant job opportunities based on skills and location
6. Demonstrate end-to-end application workflow from discovery to submission

**Impact Objectives:**
1. Demonstrate 10+ successful voice interactions in regional languages
2. Show 90%+ accuracy in document data extraction
3. Reduce application time from 3-4 hours to under 15 minutes
4. Prove scalability potential to 1M+ users with serverless architecture
5. Validate business model with clear cost-per-transaction metrics

---

## 4. Scope

### In Scope (Hackathon Prototype)

**Core Voice Interface:**
- Amazon Connect-based telephony infrastructure
- Voice input/output in 3 Indian languages (Hindi, Tamil, Telugu)
- Speech-to-Text (STT) using Bhashini API or Amazon Transcribe
- Text-to-Speech (TTS) using Bhashini or Amazon Polly
- Natural language understanding via AWS Bedrock (Claude 3.5 Sonnet)

**Multi-Agent AI System:**
- Orchestrator Agent: Routes tasks to specialized agents
- Scheme Matching Agent: Recommends relevant government schemes
- Document Processing Agent: OCR and data extraction
- Form Filling Agent: Autonomous web navigation (demo portal)
- Notification Agent: Proactive reminders and updates

**Document Processing:**
- Image upload via WhatsApp or web interface
- OCR using Amazon Textract
- Structured data extraction (name, DOB, Aadhaar number, etc.)
- Validation and verification logic
- Secure storage in encrypted S3 buckets

**Government Scheme Features:**
- Database of 50+ major central government schemes
- Eligibility matching engine based on user profile
- Scheme recommendation with explanations
- Required documents checklist
- Application deadline tracking

**Form Automation (Demo):**
- Autonomous browser navigation using Playwright/Selenium
- Form field identification and auto-filling
- CAPTCHA handling (vision-based solving)
- Submission confirmation capture
- Demo portal for testing (not live government sites)

**WhatsApp Integration:**
- WhatsApp Business API sandbox integration
- Text and voice message support
- Document upload via WhatsApp
- Interactive buttons and lists
- Status notifications

**Data Management:**
- User profile storage (DynamoDB)
- Document vault (S3 with KMS encryption)
- Session state management (DynamoDB)
- Application tracking (Aurora Serverless PostgreSQL)
- Conversation history logging

**Security & Compliance:**
- AWS IAM role-based access control
- Encryption at rest (KMS) and in transit (TLS 1.3)
- Secrets management (AWS Secrets Manager)
- Aadhaar data hashing (never stored in plain text)
- Audit logging (CloudWatch Logs)

**Monitoring & Analytics:**
- Real-time metrics dashboard (CloudWatch)
- Call recording and transcription logs
- Agent performance tracking
- Error rate monitoring and alerting
- Cost tracking per transaction

### Out of Scope (Post-Hackathon)

**Not Included in Prototype:**
- Full national rollout across 28 states
- Live integration with actual government portals (security/legal constraints)
- Production-grade legal compliance (DPDP Act 2023 full implementation)
- Nationwide toll-free number deployment
- Support for all 22 official languages (limited to 3 for demo)
- Real-time government database integration (DigiLocker, UIDAI)
- Payment processing and financial transactions
- Mobile app development (iOS/Android native apps)
- Blockchain-based document verification
- Advanced ML model training (using pretrained models only)
- Multi-region deployment and disaster recovery
- Load testing for 1M+ concurrent users
- Human agent escalation workflow
- Complete grievance redressal system
- Full telemedicine integration

---

## 5. Functional Requirements

### FR-1: Multi-Language Voice Input
**Description:** System shall accept voice input in at least 3 Indian languages (Hindi, Tamil, Telugu) with dialect support.  
**Priority:** Critical  
**Acceptance Criteria:**
- User can speak in Hindi, Tamil, or Telugu
- System detects language automatically or allows manual selection
- Handles common dialects (Bhojpuri for Hindi, Kongu for Tamil)
- Supports code-mixing (Hinglish)

### FR-2: Speech Transcription
**Description:** System shall transcribe speech to text using Bhashini API or Amazon Transcribe with >90% accuracy.  
**Priority:** Critical  
**Acceptance Criteria:**
- Real-time transcription with <3 second latency
- Word Error Rate (WER) <10% for clear speech
- Handles background noise up to 60 dB
- Provides interim results during speech

### FR-3: Multi-Agent Task Routing
**Description:** System shall route user requests to appropriate specialized AI agents based on intent.  
**Priority:** Critical  
**Acceptance Criteria:**
- Orchestrator agent identifies user intent (scheme search, document upload, status check)
- Routes to correct specialist agent (Scheme Agent, Document Agent, etc.)
- Maintains conversation context across agent handoffs
- Logs all agent interactions for debugging

### FR-4: Government Scheme Recommendation
**Description:** System shall recommend relevant government schemes based on user eligibility.  
**Priority:** Critical  
**Acceptance Criteria:**
- Matches user profile against 50+ scheme eligibility criteria
- Returns top 5 ranked schemes with match percentage
- Explains why user is eligible in simple language
- Provides benefit amount, deadline, and required documents

### FR-5: Document OCR and Data Extraction
**Description:** System shall extract structured data from uploaded identity documents using Amazon Textract.  
**Priority:** Critical  
**Acceptance Criteria:**
- Supports Aadhaar card, PAN card, bank passbook images
- Extracts key fields (name, DOB, Aadhaar number, account number)
- Validates extracted data (Aadhaar checksum, IFSC code format)
- Handles handwritten text and regional language documents
- Achieves >95% accuracy on clear images

### FR-6: Secure Document Storage
**Description:** System shall store user documents securely in AWS S3 with encryption.  
**Priority:** Critical  
**Acceptance Criteria:**
- All documents encrypted at rest using AWS KMS
- User-specific access control (IAM policies)
- Aadhaar numbers hashed with SHA-256 before storage
- Documents auto-deleted after 90 days (configurable)
- Audit trail for all document access

### FR-7: Structured Application Data Generation
**Description:** System shall generate structured JSON data for government application forms from voice conversation.  
**Priority:** High  
**Acceptance Criteria:**
- Extracts entities (name, age, income, location) from conversation
- Validates data types and formats
- Handles missing information by asking follow-up questions
- Stores in DynamoDB with schema validation
- Allows user to review and confirm before submission

### FR-8: Autonomous Form Filling (Demo Portal)
**Description:** System shall demonstrate automated form filling on a demo government portal using browser automation.  
**Priority:** High  
**Acceptance Criteria:**
- Navigates to demo portal URL
- Identifies form fields using DOM inspection
- Fills fields with user data from database
- Handles dropdowns, radio buttons, checkboxes
- Solves simple CAPTCHAs using vision AI
- Captures acknowledgment/reference number after submission
- Does NOT submit to real government portals (demo only)

### FR-9: Comprehensive Logging
**Description:** System shall log all actions, errors, and metrics to AWS CloudWatch.  
**Priority:** High  
**Acceptance Criteria:**
- Logs every API call with request/response
- Logs agent decisions and reasoning
- Logs errors with stack traces
- Logs performance metrics (latency, token usage)
- Logs are searchable and filterable
- Retention period: 30 days

### FR-10: WhatsApp-Based Interaction
**Description:** System shall support text and voice interactions via WhatsApp Business API.  
**Priority:** High  
**Acceptance Criteria:**
- Users can send text messages in regional languages
- Users can send voice notes (transcribed automatically)
- Users can upload document images
- System sends responses with interactive buttons
- System sends proactive notifications (status updates, reminders)

### FR-11: Proactive Reminders and Notifications
**Description:** System shall send proactive reminders for deadlines, status updates, and new opportunities.  
**Priority:** Medium  
**Acceptance Criteria:**
- Sends reminder 3 days before application deadline
- Sends notification when application status changes
- Sends daily job recommendations based on user profile
- User can configure notification preferences
- Supports SMS and WhatsApp channels

### FR-12: Demo Workflow Replay
**Description:** System shall allow judges to replay complete workflows for evaluation.  
**Priority:** Medium  
**Acceptance Criteria:**
- Recorded demo scenarios (e.g., "Farmer applies for PM-KISAN")
- Step-by-step visualization of data flow
- Shows agent coordination and decision-making
- Displays intermediate outputs (transcripts, extracted data, API calls)
- Exportable as video or interactive dashboard

### FR-13: Eligibility Calculation Engine
**Description:** System shall calculate user eligibility for schemes based on demographic and economic criteria.  
**Priority:** High  
**Acceptance Criteria:**
- Evaluates age, income, caste, gender, location criteria
- Handles complex rules (e.g., "SC/ST women aged 18-40 with income <₹3 lakh")
- Returns eligibility score (0-100%)
- Explains which criteria matched and which didn't
- Updates eligibility when user profile changes

### FR-14: Job Opportunity Matching
**Description:** System shall match users to relevant job opportunities based on skills, location, and preferences.  
**Priority:** Medium  
**Acceptance Criteria:**
- Searches job database (50+ sample jobs)
- Matches based on skills, location proximity (<20 km), salary expectation
- Returns top 5 jobs with match score
- Provides job details (company, salary, requirements)
- Allows user to express interest or apply

### FR-15: Session State Management
**Description:** System shall maintain conversation context across multiple interactions.  
**Priority:** High  
**Acceptance Criteria:**
- Stores conversation history in DynamoDB
- Resumes conversation if user calls back within 24 hours
- Remembers user's current task (e.g., "filling MUDRA loan form")
- Allows user to say "continue where we left off"
- Session expires after 24 hours of inactivity

---

## 6. Non-Functional Requirements

### NFR-1: Scalability
**Description:** System shall be designed to scale to 1 million users using serverless architecture.  
**Metrics:**
- Auto-scaling Lambda functions (0 to 1000 concurrent executions)
- DynamoDB on-demand capacity mode
- S3 unlimited storage
- Amazon Connect supports 10,000+ concurrent calls

### NFR-2: Performance
**Description:** System shall provide low-latency responses for real-time voice interaction.  
**Metrics:**
- Voice-to-voice latency: <3 seconds (95th percentile)
- API response time: <500ms (median)
- Document OCR processing: <5 seconds per image
- Form filling: <30 seconds for 20-field form

### NFR-3: Reliability
**Description:** System shall be highly available with automatic retry and fallback mechanisms.  
**Metrics:**
- Uptime: 99.5% (acceptable for prototype)
- Automatic retry on transient failures (3 attempts with exponential backoff)
- Fallback to Amazon Transcribe if Bhashini fails
- Graceful degradation (e.g., text-only if voice fails)

### NFR-4: Security
**Description:** System shall protect user data with industry-standard security practices.  
**Metrics:**
- All data encrypted at rest (AES-256) and in transit (TLS 1.3)
- IAM least privilege principle (each Lambda has minimal permissions)
- No hardcoded credentials (Secrets Manager)
- Aadhaar data hashed, never logged in plain text
- Regular security scanning (AWS Security Hub)

### NFR-5: Maintainability
**Description:** System shall be easy to debug, monitor, and update.  
**Metrics:**
- Comprehensive CloudWatch logging
- Distributed tracing with AWS X-Ray
- Infrastructure as Code (AWS CDK or CloudFormation)
- Modular architecture (each agent is independent Lambda)
- Clear documentation and code comments

### NFR-6: Cost Efficiency
**Description:** System shall optimize AWS costs using serverless and pay-per-use services.  
**Metrics:**
- Target cost: <₹50 per successful application
- Lambda execution time optimized (<1 GB memory, <30s duration)
- S3 lifecycle policies (delete old documents)
- DynamoDB on-demand (no provisioned capacity waste)
- Bedrock token usage monitoring

### NFR-7: Usability
**Description:** System shall be intuitive for users with zero digital literacy.  
**Metrics:**
- No training required (natural conversation)
- Clear voice prompts in simple language
- Confirmation before critical actions
- Error messages in user's language
- Average user can complete task in <15 minutes

### NFR-8: Observability
**Description:** System shall provide real-time visibility into operations for debugging and optimization.  
**Metrics:**
- CloudWatch dashboard with key metrics (call volume, success rate, latency)
- Alarms for error rate >5%, latency >5s
- X-Ray traces for end-to-end request flow
- Log aggregation and search (CloudWatch Logs Insights)

---

## 7. Data Requirements

### Data Sources

**User-Generated Data:**
- Voice recordings (stored temporarily, deleted after transcription)
- Uploaded documents (Aadhaar, PAN, certificates)
- Profile information (name, age, location, occupation)
- Conversation transcripts
- Application form data

**Reference Data:**
- Government scheme database (50+ schemes with eligibility criteria)
- Job listings (50+ sample jobs)
- District/state master data
- Skill taxonomy (100+ skills)

**Dummy Data Usage:**
- **User Profiles**: 100 synthetic user profiles with realistic demographics
- **Scheme Data**: Real scheme names and criteria (publicly available)
- **Job Data**: Scraped from public job portals or manually created
- **Documents**: Sample Aadhaar/PAN images (anonymized or synthetic)
- **No Real PII**: All personal data is synthetic or anonymized

### Data Storage

**Amazon S3:**
- **Bucket**: `vaanisetu-documents-dev`
- **Structure**: `{user-id}/{document-type}/{timestamp}.jpg`
- **Encryption**: SSE-KMS with customer-managed key
- **Lifecycle**: Delete after 90 days
- **Access**: IAM role-based, user-specific prefixes

**Amazon DynamoDB:**
- **Table**: `users` (user profiles)
  - Partition Key: `user_id` (UUID)
  - Attributes: name, phone, age, location, language, etc.
- **Table**: `sessions` (conversation state)
  - Partition Key: `session_id`
  - Sort Key: `timestamp`
  - TTL: 24 hours
- **Table**: `applications` (application tracking)
  - Partition Key: `user_id`
  - Sort Key: `application_id`
  - Attributes: scheme, status, submitted_at, etc.

**Amazon Aurora Serverless (PostgreSQL):**
- **Table**: `schemes` (government schemes)
  - Columns: scheme_id, name, description, eligibility_criteria (JSONB), benefit_amount, deadline
- **Table**: `jobs` (job listings)
  - Columns: job_id, title, company, location, salary, skills_required (JSONB)

**Amazon CloudWatch Logs:**
- Log Group: `/aws/lambda/vaanisetu-*` (all Lambda functions)
- Log Group: `/aws/connect/vaanisetu` (call recordings)
- Retention: 30 days

### Data Privacy

**Sensitive Data Handling:**
- **Aadhaar**: Hashed with SHA-256 + salt, never stored in plain text
- **Phone Numbers**: Stored but not displayed in logs
- **Documents**: Encrypted at rest, access logged
- **Conversation Transcripts**: Anonymized for analytics (PII redacted)

**Compliance:**
- DPDP Act 2023 principles followed (consent, purpose limitation, data minimization)
- User can request data deletion (right to be forgotten)
- Audit trail for all data access

---

## 8. Success Criteria

### Technical Success Metrics

**Voice Interface:**
- ✅ 10+ successful voice interactions in 3 languages
- ✅ <3 second average latency for voice responses
- ✅ >90% transcription accuracy on test dataset
- ✅ Handles 5+ turn conversations with context retention

**AI Agents:**
- ✅ 3+ specialized agents deployed and functional
- ✅ Clear task delegation visible in logs
- ✅ Agent coordination demonstrated in workflow replay
- ✅ <5% error rate in agent decision-making

**Document Processing:**
- ✅ >95% accuracy in OCR data extraction (on clear images)
- ✅ Supports Aadhaar, PAN, bank passbook formats
- ✅ Validates extracted data (checksums, formats)
- ✅ Processes document in <5 seconds

**Form Automation:**
- ✅ Successfully fills 20-field demo form autonomously
- ✅ Handles dropdowns, checkboxes, radio buttons
- ✅ Solves simple CAPTCHAs (text-based)
- ✅ Captures acknowledgment number

**AWS Integration:**
- ✅ 15+ AWS services integrated and functional
- ✅ Serverless architecture (no EC2 instances)
- ✅ Infrastructure deployed via IaC (CDK/CloudFormation)
- ✅ Comprehensive monitoring dashboard

### Functional Success Metrics

**User Experience:**
- ✅ User can discover eligible schemes in <2 minutes
- ✅ User can upload document and see extracted data in <1 minute
- ✅ User can complete application workflow in <15 minutes
- ✅ System provides clear confirmations and next steps

**Scheme Matching:**
- ✅ Recommends 3-5 relevant schemes per user
- ✅ Explains eligibility in simple language
- ✅ Provides accurate benefit amounts and deadlines
- ✅ >80% user satisfaction with recommendations (demo feedback)

**Proactive Assistance:**
- ✅ Sends reminder 3 days before deadline
- ✅ Notifies user of status changes within 1 hour
- ✅ Suggests new opportunities based on profile

### Business Success Metrics

**Cost Efficiency:**
- ✅ Cost per transaction: <₹50 (AWS costs only)
- ✅ Demonstrates scalability to 1M users without linear cost increase
- ✅ Clear cost breakdown by service

**Impact Potential:**
- ✅ Demonstrates 80% time savings vs. manual process
- ✅ Shows potential to serve 10,000+ users with current architecture
- ✅ Validates business model (B2G revenue potential)

### Demo Success Criteria

**Judging Readiness:**
- ✅ 5-minute live demo script prepared
- ✅ Recorded backup demo video (in case of connectivity issues)
- ✅ Interactive dashboard showing data flow
- ✅ Clear explanation of AI usage and why it's necessary
- ✅ GitHub repository with clean code and documentation
- ✅ Architecture diagram and system design document
- ✅ Alignment with "AI for Communities, Access & Public Impact" clearly articulated

---

## 9. Risks & Assumptions

### Technical Risks

**Risk 1: Bhashini API Availability**
- **Description**: Bhashini API may have rate limits or downtime during demo
- **Likelihood**: Medium
- **Impact**: High (voice interface fails)
- **Mitigation**: Fallback to Amazon Transcribe + Polly for Hindi/English

**Risk 2: AWS Bedrock Token Limits**
- **Description**: Bedrock has token limits per request and per minute
- **Likelihood**: Medium
- **Impact**: Medium (agent responses truncated)
- **Mitigation**: Optimize prompts, use Claude 3.5 Haiku for simple tasks, implement retry logic

**Risk 3: Network Latency**
- **Description**: High latency in voice pipeline (Connect → Lambda → Bedrock → TTS)
- **Likelihood**: Medium
- **Impact**: Medium (poor user experience)
- **Mitigation**: Optimize Lambda cold starts, use connection pooling, cache common responses

**Risk 4: OCR Accuracy on Poor Quality Images**
- **Description**: Users may upload blurry or low-resolution document images
- **Likelihood**: High
- **Impact**: Medium (data extraction fails)
- **Mitigation**: Image quality validation, ask user to re-upload, provide guidance on good photos

**Risk 5: CAPTCHA Solving Failure**
- **Description**: Vision AI may fail to solve complex CAPTCHAs
- **Likelihood**: Medium
- **Impact**: Low (demo portal only, can use simple CAPTCHAs)
- **Mitigation**: Use demo portal with simple text CAPTCHAs, fallback to manual solving

### Operational Risks

**Risk 6: AWS Cost Overrun**
- **Description**: Bedrock and Connect costs may exceed budget during testing
- **Likelihood**: Medium
- **Impact**: Medium (budget constraints)
- **Mitigation**: Set AWS Budgets with alerts, use Haiku for non-critical tasks, limit test calls

**Risk 7: Government Portal Access Restrictions**
- **Description**: Real government portals may block automated access
- **Likelihood**: High
- **Impact**: Low (using demo portal instead)
- **Mitigation**: Build demo portal that mimics real portal structure

**Risk 8: Data Privacy Concerns**
- **Description**: Handling Aadhaar data may raise privacy concerns
- **Likelihood**: Low
- **Impact**: High (legal/ethical issues)
- **Mitigation**: Use synthetic Aadhaar numbers, hash all PII, clear consent flow, data deletion policy

### Assumptions

**Assumption 1: Bhashini API Access**
- We assume we can get free/trial access to Bhashini API for hackathon
- Backup: Use Amazon Transcribe (supports Hindi) + Translate

**Assumption 2: WhatsApp Business API Sandbox**
- We assume Meta provides sandbox access for testing
- Backup: Use Twilio WhatsApp sandbox or simulate with web interface

**Assumption 3: AWS Free Tier / Credits**
- We assume AWS provides credits or free tier covers prototype costs
- Estimated cost: ₹5,000-10,000 for development and demo

**Assumption 4: Pretrained Models Suffice**
- We assume pretrained models (Claude 3.5 Sonnet) are sufficient for reasoning
- No custom model training required (each model <1GB as per rules)

**Assumption 5: Dummy Data Acceptability**
- We assume judges accept synthetic user data and demo portals
- Real government integration is out of scope for hackathon

**Assumption 6: Internet Connectivity During Demo**
- We assume stable internet for live demo
- Backup: Pre-recorded video demo

**Assumption 7: 48-Hour Development Window**
- We assume core prototype can be built in 48 hours with focused effort
- Prioritize: Voice interface → AI agents → Document OCR → Form filling

---

## 10. Appendix

### Glossary

- **Agentic AI**: AI systems that can autonomously perform actions and make decisions, not just provide information
- **Bhashini**: Government of India's platform for Indian language AI (speech, translation)
- **DPDP Act**: Digital Personal Data Protection Act 2023 (India's data privacy law)
- **OCR**: Optical Character Recognition (extracting text from images)
- **STT**: Speech-to-Text (voice transcription)
- **TTS**: Text-to-Speech (voice synthesis)
- **IAM**: Identity and Access Management (AWS security service)
- **KMS**: Key Management Service (AWS encryption service)

### References

- AWS Bedrock Documentation: https://docs.aws.amazon.com/bedrock/
- Amazon Connect Developer Guide: https://docs.aws.amazon.com/connect/
- Bhashini Platform: https://bhashini.gov.in/
- Government of India Schemes Portal: https://www.india.gov.in/
- DPDP Act 2023: https://www.meity.gov.in/

### Contact Information

**Team VaaniSetu**  
Hackathon Track: Student Track — Challenge 6  
Project Repository: [GitHub URL]  
Demo Video: [YouTube URL]  
Presentation Deck: [Google Slides URL]

---

*This requirements document is prepared for the AI for Bharat Hackathon 2026. All technical specifications are subject to refinement during implementation.*
