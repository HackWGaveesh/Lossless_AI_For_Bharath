import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import Button from '../Common/Button';
import { voiceQuery } from '../../services/api';
import { useLanguage } from '../../contexts/LanguageContext';

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
  const langCode = LANG_MAP[language] ?? 'hi-IN';

  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [responseText, setResponseText] = useState('');
  const [sessionContext, setSessionContext] = useState<{ role: string; content: string }[]>([]);
  const [slowMessage, setSlowMessage] = useState(false);
  const [textFallback, setTextFallback] = useState('');
  const [speechRecognition, setSpeechRecognition] = useState<any>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = langCode;

      recognition.onstart = () => {
        setIsListening(true);
        setResponseText('');
        setTranscript('');
      };

      recognition.onresult = (event: any) => {
        const result = event.results[event.results.length - 1];
        const text = result[0].transcript;
        setTranscript(text);
        if (result.isFinal) {
          stopListening();
          void sendToBackend(text);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          setResponseText('Microphone permission denied. Please allow access.');
        } else {
          setResponseText('Speech error. Please try again or type.');
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      setSpeechRecognition(recognition);
    }
  }, [langCode]);

  const sendToBackend = async (text: string) => {
    if (!mountedRef.current || !text.trim()) return;
    setIsProcessing(true);
    setSlowMessage(false);
    const slowTimer = setTimeout(() => {
      if (mountedRef.current) setSlowMessage(true);
    }, 5000);
    try {
      const res = await voiceQuery({
        transcript: text,
        language: langCode,
        sessionContext: sessionContext.slice(-6),
      });
      if (!mountedRef.current) return;

      const payload = (res as any).data || res;
      const reply = payload.responseText ?? t('common.error');

      setResponseText(reply);
      setSessionContext((prev) => [...prev.slice(-8), { role: 'user', content: text }, { role: 'assistant', content: reply }]);

      if (typeof window !== 'undefined' && window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(reply);
        utter.lang = langCode;
        utter.rate = 1.0;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
      }
    } catch (err) {
      console.error('Voice query error:', err);
      if (mountedRef.current) setResponseText(t('common.error'));
    } finally {
      clearTimeout(slowTimer);
      if (mountedRef.current) {
        setIsProcessing(false);
        setSlowMessage(false);
      }
    }
  };

  const startListening = () => {
    if (!speechRecognition) {
      setResponseText('Speech recognition not supported in this browser.');
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
      } catch (err) { }
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
