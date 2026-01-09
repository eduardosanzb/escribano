#!/usr/bin/env npx tsx

/**
 * Test different classification prompts to find the best approach
 * for handling mixed-type sessions
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStorageService } from './adapters/storage.adapter.js';
import type { Transcript, IntelligenceConfig } from './0_types.js';

// Test Prompts
const PROMPTS = {
  // Approach A: Current style but clearer
  strictSingle: `You are a session classifier. Analyze this transcript and output ONLY valid JSON.

Session types:
- meeting: Conversations, interviews, discussions between people
- debugging: Fixing issues, troubleshooting, error analysis
- tutorial: Teaching, explaining, demonstrating how to do something
- learning: Researching, studying, exploring new concepts

Output exactly this JSON structure:
{ "type": "meeting|debugging|tutorial|learning", "confidence": 0.0-1.0 }

Transcript: {{TRANSCRIPT}}`,

  // Approach B: Multi-label scoring
  multiLabel: `Rate how much this transcript matches each session type (0-100):

Session types:
- meeting: Conversations, interviews, discussions between people
- debugging: Fixing issues, troubleshooting, error analysis
- tutorial: Teaching, explaining, demonstrating how to do something
- learning: Researching, studying, exploring new concepts

Output JSON with all types scored:
{ "classifications": { "meeting": 85, "debugging": 10, "tutorial": 20, "learning": 45 } }

Transcript: {{TRANSCRIPT}}`,

  // Approach C: Primary + Secondary
  primarySecondary: `Identify the PRIMARY type and any SECONDARY types that apply.

Session types:
- meeting: Conversations, interviews, discussions between people
- debugging: Fixing issues, troubleshooting, error analysis
- tutorial: Teaching, explaining, demonstrating how to do something
- learning: Researching, studying, exploring new concepts

Output JSON with structure shown:
{ "primary": { "type": "meeting|debugging|tutorial|learning", "confidence": 0.0-1.0 }, "secondary": ["type1", "type2"] }

Transcript: {{TRANSCRIPT}}`,

  // Approach D: Array of applicable types
  arrayTypes: `List ALL session types that apply with confidence scores.

Session types:
- meeting: Conversations, interviews, discussions between people
- debugging: Fixing issues, troubleshooting, error analysis
- tutorial: Teaching, explaining, demonstrating how to do something
- learning: Researching, studying, exploring new concepts

Output JSON with array of applicable types (include if confidence > 0.3):
{ "types": [ {"type": "meeting", "confidence": 0.85} ] }

Transcript: {{TRANSCRIPT}}`,
};

async function testPrompt(
  name: string,
  prompt: string,
  transcript: Transcript,
  intelligenceConfig: IntelligenceConfig
): Promise<any> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`${'='.repeat(60)}`);

  const finalPrompt = prompt.replace('{{TRANSCRIPT}}', transcript.fullText);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000000);

    const response = await fetch(intelligenceConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: intelligenceConfig.model,
        messages: [{ role: 'system', content: finalPrompt }],
        stream: false,
        format: 'json',
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    console.log('Result:');
    console.log(JSON.stringify(result, null, 2));

    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Error: Request timed out after 30s');
    } else {
      console.error('Error:', error);
    }
    return null;
  }
}

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error('Usage: pnpm run test-prompts <session-id>');
    console.error('Example: pnpm run test-prompts "Your Recording.cap"');
    process.exit(1);
  }

  console.log(`\n🔍 Testing classification prompts for: ${sessionId}`);

  const storage = createStorageService();
  const session = await storage.loadSession(sessionId);

  if (!session || !session.transcripts || session.transcripts.length === 0) {
    console.error(`\n❌ Session not found or has no transcripts: ${sessionId}`);
    console.error('\nTo find sessions, run:');
    console.error('  pnpm run list');
    process.exit(1);
  }

  const transcript = session.transcripts[0].transcript;

  console.log(`✓ Transcript length: ${transcript.fullText.length} chars`);
  console.log(`✓ Number of segments: ${transcript.segments.length}`);
  console.log(`✓ Audio source: ${session.transcripts[0].source}`);
  console.log(`\n⏱️  Running 4 classification tests...\n`);

  // Intelligence config
  const intelligenceConfig: IntelligenceConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen3:32b',
    maxRetries: 1,
    timeout: 3000000,
  };

  // Test each prompt
  const results: Record<string, any> = {};
  let testNum = 1;

  for (const [name, prompt] of Object.entries(PROMPTS)) {
    console.log(`\n[${testNum}/4] Running test...`);
    results[name] = await testPrompt(
      name,
      prompt,
      transcript,
      intelligenceConfig
    );

    testNum++;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 FINAL SUMMARY');
  console.log(`${'='.repeat(60)}`);

  for (const [name, result] of Object.entries(results)) {
    console.log(
      `\n${name
        .toUpperCase()
        .replace(/([A-Z])/g, ' $1')
        .trim()}:`
    );
    if (result) {
      // Try to extract key info for quick comparison
      if (result.type) {
        console.log(`  Primary Type: ${result.type}`);
        if (result.confidence)
          console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      } else if (result.classifications) {
        console.log('  Scores:', JSON.stringify(result.classifications));
      } else if (result.primary) {
        console.log(
          `  Primary: ${result.primary.type} (${(result.primary.confidence * 100).toFixed(0)}%)`
        );
        if (result.secondary?.length)
          console.log(`  Secondary: [${result.secondary.join(', ')}]`);
      } else if (result.types) {
        console.log(
          `  Types: ${result.types.map((t: any) => `${t.type} (${(t.confidence * 100).toFixed(0)}%)`).join(', ')}`
        );
      } else {
        console.log(`  Raw:`, JSON.stringify(result));
      }
    } else {
      console.log('  ❌ Failed or timed out');
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ All tests complete!');
  console.log(`${'='.repeat(60)}\n`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
