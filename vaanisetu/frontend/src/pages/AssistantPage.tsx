import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import Button from '../components/Common/Button';
import { useLanguage } from '../contexts/LanguageContext';
import { useAssistantConversation, LANG_MAP } from '../hooks/useAssistantConversation';

export default function AssistantPage() {
  const { language, t, setLanguage } = useLanguage();
  const langCode = LANG_MAP[language] ?? 'hi-IN';

  const {
    messages,
    loading,
    execution,
    pendingAction,
    setPendingAction,
    cards,
    groundingSources,
    budgetMode,
    responseMode,
    sendMessage,
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
    return null;
  };

  const quickPrompts = [
    'Hi',
    'Tell me schemes available',
    'Find schemes suitable for me',
    'Show my application status',
  ];

  const pendingSchemeName = String(
    (pendingAction?.scheme as { nameEn?: string; name?: string } | undefined)?.nameEn
      ?? (pendingAction?.scheme as { nameEn?: string; name?: string } | undefined)?.name
      ?? 'selected scheme'
  );

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6 h-[calc(100vh-160px)]">
      <section className="bg-surface-card border border-surface-border rounded-card shadow-card flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
          <div>
            <h1 className="font-display text-lg font-semibold text-text-primary">Assistant</h1>
            <p className="text-xs text-text-muted">Continuous session chat</p>
          </div>
          <div className="flex gap-2 text-xs">
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
                <div>{m.content}</div>
                <div className={`mt-1 text-[10px] ${m.role === 'user' ? 'text-primary-100' : 'text-text-muted'}`}>
                  {new Date(m.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}

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
            <div className="rounded-lg border border-surface-border bg-surface-bg p-3">
              <div className="text-sm font-medium text-text-primary">
                Confirm application for {pendingSchemeName}?
              </div>
              {Array.isArray(pendingAction?.missingDocuments) && (pendingAction.missingDocuments as string[]).length > 0 ? (
                <div className="text-xs text-amber-700 mt-1">
                  Missing documents: {(pendingAction.missingDocuments as string[]).join(', ')}
                </div>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Button
                  onClick={() => void sendMessage('yes confirm application', { confirmationToken: (pendingAction?.confirmationToken as string) ?? null })}
                >
                  Confirm
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPendingAction(null)}
                >
                  Cancel
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
                className="px-2.5 py-1 text-xs rounded-full border border-surface-border bg-surface-bg text-text-secondary"
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              rows={2}
              className="flex-1 rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-text-primary"
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
        <h2 className="font-display text-base font-semibold text-text-primary">Agent Activity</h2>
        <div className="text-sm text-text-secondary">
          <div><span className="font-medium">State:</span> {String(execution?.state ?? '-')}</div>
          <div><span className="font-medium">Intent:</span> {String(execution?.intent ?? '-')}</div>
          <div><span className="font-medium">Confidence:</span> {typeof execution?.confidence === 'number' ? `${Math.round((execution.confidence as number) * 100)}%` : '-'}</div>
          <div><span className="font-medium">Steps:</span> {Array.isArray(execution?.steps) ? (execution.steps as string[]).join(' -> ') : '-'}</div>
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
      </aside>
    </div>
  );
}
