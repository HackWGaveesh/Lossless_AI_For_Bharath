import type { APIGatewayProxyHandler } from 'aws-lambda';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';

const bedrock = new BedrockRuntimeClient({
  region: 'us-east-1',
  token: process.env.AWS_BEARER_TOKEN_BEDROCK ? {
    token: process.env.AWS_BEARER_TOKEN_BEDROCK,
    expiration: new Date(Date.now() + 3600000)
  } : undefined
});
const MODEL_ID = 'us.amazon.nova-pro-v1:0';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = parseJsonBody(event);
    const userId = getUserIdFromEvent(event, body) ?? 'anonymous';
    const { transcript, language = 'hi-IN', sessionContext = [] } = body as {
      transcript?: string;
      language?: string;
      sessionContext?: { role: string; content: string }[];
    };

    if (!transcript?.trim()) {
      return sendErrorResponse(400, 'Missing transcript');
    }

    logger.info('Voice query via Nova Pro', { userId, language, transcriptLength: transcript.length });

    const langLabel = language.startsWith('hi') ? 'Hindi' : language.startsWith('ta') ? 'Tamil' : language.startsWith('te') ? 'Telugu' : 'English';
    const systemPrompt = `You are VaaniSetu, a helpful voice assistant for rural Indian citizens. Respond in ${langLabel}. Be extremely concise (max 2-3 short sentences). Focus on government schemes and jobs. If unsure, ask for clarification.`;

    const messages = sessionContext.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: [{ text: m.content }],
    }));
    messages.push({
      role: 'user',
      content: [{ text: transcript }],
    });

    let text = '';
    try {
      const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const response = await bedrock.send(
        new ConverseCommand({
          modelId: MODEL_ID,
          system: [{ text: systemPrompt }],
          messages: messages as any,
          inferenceConfig: {
            maxTokens: 200,
            temperature: 0.5,
          },
        })
      );
      text = response.output?.message?.content?.[0]?.text?.trim() ?? '';
    } catch (modelError: any) {
      logger.error('Bedrock Nova failed', {
        error: modelError.message,
        name: modelError.name,
        stack: modelError.stack,
        code: modelError.$metadata?.httpStatusCode
      });
      text = fallbackVoiceReply(String(transcript), language);
    }

    if (!text) text = fallbackVoiceReply(String(transcript), language);

    return sendSuccessResponse({
      responseText: text,
      language,
    });
  } catch (error: any) {
    logger.error('Voice query handler crashed', {
      error: error.message,
      stack: error.stack
    });
    return sendErrorResponse(500, 'Failed to process voice query: ' + error.message);
  }
};

function fallbackVoiceReply(transcript: string, language: string): string {
  const q = transcript.toLowerCase();
  const isHindi = language.startsWith('hi');
  const isTamil = language.startsWith('ta');
  const isTelugu = language.startsWith('te');
  const isMarathi = language.startsWith('mr');
  const isKannada = language.startsWith('kn');

  if (q.includes('scheme') || q.includes('yojana') || q.includes('pm-kisan') || q.includes('ayushman') || q.includes('mudra')) {
    if (isHindi) return 'योजनाओं के लिए कृपया Schemes पेज खोलें। वहाँ Eligibility Calculator से तुरंत जाँच कर सकते हैं।';
    if (isTamil) return 'திட்ட விவரங்களுக்கு Schemes பக்கத்தைத் திறக்கவும். Eligibility Calculator மூலம் உடனே சரிபார்க்கலாம்.';
    if (isTelugu) return 'పథకాల కోసం Schemes పేజీని తెరవండి. Eligibility Calculator తో వెంటనే చెక్ చేయవచ్చు.';
    if (isMarathi) return 'योजनांसाठी Schemes पेज उघडा. Eligibility Calculator वापरून लगेच तपासू शकता.';
    if (isKannada) return 'ಯೋಜನೆಗಳಿಗಾಗಿ Schemes ಪುಟ ತೆರೆಯಿರಿ. Eligibility Calculator ಮೂಲಕ ತಕ್ಷಣ ಪರಿಶೀಲಿಸಬಹುದು.';
    return 'For schemes, open the Schemes page and use the Eligibility Calculator for an instant check.';
  }

  if (q.includes('document') || q.includes('aadhaar') || q.includes('pan') || q.includes('passbook')) {
    if (isHindi) return 'दस्तावेज़ अपलोड के लिए Documents पेज पर जाएँ। फ़ाइल अपलोड के बाद स्थिति वहीं दिखेगी।';
    if (isTamil) return 'ஆவணத்தை பதிவேற்ற Documents பக்கத்துக்கு செல்லவும். பதிவேற்றம் ஆன பிறகு நிலை அங்கே காணப்படும்.';
    if (isTelugu) return 'డాక్యుమెంట్ అప్‌లోడ్ కోసం Documents పేజీకి వెళ్లండి. అప్‌లోడ్ తర్వాత స్టేటస్ అక్కడే కనిపిస్తుంది.';
    if (isMarathi) return 'कागदपत्र अपलोडसाठी Documents पेजला जा. अपलोडनंतर स्थिती तिथेच दिसेल.';
    if (isKannada) return 'ದಾಖಲೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಲು Documents ಪುಟಕ್ಕೆ ಹೋಗಿ. ಅಪ್‌ಲೋಡ್ ನಂತರ ಸ್ಥಿತಿ ಅಲ್ಲೇ ಕಾಣುತ್ತದೆ.';
    return 'For document upload, go to the Documents page. After upload, status will appear there.';
  }

  if (isHindi) return 'मैं आपकी मदद के लिए तैयार हूँ। कृपया अपना सवाल योजनाओं, दस्तावेज़ों या आवेदन स्थिति पर पूछें।';
  if (isTamil) return 'உங்களுக்கு உதவ நான் தயாராக இருக்கிறேன். திட்டங்கள், ஆவணங்கள் அல்லது விண்ணப்ப நிலை பற்றி கேளுங்கள்.';
  if (isTelugu) return 'నేను మీకు సహాయం చేయడానికి సిద్ధంగా ఉన్నాను. పథకాలు, డాక్యుమెంట్లు లేదా అప్లికేషన్ స్థితి గురించి అడగండి.';
  if (isMarathi) return 'मी मदतीसाठी तयार आहे. योजना, कागदपत्रे किंवा अर्ज स्थितीबद्दल विचारा.';
  if (isKannada) return 'ನಾನು ಸಹಾಯಕ್ಕೆ ಸಿದ್ಧನಿದ್ದೇನೆ. ಯೋಜನೆಗಳು, ದಾಖಲೆಗಳು ಅಥವಾ ಅರ್ಜಿ ಸ್ಥಿತಿಯ ಬಗ್ಗೆ ಕೇಳಿ.';
  return 'I am ready to help. Ask about schemes, documents, or application status.';
}
