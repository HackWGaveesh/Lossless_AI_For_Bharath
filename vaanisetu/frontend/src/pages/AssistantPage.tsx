import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send, Globe, Clock, Database, Cpu, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { Link } from 'react-router-dom';
import Button from '../components/Common/Button';
import { useLanguage } from '../contexts/LanguageContext';
import { useAssistantConversation, LANG_MAP } from '../hooks/useAssistantConversation';

type SupportedLang = 'en' | 'hi' | 'ta' | 'te' | 'mr' | 'kn';

const LANG_LABELS: Record<SupportedLang, string> = {
  en: 'English',
  hi: 'हिंदी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  mr: 'मराठी',
  kn: 'ಕನ್ನಡ',
};

const QUICK_PROMPTS: Record<SupportedLang, string[]> = {
  en: ['Hi', 'Show schemes for me', 'Find jobs', 'Check my application status'],
  hi: ['नमस्ते', 'मेरे लिए योजनाएं दिखाओ', 'नौकरी ढूंढो', 'मेरा आवेदन कहां है'],
  ta: ['வணக்கம்', 'திட்டங்கள் காட்டு', 'வேலைகள் தேடு', 'விண்ணப்ப நிலை'],
  te: ['నమస్కారం', 'పథకాలు చూపించు', 'ఉద్యోగాలు', 'దరఖాస్తు స్థితి'],
  mr: ['नमस्कार', 'योजना दाखवा', 'नोकरी शोधा', 'अर्ज स्थिती'],
  kn: ['ನಮಸ್ಕಾರ', 'ಯೋಜನೆಗಳು', 'ಉದ್ಯೋಗ ಹುಡುಕಿ', 'ಅರ್ಜಿ ಸ್ಥಿತಿ'],
};

export default function AssistantPage() {
  const { language, t, setLanguage } = useLanguage();
  const langCode = LANG_MAP[language] ?? 'hi-IN';

  const {
    messages,
    loading,
    execution,
    pendingAction,
    setPendingAction,
    storedConfirmationToken,
    cards,
    groundingSources,
    budgetMode,
    responseMode,
    sendMessage,
    lastPayload,
    clearSession,
  } = useAssistantConversation({
    langCode,
    channel: 'assistant_page',
    persistMessages: true,
    onLanguageUpdated: setLanguage,
    errorMessage: t('common.error'),
  });

  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const handleSend = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;
    setInput('');
    await sendMessage(text);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const speech = new SpeechRecognition();
    speech.continuous = false;
    speech.interimResults = true;
    speech.lang = langCode;

    speech.onstart = () => setListening(true);
    speech.onend = () => setListening(false);
    speech.onerror = () => setListening(false);
    speech.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      const text = String(result?.[0]?.transcript || '').trim();
      if (!text) return;
      setInput(text);
      if (result.isFinal) {
        void handleSend(text);
      }
    };

    setRecognition(speech);
    return () => {
      try { speech.abort(); } catch { /* noop */ }
    };
  }, [langCode, sendMessage]);

  useEffect(() => {
    return () => {
      if (recognition) {
        try { recognition.stop(); } catch { /* noop */ }
      }
    };
  }, [recognition]);

  const onMic = () => {
    if (!recognition) return;
    if (listening) {
      try { recognition.stop(); } catch { /* noop */ }
      return;
    }
    try { recognition.start(); } catch { /* noop */ }
  };

  const renderCard = (card: Record<string, any>, idx: number) => {
    const type = String(card.type || '');
    if (type === 'scheme_card') {
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-surface-border bg-surface-bg p-3 text-sm">
          <div className="font-semibold text-text-primary">{card.name || card.code}</div>
          {card.nameHi ? <div className="text-text-muted">{card.nameHi}</div> : null}
          {card.benefitRs ? <div className="text-primary-600">Rs {Number(card.benefitRs).toLocaleString('en-IN')}</div> : null}
          {card.description ? <div className="text-text-secondary mt-1">{card.description}</div> : null}
        </div>
      );
    }
    if (type === 'job_card') {
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-surface-border bg-surface-bg p-3 text-sm">
          <div className="font-semibold text-text-primary">{card.title}</div>
          <div className="text-text-secondary">{card.company} - {card.state}</div>
          {card.salaryRange ? <div className="text-primary-600">{card.salaryRange}</div> : null}
        </div>
      );
    }
    if (type === 'application_submitted') {
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
          <div className="font-semibold text-green-800">Application submitted</div>
          <div className="text-green-700">Reference: {card.applicationId}</div>
        </div>
      );
    }
    if (type === 'application_status') {
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
          <div className="font-semibold text-blue-800">Application {card.applicationRef}</div>
          <div className="text-blue-700">Status: {card.status}</div>
        </div>
      );
    }
    if (type === 'document_status') {
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm">
          <div className="font-semibold text-cyan-800">Document {String(card.documentId || '')}</div>
          <div className="text-cyan-700">Status: {String(card.status || 'processing')}</div>
        </div>
      );
    }
    if (type === 'document_requirements') {
      const missing = Array.isArray(card.missingDocuments) ? card.missingDocuments : [];
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="font-semibold text-slate-800">Document Checklist</div>
          {missing.length > 0 ? (
            <div className="text-slate-700">Missing: {missing.join(', ')}</div>
          ) : (
            <div className="text-slate-700">All required documents are available.</div>
          )}
        </div>
      );
    }
    if (type === 'profile_gaps' && Array.isArray(card.missingFields)) {
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="font-semibold text-amber-800">More details needed</div>
          <div className="text-amber-700">Missing: {card.missingFields.join(', ')}</div>
          <p className="mt-2 text-xs text-amber-800">
            Just tell me here or by voice, e.g. &quot;My age is 25, state is Bihar&quot; or &quot;I am from Tamil Nadu&quot;.
          </p>
        </div>
      );
    }
    if (type === 'document_upload') {
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
          <div className="font-semibold text-orange-800">Document required</div>
          <div className="text-orange-700">{String(card.documentType || 'document')}</div>
          <Link to={String(card.openPage || '/documents')} className="inline-flex mt-2 text-xs rounded border border-orange-300 px-2 py-1 bg-white text-orange-800">
            Upload Document
          </Link>
        </div>
      );
    }
    if (type === 'profile_updated') {
      const fields = Array.isArray(card.updatedFields) ? card.updatedFields : [];
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
          <div className="font-semibold text-green-800">Profile updated</div>
          {fields.length > 0 ? <div className="text-green-700">Fields: {fields.join(', ')}</div> : null}
        </div>
      );
    }
    if (type === 'language_updated') {
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">
          <div className="font-semibold text-indigo-800">Language updated</div>
          <div className="text-indigo-700">{String(card.language || '').toUpperCase()}</div>
        </div>
      );
    }
    if (type === 'field_confirm') {
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
          <div className="text-xs text-blue-600 font-medium uppercase tracking-wide mb-1">Confirm Detail</div>
          <div className="flex items-center justify-between">
            <span className="text-blue-800 font-medium capitalize">{String(card.field || '')}</span>
            <span className="text-blue-700 bg-blue-100 px-2 py-0.5 rounded text-sm">
              {String(card.value || '') || <em className="text-blue-400">not provided</em>}
            </span>
          </div>
          <p className="text-xs text-blue-600 mt-1">
            Say <strong>&quot;yes&quot;</strong> to confirm or <strong>&quot;change to [new value]&quot;</strong> to update.
          </p>
        </div>
      );
    }
    if (type === 'scheme_disambiguation') {
      const options = Array.isArray(card.options) ? card.options as Array<{ id?: string; code?: string; name?: string; benefitRs?: number }> : [];
      return (
        <div key={`card-${idx}`} className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm space-y-2">
          <div className="font-semibold text-violet-800">Multiple schemes found — choose one:</div>
          {options.map((opt, i) => (
            <button
              key={opt.id || opt.code || i}
              onClick={() => void sendMessage(`apply for ${opt.name || opt.code}`)}
              className="w-full text-left rounded border border-violet-200 bg-white px-3 py-2 hover:bg-violet-50 transition-colors"
            >
              <div className="font-medium text-violet-900">{opt.name || opt.code}</div>
              {opt.benefitRs ? (
                <div className="text-xs text-green-700">₹{Number(opt.benefitRs).toLocaleString('en-IN')}</div>
              ) : null}
            </button>
          ))}
        </div>
      );
    }
    if (type === 'application_confirm') {
      const scheme = (card.scheme || {}) as Record<string, any>;
      const missingDocs = Array.isArray(card.missingDocuments) ? card.missingDocuments as string[] : [];
      return (
        <div key={`card-${idx}`} className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2 text-sm">
          <div className="font-semibold text-amber-800 flex items-center gap-2">
            <span>📋</span>
            <span>Confirm Application</span>
          </div>
          <div className="font-medium text-text-primary">{scheme.nameEn || scheme.name || 'Selected scheme'}</div>
          {typeof scheme.benefitRs === 'number' && scheme.benefitRs > 0 ? (
            <div className="text-sm">Benefit: <span className="font-semibold text-green-700">₹{Number(scheme.benefitRs).toLocaleString('en-IN')}/year</span></div>
          ) : null}
          {missingDocs.length > 0 ? (
            <div className="text-xs bg-red-50 border border-red-200 rounded-lg p-2 text-red-700">
              ⚠️ Missing documents: {missingDocs.join(', ')}.{' '}
              <Link to="/documents" className="underline font-medium">Upload now →</Link>
            </div>
          ) : null}
          <div className="text-xs text-amber-600 italic">Say &quot;Yes&quot;, &quot;Confirm&quot;, or &quot;Haan&quot; by voice to proceed</div>
        </div>
      );
    }
    return null;
  };

  const quickPrompts = QUICK_PROMPTS[language as SupportedLang] ?? QUICK_PROMPTS.en;

  const pendingSchemeName = String(
    (pendingAction?.scheme as { nameEn?: string; name?: string } | undefined)?.nameEn
    ?? (pendingAction?.scheme as { nameEn?: string; name?: string } | undefined)?.name
    ?? 'selected scheme'
  );

  // Build reasoning timeline from execution object
  const reasoningSteps: Array<{ label: string; detail: string; icon: 'check' | 'clock' | 'db' | 'cpu' | 'warn' }> = [];
  if (execution) {
    if (execution.intent) {
      reasoningSteps.push({ label: 'Intent', detail: String(execution.intent), icon: 'cpu' });
    }
    if (typeof execution.confidence === 'number') {
      reasoningSteps.push({ label: 'Confidence', detail: `${Math.round((execution.confidence as number) * 100)}%`, icon: 'check' });
    }
    if ((execution as any).tool) {
      reasoningSteps.push({ label: 'Tool', detail: String((execution as any).tool), icon: 'cpu' });
    }
    if ((execution as any).dataSource) {
      reasoningSteps.push({ label: 'Data Source', detail: String((execution as any).dataSource), icon: 'db' });
    }
    if ((execution as any).latencyMs) {
      reasoningSteps.push({ label: 'Latency', detail: `${(execution as any).latencyMs}ms`, icon: 'clock' });
    }
    if (Array.isArray(execution.steps) && (execution.steps as string[]).length > 0) {
      reasoningSteps.push({ label: 'Steps', detail: (execution.steps as string[]).join(' → '), icon: 'check' });
    }
  }

  const ServiceInfo = () => {
    const trace = lastPayload?.serviceTrace as Record<string, any> | null;
    if (!trace) return null;
    return (
      <div className="text-xs space-y-1 border-t border-surface-border pt-2 mt-2">
        <div className="font-medium text-text-primary">Nova Pro Trace</div>
        {trace.model ? <div className="text-text-muted">Model: {String(trace.model)}</div> : null}
        {trace.inputTokens ? <div className="text-text-muted">In: {String(trace.inputTokens)} tokens</div> : null}
        {trace.outputTokens ? <div className="text-text-muted">Out: {String(trace.outputTokens)} tokens</div> : null}
        {trace.latencyMs ? <div className="text-text-muted">Latency: {String(trace.latencyMs)}ms</div> : null}
        {trace.guardrailTriggered ? <div className="text-rose-600 font-medium">⚠ Guardrail triggered</div> : null}
      </div>
    );
  };

  const StepIcon = ({ kind }: { kind: string }) => {
    if (kind === 'check') return <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />;
    if (kind === 'clock') return <Clock className="w-3.5 h-3.5 text-blue-500 shrink-0" />;
    if (kind === 'db') return <Database className="w-3.5 h-3.5 text-violet-500 shrink-0" />;
    if (kind === 'warn') return <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
    return <Cpu className="w-3.5 h-3.5 text-cyan-500 shrink-0" />;
  };

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6 h-[calc(100vh-160px)]">
      <section className="bg-surface-card border border-surface-border rounded-card shadow-card flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-semibold text-text-primary">Assistant</h1>
            <p className="text-xs text-text-muted">Continuous session chat</p>
          </div>
          <div className="flex gap-2 text-xs items-center">
            <div className="relative">
              <button
                onClick={() => setShowLangPicker(!showLangPicker)}
                className="flex items-center gap-1 px-2 py-1 rounded-full border border-surface-border bg-surface-bg text-text-secondary hover:bg-surface-elevated"
                id="language-selector"
                aria-label="Select language"
              >
                <Globe className="w-3.5 h-3.5" />
                {LANG_LABELS[language as SupportedLang] ?? 'English'}
              </button>
              {showLangPicker ? (
                <div className="absolute top-full right-0 mt-1 rounded-lg border border-surface-border bg-surface-card shadow-lg z-10 py-1 min-w-[120px]">
                  {(Object.entries(LANG_LABELS) as [SupportedLang, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setLanguage(key as any); setShowLangPicker(false); }}
                      className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-surface-elevated ${language === key ? 'text-primary-600 font-semibold' : 'text-text-secondary'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              onClick={clearSession}
              className="text-xs text-text-muted hover:text-text-secondary px-2 py-1 rounded border border-surface-border"
              title="Clear conversation"
            >
              Clear
            </button>
            <span className="px-2 py-1 rounded-full border border-surface-border bg-surface-bg">{responseMode}</span>
            {budgetMode !== 'normal' ? (
              <span className="px-2 py-1 rounded-full border border-rose-200 bg-rose-50 text-rose-700">Budget: {budgetMode}</span>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="text-sm text-text-muted">
              Start a conversation. I will keep context for this active session.
            </div>
          ) : null}
          {messages.map((m, i) => (
            <div key={`${m.timestamp}-${i}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary-500 text-white' : 'bg-surface-elevated text-text-primary border border-surface-border'}`}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                <div className={`mt-1 text-[10px] ${m.role === 'user' ? 'text-primary-100' : 'text-text-muted'}`}>
                  {new Date(m.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}

          {loading ? (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-surface-elevated text-text-muted border border-surface-border flex items-center gap-2">
                <Loader className="w-4 h-4 animate-spin" />
                <span>Thinking...</span>
              </div>
            </div>
          ) : null}

          {cards.length > 0 ? (
            <div className="space-y-2">
              {cards.map((card, idx) => renderCard(card, idx))}
            </div>
          ) : null}

          {pendingAction?.type === 'scheme_disambiguation' && Array.isArray(pendingAction?.options) ? (
            <div className="rounded-lg border border-surface-border bg-surface-bg p-3">
              <div className="text-sm font-medium text-text-primary mb-2">Choose one scheme</div>
              <div className="flex flex-wrap gap-2">
                {(pendingAction.options as Array<{ id?: string; code?: string; name?: string }>).slice(0, 3).map((o) => (
                  <button
                    key={String(o.id || o.code || o.name)}
                    onClick={() => void sendMessage(`apply for ${o.name || o.code || o.id}`)}
                    className="px-3 py-1.5 text-xs rounded-full border border-primary-300 text-primary-700 bg-primary-50"
                  >
                    {o.name || o.code || o.id}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {pendingAction?.type === 'application_confirm' ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <div className="font-semibold text-amber-800 flex items-center gap-2">
                <span>📋</span>
                <span>Confirm Application</span>
              </div>
              <div className="text-sm font-medium text-text-primary">{pendingSchemeName}</div>
              {typeof (pendingAction?.scheme as any)?.benefitRs === 'number' && (
                <div className="text-sm">
                  Benefit: <span className="font-semibold text-green-700">
                    ₹{Number((pendingAction.scheme as any).benefitRs).toLocaleString('en-IN')}/year
                  </span>
                </div>
              )}
              {Array.isArray(pendingAction?.missingDocuments) && (pendingAction.missingDocuments as string[]).length > 0 && (
                <div className="text-xs bg-red-50 border border-red-200 rounded-lg p-2 text-red-700">
                  ⚠️ Missing documents: {(pendingAction.missingDocuments as string[]).join(', ')}.{' '}
                  <Link to="/documents" className="underline font-medium">Upload now →</Link>
                </div>
              )}
              <div className="text-xs text-amber-600 italic">
                Say "Yes", "Confirm", or "Haan" by voice to proceed
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => void sendMessage('yes confirm application', {
                    confirmationToken: (storedConfirmationToken ?? (pendingAction?.confirmationToken as string)) || undefined,
                  })}
                >
                  ✅ Confirm & Submit
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPendingAction(null)}
                >
                  ✕ Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-surface-border p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {quickPrompts.map((p) => (
              <button
                key={p}
                onClick={() => void handleSend(p)}
                className="px-2.5 py-1 text-xs rounded-full border border-surface-border bg-surface-bg text-text-secondary hover:bg-surface-elevated transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
              placeholder="Type your message..."
              rows={2}
              className="flex-1 rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-text-primary resize-none"
            />
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={onMic} aria-label="Toggle microphone">
                {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
              <Button onClick={() => void handleSend()} disabled={loading || !input.trim()}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <aside className="bg-surface-card border border-surface-border rounded-card shadow-card p-4 space-y-3 overflow-y-auto">
        <h2 className="font-display text-base font-semibold text-text-primary">Agent Reasoning</h2>

        {reasoningSteps.length > 0 ? (
          <div className="space-y-2">
            {reasoningSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <StepIcon kind={step.icon} />
                <div>
                  <span className="font-medium text-text-primary">{step.label}:</span>{' '}
                  <span className="text-text-secondary">{step.detail}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-text-muted">No reasoning steps yet. Send a message to start.</div>
        )}

        <div className="text-sm text-text-secondary space-y-1 border-t border-surface-border pt-2">
          <div><span className="font-medium">State:</span> {String(execution?.state ?? '-')}</div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-text-primary mb-1">Grounding Sources</h3>
          <div className="flex flex-wrap gap-1">
            {groundingSources.length === 0 ? (
              <span className="text-xs text-text-muted">No sources</span>
            ) : groundingSources.map((s) => (
              <span key={s} className="text-xs px-2 py-1 rounded-full border border-surface-border bg-surface-bg">{s}</span>
            ))}
          </div>
        </div>

        <ServiceInfo />
      </aside>
    </div>
  );
}
