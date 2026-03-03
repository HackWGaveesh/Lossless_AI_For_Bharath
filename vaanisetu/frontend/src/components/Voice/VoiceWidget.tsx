import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import Button from '../Common/Button';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAssistantConversation, LANG_MAP } from '../../hooks/useAssistantConversation';

export default function VoiceWidget() {
  const { language, t, setLanguage } = useLanguage();
  const langCode = LANG_MAP[language] ?? 'hi-IN';

  const {
    messages,
    loading: isProcessing,
    execution,
    pendingAction: pendingConfirmation,
    setPendingAction: setPendingConfirmation,
    budgetMode,
    responseMode,
    lastPayload,
    sendMessage,
  } = useAssistantConversation({
    langCode,
    channel: 'voice_widget',
    persistMessages: true,
    sessionStorageKey: 'vaanisetu_assistant_session_id',
    onLanguageUpdated: setLanguage,
    errorMessage: t('common.error'),
  });

  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [slowMessage, setSlowMessage] = useState(false);
  const [textFallback, setTextFallback] = useState('');
  const [speechRecognition, setSpeechRecognition] = useState<any>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const prevLoadingRef = useRef(false);
  const mountedRef = useRef(true);

  const agentTrace = lastPayload
    ? {
        actionCalled: (lastPayload.agentTrace as any)?.actionCalled ?? null,
        agentUsed: (lastPayload.agentTrace as any)?.agentUsed ?? (lastPayload.agentUsed ?? false),
        guardrailApplied: (lastPayload.agentTrace as any)?.guardrailApplied ?? false,
      }
    : null;
  const matchReasons = Array.isArray(lastPayload?.matchReasons) ? (lastPayload.matchReasons as string[]) : [];
  const serviceTrace = (lastPayload?.serviceTrace as Record<string, unknown>) ?? null;

  const lastAssistantMessage = messages.length > 0 && messages[messages.length - 1].role === 'assistant'
    ? messages[messages.length - 1].content
    : '';
  const responseText = localError ?? lastAssistantMessage;

  useEffect(() => {
    if (prevLoadingRef.current && !isProcessing && lastAssistantMessage && typeof window !== 'undefined' && window.speechSynthesis) {
      const utter = new SpeechSynthesisUtterance(lastAssistantMessage);
      utter.lang = langCode;
      utter.rate = 0.95;
      window.speechSynthesis.cancel();
      setTimeout(() => {
        if (mountedRef.current) window.speechSynthesis.speak(utter);
      }, 50);
    }
    prevLoadingRef.current = isProcessing;
  }, [isProcessing, lastAssistantMessage, langCode]);

  useEffect(() => {
    if (serviceTrace && typeof window !== 'undefined') {
      try {
        localStorage.setItem('vaanisetu_lastTrace', JSON.stringify({ ...serviceTrace, timestamp: Date.now() }));
      } catch (_) {
        /* ignore */
      }
    }
  }, [serviceTrace]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      if (speechRecognition) {
        try {
          speechRecognition.abort();
        } catch {
          /* ignore */
        }
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = langCode;

      recognition.onstart = () => {
        setIsListening(true);
        setLocalError(null);
        setTranscript('');
      };

      recognition.onresult = (event: any) => {
        const result = event.results[event.results.length - 1];
        const text = result[0].transcript;
        setTranscript(text);
        if (result.isFinal) {
          stopListening();
          void sendMessage(text);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed') {
          setLocalError('Microphone permission denied. Please allow access.');
        } else if (event.error === 'no-speech') {
          setLocalError('No speech detected. Please try again.');
        } else {
          setLocalError('Speech error. Please try again or type below.');
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      setSpeechRecognition(recognition);
    }
    return () => {
      setSpeechRecognition((prev: any) => {
        if (prev) {
          try {
            prev.abort();
          } catch {
            /* ignore */
          }
        }
        return null;
      });
    };
  }, [langCode]);

  const sendToBackend = async (text: string, opts?: { confirmationToken?: string | null }) => {
    if (!text.trim() || isProcessing) return;
    setLocalError(null);
    setSlowMessage(false);
    const slowTimer = setTimeout(() => {
      if (mountedRef.current) setSlowMessage(true);
    }, 5000);
    try {
      await sendMessage(text, opts);
    } finally {
      clearTimeout(slowTimer);
      if (mountedRef.current) setSlowMessage(false);
    }
  };

  const startListening = () => {
    if (!speechRecognition) {
      setLocalError('Speech recognition not supported in this browser.');
      return;
    }
    try {
      speechRecognition.start();
    } catch (err) {
      console.warn('Recognition already started', err);
    }
  };

  const stopListening = () => {
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch {
        /* ignore */
      }
    }
    setIsListening(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopListening();
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 md:bottom-6 right-6 px-4 h-12 bg-primary-500 text-white rounded-full shadow-primary hover:shadow-primary-hover transition-all hover:-translate-y-px flex items-center justify-center gap-2 z-50"
        aria-label="Open assistant launcher"
      >
        <Mic className="w-6 h-6" />
        <span className="text-sm font-medium">Assistant</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-20 md:bottom-6 right-6 w-96 bg-surface-card rounded-card shadow-card z-50 overflow-hidden border border-surface-border">
      <div className="bg-primary-500 text-white p-4 flex items-center justify-between">
        <h3 className="font-semibold font-sans">{t('voice.title')}</h3>
        <div className="flex items-center gap-2">
          <a href="/assistant" className="text-xs bg-primary-400 hover:bg-primary-300 px-2 py-1 rounded">
            Open Full Chat
          </a>
          <button onClick={() => setIsOpen(false)} className="hover:bg-primary-400 p-1 rounded" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="p-4 bg-surface-elevated">
        <div className="flex gap-1 justify-center h-10 items-end">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div
              key={i}
              className={`w-1 bg-primary-500 rounded-full transition-all duration-150 ${isListening ? 'animate-pulse' : ''}`}
              style={{ height: isListening ? `${8 + (i % 3) * 6 + 4}px` : '8px' }}
            />
          ))}
        </div>
        <p className="text-xs text-center text-text-muted mt-2">
          {isListening ? t('voice.listening') : isProcessing ? (slowMessage ? t('voice.waking_up') : t('voice.thinking')) : t('voice.speak_language')}
        </p>
      </div>

      <div className="p-4 space-y-4 max-h-80 overflow-y-auto">
        {transcript && (
          <div className="bg-primary-100 p-3 rounded-lg ml-4">
            <p className="text-sm text-primary-600 mb-1">{t('voice.you_said')}</p>
            <p className="text-text-primary">{transcript}</p>
          </div>
        )}
        {responseText && (
          <div className="bg-surface-elevated border border-surface-border p-3 rounded-lg mr-4">
            <p className="text-sm text-primary-500 mb-1">{t('voice.ai_response')}</p>
            <p className="text-text-primary">{responseText}</p>
            {(responseMode || agentTrace?.agentUsed) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {responseMode === 'agent' && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-3 py-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                    Amazon Bedrock Agent
                  </span>
                )}
                {responseMode === 'workflow' && (
                  <span className="inline-flex items-center gap-1 text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-3 py-1">
                    Workflow Engine
                  </span>
                )}
                {responseMode === 'direct_model' && (
                  <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1">
                    Direct Model Fallback
                  </span>
                )}
                {agentTrace?.actionCalled && (
                  <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1">
                    Action: {agentTrace.actionCalled}()
                  </span>
                )}
                {agentTrace?.guardrailApplied && (
                  <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-3 py-1">
                    Guardrails Active
                  </span>
                )}
                {budgetMode !== 'normal' && (
                  <span className="inline-flex items-center gap-1 text-xs bg-rose-50 text-rose-700 border border-rose-200 rounded-full px-3 py-1">
                    Budget Mode: {budgetMode}
                  </span>
                )}
              </div>
            )}
            {execution && (
              <div className="mt-3 rounded-lg border border-surface-border bg-surface-bg p-2 text-xs text-text-secondary space-y-1">
                <div><span className="font-medium">State:</span> {(execution as any).state || '-'}</div>
                <div><span className="font-medium">Intent:</span> {(execution as any).intent || '-'}</div>
                <div><span className="font-medium">Confidence:</span> {typeof (execution as any).confidence === 'number' ? `${Math.round((execution as any).confidence * 100)}%` : '-'}</div>
                <div><span className="font-medium">Steps:</span> {Array.isArray((execution as any).steps) ? (execution as any).steps.join(' -> ') : '-'}</div>
              </div>
            )}
            {matchReasons.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-text-muted mb-1">Eligibility match:</p>
                <div className="flex flex-wrap gap-1.5">
                  {matchReasons.map((reason, i) => (
                    <span key={i} className="inline-flex items-center text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">
                      ✓ {reason}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {serviceTrace && ((serviceTrace as any).model || (serviceTrace as any).latencyMs) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(serviceTrace as any).model && (
                  <span className="inline-flex items-center text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">
                    🤖 {(serviceTrace as any).model.replace('us.amazon.', 'Amazon ')}
                  </span>
                )}
                {(serviceTrace as any).region && (
                  <span className="inline-flex items-center text-xs bg-orange-50 text-orange-700 border border-orange-200 rounded-full px-2 py-0.5">
                    🌐 {(serviceTrace as any).region}
                  </span>
                )}
                {(serviceTrace as any).latencyMs != null && (serviceTrace as any).latencyMs > 0 && (
                  <span className="inline-flex items-center text-xs bg-slate-50 text-slate-600 border border-slate-200 rounded-full px-2 py-0.5">
                    ⚡ {(serviceTrace as any).latencyMs}ms
                  </span>
                )}
                {((serviceTrace as any).inputTokens || (serviceTrace as any).outputTokens) && (
                  <span className="inline-flex items-center text-xs bg-slate-50 text-slate-600 border border-slate-200 rounded-full px-2 py-0.5">
                    🔢 {((serviceTrace as any).inputTokens ?? 0) + ((serviceTrace as any).outputTokens ?? 0)} tokens
                  </span>
                )}
              </div>
            )}
            {pendingConfirmation?.type === 'scheme_disambiguation' && Array.isArray(pendingConfirmation.options) && (pendingConfirmation.options as any[]).length > 0 && (
              <div className="mt-3 rounded-lg border border-surface-border bg-surface-bg p-2 space-y-2">
                <p className="text-xs font-medium text-text-secondary">Pick one scheme:</p>
                <div className="flex flex-wrap gap-2">
                  {(pendingConfirmation.options as any[]).slice(0, 3).map((opt) => (
                    <button
                      key={`${opt.id || opt.code || opt.name}`}
                      onClick={() => {
                        const label = opt.name || opt.code || opt.id || '';
                        if (label) {
                          setTranscript(`apply for ${label}`);
                          void sendToBackend(`apply for ${label}`);
                        }
                      }}
                      className="px-3 py-1.5 rounded-full border border-primary-300 text-primary-700 bg-primary-50 text-xs"
                    >
                      {opt.name || opt.code || opt.id}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {pendingConfirmation?.type === 'application_confirm' && (
              <div className="mt-3 rounded-lg border border-surface-border bg-surface-bg p-2 space-y-2">
                <p className="text-xs font-medium text-text-secondary">Ready to submit this application?</p>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      const name = (pendingConfirmation.scheme as any)?.nameEn || (pendingConfirmation.scheme as any)?.name || 'this scheme';
                      setTranscript(`confirm application for ${name}`);
                      void sendToBackend(`confirm application for ${name}`, { confirmationToken: (pendingConfirmation.confirmationToken as string) || null });
                    }}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setPendingConfirmation(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-surface-border space-y-2">
        {!isListening && !isProcessing ? (
          <Button onClick={startListening} className="w-full flex items-center justify-center gap-2">
            <Mic className="w-5 h-5" />
            {t('voice.start')}
          </Button>
        ) : (
          <Button onClick={stopListening} variant="outline" className="w-full flex items-center justify-center gap-2">
            <MicOff className="w-5 h-5" />
            {t('voice.stop')}
          </Button>
        )}

        <p className="text-xs text-text-muted mb-1">{t('voice.type_fallback')}</p>
        <textarea
          value={textFallback}
          onChange={(e) => setTextFallback(e.target.value)}
          placeholder={t('voice.type_placeholder')}
          className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-text-primary text-sm min-h-[80px]"
          rows={3}
        />
        <Button
          onClick={() => {
            const text = textFallback.trim();
            if (text) {
              setTranscript(text);
              setTextFallback('');
              void sendToBackend(text);
            }
          }}
          disabled={!textFallback.trim() || isProcessing}
          className="w-full"
        >
          {isProcessing ? t('voice.thinking') : t('voice.send')}
        </Button>
        <p className="text-xs text-center text-text-muted">{t('voice.speak_language')}</p>
      </div>
    </div>
  );
}
