import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from 'react-query';
import { voiceQuery } from '../services/api';

const LANG_MAP: Record<string, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  mr: 'mr-IN',
  kn: 'kn-IN',
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

type SupportedLanguage = 'en' | 'hi' | 'ta' | 'te' | 'mr' | 'kn';

const SESSION_STORAGE_KEY = 'vaanisetu_assistant_session_id';
const MESSAGES_LIMIT = 100;
const CONTEXT_TURNS = 12;

function getOrCreateSessionId(sharedKey?: string): string {
  const key = sharedKey ?? SESSION_STORAGE_KEY;
  const existing = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
  if (existing) return existing;
  const created = `assistant-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, created);
  return created;
}

export interface UseAssistantConversationOptions {
  /** BCP-47 language code (e.g. hi-IN). */
  langCode: string;
  /** Channel sent to backend: assistant_page | voice_widget */
  channel: 'assistant_page' | 'voice_widget';
  /** Persist messages to sessionStorage under this session id. If not set, uses shared default and persists. */
  persistMessages?: boolean;
  /** Shared session key so widget and full page can share the same session. */
  sessionStorageKey?: string;
  /** Called when backend indicates language was updated (e.g. setLanguage from context). */
  onLanguageUpdated?: (lang: SupportedLanguage) => void;
  /** Fallback error message (e.g. t('common.error')). */
  errorMessage?: string;
}

export interface UseAssistantConversationReturn {
  sessionId: string;
  messages: ChatMessage[];
  loading: boolean;
  execution: Record<string, unknown> | null;
  pendingAction: Record<string, unknown> | null;
  setPendingAction: (v: Record<string, unknown> | null) => void;
  storedConfirmationToken: string | null;
  cards: Array<Record<string, unknown>>;
  groundingSources: string[];
  budgetMode: 'normal' | 'guarded' | 'strict';
  responseMode: string;
  lastPayload: Record<string, unknown> | null;
  sendMessage: (rawText?: string, opts?: { confirmationToken?: string | null }) => Promise<void>;
  clearSession: () => void;
}

export function useAssistantConversation(
  options: UseAssistantConversationOptions
): UseAssistantConversationReturn {
  const {
    langCode,
    channel,
    persistMessages = true,
    sessionStorageKey = SESSION_STORAGE_KEY,
    onLanguageUpdated,
    errorMessage = 'Something went wrong.',
  } = options;

  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState(() => getOrCreateSessionId(sessionStorageKey));
  const messagesKey = `vaanisetu_assistant_messages_${sessionId}`;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [execution, setExecution] = useState<Record<string, unknown> | null>(null);
  const [pendingAction, setPendingAction] = useState<Record<string, unknown> | null>(null);
  const [storedConfirmationToken, setStoredConfirmationToken] = useState<string | null>(null);
  const [cards, setCards] = useState<Array<Record<string, unknown>>>([]);
  const [groundingSources, setGroundingSources] = useState<string[]>([]);
  const [budgetMode, setBudgetMode] = useState<'normal' | 'guarded' | 'strict'>('normal');
  const [responseMode, setResponseMode] = useState<string>('workflow');
  const [lastPayload, setLastPayload] = useState<Record<string, unknown> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!persistMessages) return;
    try {
      const stored = sessionStorage.getItem(messagesKey);
      if (stored) {
        const parsed = JSON.parse(stored) as ChatMessage[];
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch {
      // ignore
    }
  }, [messagesKey, persistMessages]);

  useEffect(() => {
    if (!persistMessages) return;
    sessionStorage.setItem(messagesKey, JSON.stringify(messages.slice(-MESSAGES_LIMIT)));
  }, [messages, messagesKey, persistMessages]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearSession = useCallback(() => {
    setMessages([]);
    setPendingAction(null);
    setStoredConfirmationToken(null);
    setCards([]);
    setExecution(null);
    setGroundingSources([]);
    setResponseMode('workflow');
    setLastPayload(null);
    if (persistMessages) {
      try {
        sessionStorage.removeItem(messagesKey);
        sessionStorage.removeItem(sessionStorageKey);
      } catch { /* noop */ }
    }
    const newSessionId = `assistant-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(sessionStorageKey, newSessionId);
    setSessionId(newSessionId);
  }, [messagesKey, persistMessages, sessionStorageKey]);

  const sendMessage = useCallback(
    async (rawText?: string, opts?: { confirmationToken?: string | null }) => {
      const text = (rawText ?? '').trim();
      if (!text || loading) return;

      setLoading(true);
      const optimisticUser: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
      setMessages((prev) => [...prev, optimisticUser]);

      // Auto-attach stored token when user voice-confirms a pending application
      const isVoiceConfirm =
        /^(yes|haan|haanji|ha|ok|okay|confirm|proceed|seri|avunu|ho|theek hai|bilkul|zaroor|accha|சரி|அவுனு|అవును|సరే|ಹೌದು|ಸರಿ|हां|ठीक है|हो|हाँ)$/i
          .test(text.trim());

      const effectiveToken: string | undefined =
        opts?.confirmationToken !== undefined && opts.confirmationToken !== null
          ? opts.confirmationToken
          : isVoiceConfirm && pendingAction?.type === 'application_confirm' && storedConfirmationToken
            ? storedConfirmationToken
            : undefined;

      try {
        const res = await voiceQuery({
          transcript: text,
          language: langCode,
          sessionId,
          sessionContext: messages.slice(-CONTEXT_TURNS).map((m) => ({ role: m.role, content: m.content })),
          idempotencyKey: `${channel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          channel,
          confirmationToken: effectiveToken,
        });

        if (!mountedRef.current) return;
        const payload = (res as { data?: Record<string, unknown> })?.data ?? (res as Record<string, unknown>);

        if (Array.isArray(payload.messages) && payload.messages.length > 0) {
          const normalized: ChatMessage[] = (payload.messages as Array<{ role?: string; content?: string; timestamp?: number }>)
            .map((m) => ({
              role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
              content: String(m.content ?? ''),
              timestamp: Number(m.timestamp ?? Date.now()),
            }))
            .filter((m) => m.content.trim().length > 0);
          setMessages(normalized.slice(-MESSAGES_LIMIT));
        } else {
          const assistantReply: ChatMessage = {
            role: 'assistant',
            content: String(payload.responseText ?? errorMessage),
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, assistantReply].slice(-MESSAGES_LIMIT));
        }

        setExecution((payload.execution as Record<string, unknown>) ?? null);

        const incomingPending = (payload.pendingAction ?? payload.pendingConfirmation) as Record<string, unknown> | null ?? null;
        setPendingAction(incomingPending);
        // Store confirmation token when application_confirm arrives
        if (
          incomingPending?.type === 'application_confirm' &&
          typeof incomingPending.confirmationToken === 'string' &&
          incomingPending.confirmationToken
        ) {
          setStoredConfirmationToken(incomingPending.confirmationToken as string);
        } else if (!incomingPending) {
          setStoredConfirmationToken(null); // clear after submission
        }

        setCards((Array.isArray(payload.cards) ? payload.cards : []) as Array<Record<string, unknown>>);
        setGroundingSources(Array.isArray((payload.grounding as { sources?: string[] })?.sources) ? (payload.grounding as { sources: string[] }).sources : []);
        setBudgetMode((payload.budgetMode as 'normal' | 'guarded' | 'strict') ?? 'normal');
        setResponseMode(String(payload.responseMode ?? 'workflow'));
        setLastPayload(payload);

        const maybeLang = String(
          (payload.execution as Record<string, unknown>)?.entities &&
            typeof (payload.execution as Record<string, unknown>).entities === 'object' &&
            (payload.execution as Record<string, unknown>).entities !== null
            ? ((payload.execution as Record<string, unknown>).entities as Record<string, unknown>).preferredLanguage
            : ''
        ).trim() as SupportedLanguage;
        if (payload.actionResultType === 'language_updated' && ['en', 'hi', 'ta', 'te', 'mr', 'kn'].includes(maybeLang)) {
          onLanguageUpdated?.(maybeLang);
        }
        if (payload.applicationSubmitted) {
          queryClient.invalidateQueries('applications');
          queryClient.invalidateQueries('userStats');
        }
      } catch {
        if (!mountedRef.current) return;
        setMessages((prev): ChatMessage[] => {
          const fallback: ChatMessage = {
            role: 'assistant',
            content: errorMessage,
            timestamp: Date.now(),
          };
          return [...prev, fallback].slice(-MESSAGES_LIMIT);
        });
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [
      langCode,
      sessionId,
      channel,
      messages,
      loading,
      errorMessage,
      onLanguageUpdated,
      queryClient,
      pendingAction,
      storedConfirmationToken,
    ]
  );

  return {
    sessionId,
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
    lastPayload,
    sendMessage,
    clearSession,
  };
}

export { LANG_MAP };
