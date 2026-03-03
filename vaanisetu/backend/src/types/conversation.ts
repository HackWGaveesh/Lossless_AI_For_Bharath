export type ConversationChannel =
  | 'assistant_page'
  | 'voice_widget'
  | 'voice'
  | string;

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export interface ConversationRequest {
  userId: string;
  sessionId: string;
  transcript: string;
  language: string;
  channel: ConversationChannel;
  /**
   * Recent turns from the client; server will merge with persisted history.
   */
  sessionContext: ConversationTurn[];
  idempotencyKey?: string;
  forceLanguage?: string;
  confirmationToken?: string;
}

export type ResponseMode = 'agent' | 'workflow' | 'direct_model';

export interface ConversationExecution {
  state?: string;
  intent?: string;
  confidence?: number;
  entities?: Record<string, unknown>;
  steps?: string[];
}

export interface ConversationResponse {
  responseText: string;
  language: string;
  agentUsed: boolean;
  responseMode: ResponseMode;
  applicationSubmitted: boolean;
  applicationId: string | null;
  pendingConfirmation: Record<string, any> | null;
  pendingAction: Record<string, any> | null;
  cards: Array<Record<string, any>>;
  execution: ConversationExecution | null;
  actionResultType: string | null;
  matchReasons: string[];
  grounding: { sources: string[] } | null;
  messages: Array<{ role: string; content: string; timestamp: number }>;
  agentTrace: { actionCalled?: string | null; agentUsed?: boolean } | null;
  guardrailApplied: boolean;
  serviceTrace: Record<string, any> | null;
  budgetMode: 'normal' | 'guarded' | 'strict';
}

