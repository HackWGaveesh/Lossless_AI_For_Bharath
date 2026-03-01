import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import * as fs from 'fs';
import * as path from 'path';

const client = new BedrockRuntimeClient({ region: 'us-east-1' });

export type TranslationMap = Record<string, string>;

// Use a simplified version of the en map from translations.ts for translation
const fileContent = fs.readFileSync(path.join(__dirname, '../frontend/src/i18n/translations.ts'), 'utf8');

const match = fileContent.match(/const en: TranslationMap = (\{[\s\S]*?\n\});/);
if (!match) throw new Error("Could not find en map");

// We need to carefully parse the en map out so we can translate values.
const enCode = `return ${match[1]}`;
const enMap = new Function(enCode)();

async function translateMap(langName: string): Promise<Record<string, string>> {
    const jsonStr = JSON.stringify(enMap);
    const prompt = `You are a professional translator. Translate the following JSON values from English to ${langName}. DO NOT translate the JSON keys. Keep exactly the same keys. The context is a Government Scheme portal for rural citizens in India. Some terms like 'Dashboard', 'Schemes', 'OTP' can be transliterated.
Return ONLY valid JSON.
{
  ...
}

Here is the JSON to translate:
${jsonStr}`;

    console.log(`Translating to ${langName}...`);
    const response = await client.send(new ConverseCommand({
        modelId: 'us.amazon.nova-pro-v1:0',
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 4096, temperature: 0 },
    }));

    let content = response.output?.message?.content?.[0]?.text || '';
    content = content.trim();
    if (content.startsWith('```json')) content = content.slice(7);
    if (content.endsWith('```')) content = content.slice(0, -3);

    return JSON.parse(content.trim());
}

async function run() {
    try {
        const ta = await translateMap('Tamil');
        const te = await translateMap('Telugu');
        const mr = await translateMap('Marathi');

        let newFileContent = fileContent;

        // Insert new maps
        const generateStr = (map: Record<string, string>, name: string) => {
            return `const ${name}: TranslationMap = {\n` + Object.entries(map).map(([k, v]) => `  '${k}': ${JSON.stringify(v)}`).join(',\n') + '\n};\n\n';
        };

        const taStr = generateStr(ta, 'ta');
        const teStr = generateStr(te, 'te');
        const mrStr = generateStr(mr, 'mr');

        // Replace the exports
        const exportBlock = `export const translations: Record<Language, TranslationMap> = {
  en,
  hi,
  ta,
  te,
  mr,
  kn,
};`;

        newFileContent = newFileContent.replace(/export const translations: Record<Language, TranslationMap> = \{[\s\S]*?\};/, exportBlock);

        // Insert just before translations export
        newFileContent = newFileContent.replace(/export const translations: Record<Language, TranslationMap>/, taStr + teStr + mrStr + 'export const translations: Record<Language, TranslationMap>');

        fs.writeFileSync(path.join(__dirname, '../frontend/src/i18n/translations.ts'), newFileContent);
        console.log("Translations successfully updated.");

    } catch (err) {
        console.error(err);
    }
}

run();
