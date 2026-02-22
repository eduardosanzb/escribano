import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEBUG_DIR = join(homedir(), '.escribano/debug/2026-01-15-15-1-2026-2/frames/batch-001');

const files = readdirSync(DEBUG_DIR).filter((f) => f.endsWith('.jpg'));
const uniqueIndices = [...new Set(files.map((f) => f.split('-')[1]))].slice(0, 4);
const selectedFiles = uniqueIndices.flatMap((idx) => {
  const match = files.find((f) => f.startsWith(`frame-${idx}`));
  return match ? [match] : [];
});

console.log('Selected frames:', selectedFiles);

const base64Images: string[] = [];
for (const file of selectedFiles) {
  const buffer = readFileSync(join(DEBUG_DIR, file));
  base64Images.push(buffer.toString('base64'));
}

// Test with /no_think prefix
const prompt = `/no_think
Analyze these ${selectedFiles.length} screenshots. Output EXACTLY ${selectedFiles.length} lines in this format:
[0] description: ... | activity: ... | apps: [...] | topics: [...]
[1] description: ... | activity: ... | apps: [...] | topics: [...]
...
[${selectedFiles.length - 1}] description: ... | activity: ... | apps: [...] | topics: [...]

Activity types: debugging, coding, review, meeting, research, reading, terminal, other

ONLY ${selectedFiles.length} lines.`;

const response = await fetch('http://localhost:11434/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'qwen3-vl:4b',
    messages: [
      {
        role: 'user',
        content: prompt,
        images: base64Images,
      },
    ],
    stream: false,
    options: {
      num_predict: 2000,
    },
  }),
});

const data = await response.json();
const content = data.message.content;
const thinking = data.message.thinking;

console.log('\n--- Content ---');
console.log(content);

console.log('\n--- Thinking ---');
console.log(thinking ? `${thinking.length} chars` : '(empty)');
console.log(thinking?.substring(0, 300) || '(empty)');
