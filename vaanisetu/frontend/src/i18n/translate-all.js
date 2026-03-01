import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new BedrockRuntimeClient({ region: 'us-east-1' });

// Load translations.ts
const filePath = path.join(__dirname, 'translations.ts');
let fileContent = fs.readFileSync(filePath, 'utf8');

const enMatch = fileContent.match(/const en: TranslationMap = (\{[\s\S]*?\n\});/);
if (!enMatch) {
    console.error("Could not find en map");
    process.exit(1);
}

const enCode = `return ${enMatch[1]}`;
const enMap = new Function(enCode)();

function chunkObject(obj, size) {
    const keys = Object.keys(obj);
    const chunks = [];
    for (let i = 0; i < keys.length; i += size) {
        const chunk = {};
        keys.slice(i, i + size).forEach(k => chunk[k] = obj[k]);
        chunks.push(chunk);
    }
    return chunks;
}

async function translateChunk(chunk, langName) {
    const prompt = `Translate the JSON string values from English to ${langName}. Do NOT translate the keys. Return exactly the same format JSON.
${JSON.stringify(chunk, null, 2)}`;

    const response = await client.send(new ConverseCommand({
        modelId: 'us.amazon.nova-pro-v1:0',
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 4096, temperature: 0 },
    }));

    let text = response.output.message.content[0].text.trim();
    if (text.startsWith('```json')) text = text.replace(/^```json/, '');
    if (text.endsWith('```')) text = text.replace(/```$/, '');

    return JSON.parse(text);
}

async function translateFull(langName) {
    const chunks = chunkObject(enMap, 50);
    let result = {};
    for (let i = 0; i < chunks.length; i++) {
        console.log(` Translating to ${langName} chunk ${i + 1}/${chunks.length}...`);
        try {
            const translated = await translateChunk(chunks[i], langName);
            Object.assign(result, translated);
        } catch (e) {
            console.error(`Failed to translate chunk for ${langName}`, e.message);
        }
    }
    return result;
}

async function run() {
    const langs = [
        { code: 'ta', name: 'Tamil' },
        { code: 'te', name: 'Telugu' },
        { code: 'mr', name: 'Marathi' },
    ];

    for (const lang of langs) {
        console.log(`Starting translation for ${lang.name}...`);
        const translatedMap = await translateFull(lang.name);

        // Convert to string representation
        const mapString = `const ${lang.code}: TranslationMap = {\n` +
            Object.entries(translatedMap).map(([k, v]) => `  '${k}': ${JSON.stringify(v)}`).join(',\n') +
            '\n};\n\n';

        // Replace existing block
        const regex = new RegExp(`const ${lang.code}: TranslationMap = \\{[\\s\\S]*?\\n\\};\\n\\n`);
        if (fileContent.match(regex)) {
            fileContent = fileContent.replace(regex, mapString);
        }
    }

    fs.writeFileSync(filePath, fileContent);
    console.log('Translations successfully updated in translations.ts');
}

run();
