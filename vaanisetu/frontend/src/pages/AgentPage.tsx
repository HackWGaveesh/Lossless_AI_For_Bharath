import { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function AgentPage() {
    const [agentStatus, setAgentStatus] = useState<'active' | 'fallback' | 'loading'>('loading');

    useEffect(() => {
        api.get('/health').then((r: any) => {
            setAgentStatus(r.data?.data?.bedrockAgentId === 'configured' ? 'active' : 'fallback');
        }).catch(() => setAgentStatus('fallback'));
    }, []);

    const pipeline = [
        { step: 1, icon: '🎙️', title: 'Voice Input', desc: 'User speaks in any of 6 Indian languages. Browser Web Speech API converts to text.', service: 'Browser API', color: 'blue' },
        { step: 2, icon: '🛡️', title: 'Bedrock Guardrails', desc: 'Input screened for harmful content. PII (Aadhaar numbers) automatically anonymized.', service: 'Amazon Bedrock Guardrails', color: 'purple' },
        { step: 3, icon: '🧠', title: 'Orchestrator Agent', desc: 'Nova Pro analyzes intent and decides which Action Group function to call.', service: 'Amazon Bedrock Agent', color: 'violet' },
        { step: 4, icon: '⚡', title: 'Action Execution', desc: 'Agent calls getSchemesByProfile, createApplication, or getJobsByProfile based on intent.', service: 'Agent Action Group + Lambda', color: 'amber' },
        { step: 5, icon: '📚', title: 'RAG Knowledge Base', desc: 'Agent retrieves relevant scheme details from vector-indexed knowledge base (25 schemes).', service: 'Bedrock Knowledge Base + Titan Embeddings', color: 'indigo' },
        { step: 6, icon: '🗄️', title: 'Data Retrieval', desc: 'Lambda queries Aurora Serverless (schemes/jobs) or DynamoDB (applications/profiles).', service: 'Aurora Serverless v2 + DynamoDB', color: 'emerald' },
        { step: 7, icon: '✅', title: 'Grounded Response', desc: 'Agent synthesizes retrieved data into a multilingual, contextual response.', service: 'Amazon Nova Pro', color: 'green' },
    ];

    const services = [
        { name: 'Amazon Bedrock Agent', purpose: 'Multi-agent orchestration', icon: '🤖' },
        { name: 'Amazon Nova Pro', purpose: 'Language understanding + generation + vision OCR', icon: '🧠' },
        { name: 'Amazon Textract', purpose: 'Document OCR for PDFs', icon: '📄' },
        { name: 'Amazon Rekognition', purpose: 'Face comparison for KYC', icon: '👁️' },
        { name: 'Bedrock Guardrails', purpose: 'Responsible AI - PII protection', icon: '🛡️' },
        { name: 'Bedrock Knowledge Base', purpose: 'RAG over 25 scheme documents', icon: '📚' },
        { name: 'Amazon Cognito', purpose: 'Phone OTP authentication', icon: '🔐' },
        { name: 'Aurora Serverless v2', purpose: 'Schemes + jobs database', icon: '🗄️' },
        { name: 'Amazon DynamoDB', purpose: 'Users, applications, documents', icon: '⚡' },
        { name: 'AWS Lambda (13 functions)', purpose: 'All backend processing, serverless', icon: 'λ' },
        { name: 'Amazon CloudFront', purpose: 'Global CDN for frontend', icon: '🌐' },
        { name: 'Amazon SNS', purpose: 'SMS notifications to users', icon: '📱' },
        { name: 'AWS KMS', purpose: 'Encryption for all data at rest', icon: '🔑' },
        { name: 'Amazon S3', purpose: 'Document storage + frontend hosting', icon: '🪣' },
        { name: 'AWS X-Ray', purpose: 'Distributed tracing on all Lambdas', icon: '🔍' },
    ];

    const colorMap: Record<string, string> = {
        blue: 'bg-blue-50 border-blue-200 text-blue-800',
        purple: 'bg-purple-50 border-purple-200 text-purple-800',
        violet: 'bg-violet-50 border-violet-200 text-violet-800',
        amber: 'bg-amber-50 border-amber-200 text-amber-800',
        indigo: 'bg-indigo-50 border-indigo-200 text-indigo-800',
        emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        green: 'bg-green-50 border-green-200 text-green-800',
    };

    return (
        <div className="p-4 md:p-6 space-y-8 max-w-4xl mx-auto">
            <div>
                <h1 className="text-2xl font-display font-bold text-text-primary">AI Architecture</h1>
                <p className="text-text-secondary mt-1">VaaniSetu multi-agent system powered by Amazon Bedrock</p>
            </div>

            {/* Agent Status */}
            <div className={`rounded-xl p-4 border flex items-center gap-3 ${agentStatus === 'active'
                    ? 'bg-emerald-50 border-emerald-200'
                    : agentStatus === 'fallback'
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-gray-50 border-gray-200'
                }`}>
                <span className="text-2xl">
                    {agentStatus === 'active' ? '✅' : agentStatus === 'fallback' ? '⚙️' : '⏳'}
                </span>
                <div>
                    <p className="font-semibold">
                        {agentStatus === 'active'
                            ? 'Bedrock Orchestrator Agent — Live'
                            : agentStatus === 'fallback'
                                ? 'Direct Nova Pro mode (Agent setup pending)'
                                : 'Checking agent status...'}
                    </p>
                    <p className="text-sm mt-0.5 opacity-75">
                        Foundation Model: us.amazon.nova-pro-v1:0 · Region: ap-south-1 (India)
                    </p>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { n: '15', label: 'AWS Services' },
                    { n: '4', label: 'Agent Actions' },
                    { n: '6', label: 'Languages' },
                    { n: '25', label: 'Schemes in KB' },
                ].map(s => (
                    <div key={s.label} className="bg-surface-card rounded-xl p-4 border border-surface-border text-center">
                        <div className="text-3xl font-bold text-primary-600">{s.n}</div>
                        <div className="text-sm text-text-secondary mt-1">{s.label}</div>
                    </div>
                ))}
            </div>

            {/* Pipeline */}
            <div>
                <h2 className="text-lg font-semibold text-text-primary mb-4">Agent Orchestration Pipeline</h2>
                <div className="space-y-2">
                    {pipeline.map((s, i) => (
                        <div key={s.step}>
                            <div className={`rounded-xl p-4 border ${colorMap[s.color]} flex items-start gap-3`}>
                                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/60 flex items-center justify-center text-sm font-bold border border-current">
                                    {s.step}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span>{s.icon}</span>
                                        <span className="font-semibold">{s.title}</span>
                                        <code className="text-xs bg-white/60 rounded px-1.5 py-0.5 border border-current/30">
                                            {s.service}
                                        </code>
                                    </div>
                                    <p className="text-sm mt-1 opacity-80">{s.desc}</p>
                                </div>
                            </div>
                            {i < pipeline.length - 1 && (
                                <div className="text-center text-text-tertiary py-1">↓</div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* AWS Services Used */}
            <div>
                <h2 className="text-lg font-semibold text-text-primary mb-4">AWS Services Used ({services.length})</h2>
                <div className="grid md:grid-cols-2 gap-3">
                    {services.map(s => (
                        <div key={s.name} className="bg-surface-card rounded-xl p-3 border border-surface-border flex items-start gap-3">
                            <span className="text-xl flex-shrink-0">{s.icon}</span>
                            <div>
                                <div className="font-medium text-sm text-text-primary">{s.name}</div>
                                <div className="text-xs text-text-secondary">{s.purpose}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Agent Actions */}
            <div>
                <h2 className="text-lg font-semibold text-text-primary mb-4">Agent Action Groups</h2>
                <div className="grid md:grid-cols-2 gap-4">
                    {[
                        { fn: 'getSchemesByProfile()', desc: 'Finds eligible government schemes based on age, income, state, occupation', trigger: 'User asks: "What schemes can I get?"', result: 'Returns 8 ranked schemes with match % and benefit amount' },
                        { fn: 'createApplication()', desc: 'Submits scheme application and creates reference number', trigger: 'User says: "I want to apply for PM-KISAN"', result: 'Saves to DynamoDB, sends SMS confirmation via SNS' },
                        { fn: 'getApplicationStatus()', desc: 'Checks status of submitted application', trigger: 'User asks: "What is status of my application?"', result: 'Returns current status and expected timeline' },
                        { fn: 'getJobsByProfile()', desc: 'Finds employment matching user location and skills', trigger: 'User asks: "Show me jobs near Bihar"', result: 'Returns filtered, ranked job opportunities' },
                    ].map(a => (
                        <div key={a.fn} className="bg-surface-card rounded-xl p-4 border border-surface-border">
                            <code className="text-sm font-mono text-primary-600 font-bold">{a.fn}</code>
                            <p className="text-sm text-text-secondary mt-1">{a.desc}</p>
                            <div className="mt-2 space-y-1">
                                <p className="text-xs text-text-tertiary"><span className="font-medium">Triggered when:</span> {a.trigger}</p>
                                <p className="text-xs text-text-tertiary"><span className="font-medium">Returns:</span> {a.result}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* KYC Pipeline */}
            <div className="bg-surface-card rounded-xl p-5 border border-surface-border">
                <h2 className="text-lg font-semibold text-text-primary mb-3">Document KYC Pipeline</h2>
                <p className="text-sm text-text-secondary">
                    Separate from the agent, VaaniSetu runs a 10-step KYC verification pipeline:
                    <strong> Structural validation → Rate limiting → S3 encrypted storage → Textract OCR →
                        OCR match scoring → Rekognition face comparison → Face quality check →
                        Fraud signal assembly → Nova Pro fraud analysis → Status determination.</strong>
                    {' '}Supports Aadhaar, PAN, Bank Passbook, and Income Certificate.
                </p>
            </div>
        </div>
    );
}
