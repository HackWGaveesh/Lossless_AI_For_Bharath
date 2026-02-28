import { pdf } from 'pdf-to-img';
import fs from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

config({ path: resolve(import.meta.dirname, '../../.env') });

const bedrock = new BedrockRuntimeClient({
    region: 'us-east-1',
    token: process.env.AWS_BEARER_TOKEN_BEDROCK ? {
        token: process.env.AWS_BEARER_TOKEN_BEDROCK,
        expiration: new Date(Date.now() + 3600000)
    } : undefined
} as any);

async function testPdfOcr() {
    const pdfPath = 'C:\\Users\\gavee\\Downloads\\Pan (1).pdf';

    if (!fs.existsSync(pdfPath)) {
        console.error('PAN PDF not found at:', pdfPath);
        return;
    }

    console.log('=== Testing PDF-to-Image conversion ===');
    const pdfBuffer = fs.readFileSync(pdfPath);

    let pageNum = 0;
    const images: Buffer[] = [];

    for await (const image of await pdf(pdfBuffer, { scale: 2.0 })) {
        pageNum++;
        console.log(`Page ${pageNum}: ${image.length} bytes (${(image.length / 1024).toFixed(1)}KB)`);
        images.push(Buffer.from(image));
        if (pageNum >= 2) break; // Only first 2 pages
    }

    if (images.length === 0) {
        console.error('No pages converted!');
        return;
    }

    // Save first page for inspection
    fs.writeFileSync('test-pan-page1.png', images[0]);
    console.log(`\nSaved first page as test-pan-page1.png (${(images[0].length / 1024).toFixed(1)}KB)`);

    // Send first page to Bedrock
    console.log('\n=== Sending to Bedrock Nova Pro for OCR ===');

    const prompt = `You are an expert Indian government document OCR engine.

TASK: Analyze this PAN card document image.

CRITICAL RULES:
1. This image may be LOW QUALITY. Try your HARDEST to read it.
2. Return ONLY a flat JSON object with string values.
3. NO nested objects. NO arrays. NO markdown.

FIELDS TO EXTRACT:
- Full Name
- Father's Name
- Date Of Birth
- PAN Number (mask middle as ABCDE****F)
- Signature Present (yes/no)

RESPONSE FORMAT:
{"Full Name": "...", "Father Name": "...", "Date Of Birth": "...", "PAN Number": "...", "Signature Present": "..."}`;

    try {
        const response = await bedrock.send(new ConverseCommand({
            modelId: 'us.amazon.nova-pro-v1:0',
            messages: [{
                role: 'user',
                content: [
                    { text: prompt },
                    { image: { format: 'png', source: { bytes: images[0] } } }
                ]
            }],
            inferenceConfig: { maxTokens: 500, temperature: 0.1 }
        }));

        const result = response.output?.message?.content?.[0]?.text;
        console.log('\n=== BEDROCK RESPONSE ===');
        console.log(result);
    } catch (err: any) {
        console.error('\nBedrock error:', err.message);
    }
}

testPdfOcr();
