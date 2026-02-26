import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import Button from '../Common/Button';
import { voiceQuery } from '../../services/api';
import { useLanguage } from '../../contexts/LanguageContext';

const SpeechRecognition = typeof window !== 'undefined' && ((window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition);

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: (e: { results: Iterable<{ isFinal: boolean; [i: number]: { transcript: string } }> }) => void;
  onend: () => void;
  onerror: (e: { error: string }) => void;
}

const LANG_MAP: Record<string, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  mr: 'mr-IN',
  kn: 'kn-IN',
};

export default function VoiceWidget() {
  const { language, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [responseText, setResponseText] = useState('');
  const [sessionContext, setSessionContext] = useState<{ role: string; content: string }[]>([]);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef('');

  const langCode = LANG_MAP[language] ?? 'hi-IN';

  const startListening = () => {
    if (!SpeechRecognition) {
      setResponseText(t('voice.no_mic'));
      return;
    }
    setTranscript('');
    setResponseText('');
    finalTranscriptRef.current = '';
    setIsListening(true);
    try {
      const rec = new SpeechRecognition();
      rec.lang = langCode;
      rec.continuous = false;
      rec.interimResults = true;
      rec.onresult = (e: { results: Iterable<{ isFinal: boolean; [i: number]: { transcript: string } }> }) => {
        const results = Array.from(e.results);
        const last = results[results.length - 1];
        const text = last?.[0]?.transcript ?? '';
        setTranscript(text);
        if (last?.isFinal) finalTranscriptRef.current = text;
      };
      rec.onend = () => {
        setIsListening(false);
        const toSend = (finalTranscriptRef.current || transcript).trim();
        if (toSend) sendToBackend(toSend);
      };
      rec.onerror = (e: { error: string }) => {
        setIsListening(false);
        if (e.error !== 'aborted') setResponseText(t('voice.no_mic'));
      };
      recognitionRef.current = rec;
      rec.start();
    } catch (err) {
      setIsListening(false);
      setResponseText(t('voice.no_mic'));
    }
  };

  const [slowMessage, setSlowMessage] = useState(false);
  const sendToBackend = async (text: string) => {
    setIsProcessing(true);
    setSlowMessage(false);
    const slowTimer = setTimeout(() => setSlowMessage(true), 5000);
    try {
      const res = await voiceQuery({
        transcript: text,
        language: langCode,
        sessionContext: sessionContext.slice(-6),
      });
      const reply = (res as { data?: { responseText?: string } })?.data?.responseText ?? t('common.error');
      setResponseText(reply);
      setSlowMessage(false);
      setSessionContext((prev) => [...prev.slice(-8), { role: 'user', content: text }, { role: 'assistant', content: reply }]);
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(reply);
        u.lang = langCode;
        u.rate = 0.9;
        window.speechSynthesis.speak(u);
      }
    } catch {
      setResponseText(t('common.error'));
    } finally {
      clearTimeout(slowTimer);
      setIsProcessing(false);
      setSlowMessage(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) try { recognitionRef.current.stop(); } catch {}
    };
  }, []);

  const [textFallback, setTextFallback] = useState('');
  const hasSpeech = !!SpeechRecognition;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 md:bottom-6 right-6 w-16 h-16 bg-primary-500 text-white rounded-full shadow-primary hover:shadow-primary-hover transition-all hover:-translate-y-px flex items-center justify-center z-50 voice-pulse"
        aria-label="Open voice assistant"
      >
        <Mic className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-20 md:bottom-6 right-6 w-96 bg-surface-card rounded-card shadow-card z-50 overflow-hidden border border-surface-border">
      <div className="bg-primary-500 text-white p-4 flex items-center justify-between">
        <h3 className="font-semibold font-sans">{t('voice.title')}</h3>
        <button onClick={() => setIsOpen(false)} className="hover:bg-primary-400 p-1 rounded" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      {!hasSpeech && (
        <div className="p-3 bg-amber-100 border-b border-amber-200 text-amber-800 text-sm">
          {t('voice.no_mic')}
        </div>
      )}
      <div className="p-4 bg-surface-elevated">
        <div className="flex gap-1 justify-center h-10 items-end">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div
              key={i}
              className={`w-1 bg-primary-500 rounded-full transition-all duration-150 ${
                isListening ? 'animate-pulse' : ''
              }`}
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
          </div>
        )}
      </div>
      <div className="p-4 border-t border-surface-border space-y-2">
        {hasSpeech ? (
          <>
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
          </>
        ) : (
          <>
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
                  sendToBackend(text);
                  setTextFallback('');
                }
              }}
              disabled={!textFallback.trim() || isProcessing}
              className="w-full"
            >
              {isProcessing ? t('voice.thinking') : t('voice.send')}
            </Button>
          </>
        )}
        <p className="text-xs text-center text-text-muted">{t('voice.speak_language')}</p>
      </div>
    </div>
  );
}
