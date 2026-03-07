import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { logger } from '../../utils/logger.js';
import { handleConversation } from '../../services/assistant-orchestrator.js';
import type { ConversationRequest } from '../../types/conversation.js';
import { normalizePhoneForUserId } from '../../utils/user-id.js';
import {
  getBinding,
  setBinding,
  getPending,
  setPending,
  clearPending,
  ensureCognitoUser,
  initiateCognitoAuth,
  respondToCognitoAuth,
  looksLikePhone,
  looksLikeOtp,
} from '../../services/telegram-auth.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';
const MAX_MESSAGE_LENGTH = 4096;

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    from?: { id: number; language_code?: string; first_name?: string };
    chat?: { id: number; type?: string };
    date?: number;
    text?: string;
  };
};

async function sendTelegramMessage(chatId: number, text: string, token: string): Promise<void> {
  const url = `${TELEGRAM_API_BASE}${token}/sendMessage`;
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.slice(0, MAX_MESSAGE_LENGTH);
    const lastNewline = slice.lastIndexOf('\n');
    const breakAt = lastNewline > MAX_MESSAGE_LENGTH / 2 ? lastNewline + 1 : MAX_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }
  for (const chunk of chunks) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: undefined }),
    });
    if (!res.ok) {
      const errText = await res.text();
      logger.warn('Telegram sendMessage failed', { status: res.status, body: errText.slice(0, 200) });
    }
  }
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 4) return `****${digits.slice(-4)}`;
  return '****';
}

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    logger.error('TELEGRAM_BOT_TOKEN is not set or empty');
    return { statusCode: 200, body: '' };
  }

  let body: TelegramUpdate = {};
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body ?? {});
  } catch (e) {
    logger.warn('Telegram webhook body parse failed', { error: String(e) });
    return { statusCode: 200, body: '' };
  }

  const message = body.message;
  if (!message?.chat?.id) {
    logger.info('Telegram webhook: no message.chat.id', { update_id: body.update_id });
    return { statusCode: 200, body: '' };
  }

  const chatId = message.chat.id;
  const from = message.from;
  const text = (message.text ?? '').trim();

  const reply = async (msg: string) => {
    await sendTelegramMessage(chatId, msg, token);
  };

  // Resolve identity: if chat is bound to a phone, use it as userId
  const binding = await getBinding(chatId);
  const pending = await getPending(chatId);

  const handleLoggedIn = async (userId: string) => {
    const sessionId = `telegram_${chatId}`;
    const languageCode = from?.language_code && /^[a-z]{2}$/i.test(from.language_code) ? from.language_code : 'en';
    const language = `${languageCode}-IN`;
    const request: ConversationRequest = {
      userId,
      sessionId,
      transcript: text,
      language,
      sessionContext: [],
      idempotencyKey: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      channel: 'telegram',
    };
    try {
      const conv = await handleConversation(request);
      const responseText = conv?.responseText?.trim() || 'I could not generate a response. Please try again.';
      await reply(responseText);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Telegram handleConversation failed', { chatId, error: errMsg });
      await reply('Something went wrong. Please try again in a moment.');
    }
  };

  // Already logged in: use phone as userId
  if (binding?.phone_number) {
    const userId = normalizePhoneForUserId(binding.phone_number);
    if (!userId) {
      await reply('Your linked phone could not be resolved. Send /start to log in again.');
      return { statusCode: 200, body: '' };
    }
    if (!text) {
      await reply('Send a text message to chat with the assistant.');
      return { statusCode: 200, body: '' };
    }
    await handleLoggedIn(userId);
    return { statusCode: 200, body: '' };
  }

  // Not logged in: login flow (phone → OTP → verify)
  if (text === '/start') {
    await reply(
      "Welcome to VaaniSetu. To get started, please send your 10-digit mobile number (e.g. 9876543210). You'll receive an OTP to verify — same login as the web app, so your data stays in sync."
    );
    return { statusCode: 200, body: '' };
  }

  if (text === '/help') {
    await reply(
      'Commands:\n/start - Log in with your phone number (you will get an OTP)\n/help - This message\n\nAfter logging in, you can ask about schemes, jobs, application status, and more — same account as on the web.'
    );
    return { statusCode: 200, body: '' };
  }

  if (!text) {
    await reply('Please send your 10-digit mobile number to log in, or use /start for instructions.');
    return { statusCode: 200, body: '' };
  }

  // Pending OTP: treat next message as OTP
  if (pending) {
    if (looksLikeOtp(text)) {
      const ok = await respondToCognitoAuth(pending.phone_number, pending.cognito_session, text);
      if (ok) {
        const normalizedPhone = pending.phone_number.startsWith('+') ? pending.phone_number : `+91${pending.phone_number.replace(/\D/g, '').slice(-10)}`;
        await setBinding(chatId, normalizedPhone);
        await clearPending(chatId);
        await reply("You're logged in. Your Telegram is now linked to the same account as the web app. Ask me about schemes, jobs, or your application status.");
        return { statusCode: 200, body: '' };
      }
      await reply('Invalid or expired OTP. Please enter the 6-digit code again, or send your phone number to start over.');
      return { statusCode: 200, body: '' };
    }
    if (looksLikePhone(text)) {
      await reply('We are still waiting for your OTP. Enter the 6-digit code sent to your phone, or wait and try again.');
      return { statusCode: 200, body: '' };
    }
    await reply('Please enter the 6-digit OTP we sent to your phone.');
    return { statusCode: 200, body: '' };
  }

  // Need phone: user sent something that might be a phone
  if (looksLikePhone(text)) {
    const digits = text.replace(/\D/g, '').slice(-10);
    const phone = digits.length === 10 ? `+91${digits}` : `+91${text.replace(/\D/g, '').slice(-10)}`;
    const normalizedForCognito = phone;
    await ensureCognitoUser(phone);
    const authResult = await initiateCognitoAuth(phone);
    if (!authResult) {
      await reply('We could not send an OTP to this number. Please check the number and try again, or sign up on the web first.');
      return { statusCode: 200, body: '' };
    }
    await setPending(chatId, authResult.session, normalizedForCognito);
    await reply(`OTP sent to ${maskPhone(phone)}. Please enter the 6-digit code to complete login.`);
    return { statusCode: 200, body: '' };
  }

  await reply('To log in, please send your 10-digit mobile number (e.g. 9876543210). Use /start for more info.');
  return { statusCode: 200, body: '' };
};
