import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEBUG_DIR = join(homedir(), '.escribano/debug/2026-01-15-15-1-2026-2/frames/batch-001');

const files = readdirSync(DEBUG_DIR).filter((f) => f.endsWith('.jpg'));
const uniqueIndices = [...new Set(files.map((f) => f.split('-')[1]))].slice(0, 8);
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

const prompt = `Analyze these ${selectedFiles.length} screenshots. Output EXACTLY ${selectedFiles.length} lines in this format:
[0] description: ... | activity: ... | apps: [...] | topics: [...]
[1] description: ... | activity: ... | apps: [...] | topics: [...]
...
[${selectedFiles.length - 1}] description: ... | activity: ... | apps: [...] | topics: [...]

Activity types: debugging, coding, review, meeting, research, reading, terminal, other

NO JSON. NO thinking. ONLY ${selectedFiles.length} lines.`;

console.log('\n--- Prompt ---\n', prompt);

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
      num_predict: 3000,
    },
  }),
});

const data = await response.json();
const content = data.message.content;
const thinking = data.message.thinking;

console.log('\n--- Content (raw) ---');
console.log(content);

console.log('\n--- Thinking (first 500 chars) ---');
console.log(thinking?.substring(0, 500) || '(empty)');

console.log('\n--- Parsing ---');
const lineRegex =
  /^\[(\d+)\]\s*description:\s*(.+?)\s*\|\s*activity:\s*(\w+)\s*\|\s*apps:\s*(\[.+?\]|[^|]+)\s*\|\s*topics:\s*(\[.+?\]|[^|]+)$/gm;

const results: Array<{
  index: number;
  description: string;
  activity: string;
  apps: string[];
  topics: string[];
}> = [];

let match;
while ((match = lineRegex.exec(content)) !== null) {
  const appsStr = match[4].replace(/^\[|\]$/g, '').trim();
  const topicsStr = match[5].replace(/^\[|\]$/g, '').trim();
  
  results.push({
    index: parseInt(match[1], 10),
    description: match[2].trim(),
    activity: match[3].trim(),
    apps: appsStr ? appsStr.split(',').map((s) => s.trim()) : [],
    topics: topicsStr ? topicsStr.split(',').map((s) => s.trim()) : [],
  });
}

console.log(`\nParsed ${results.length}/${selectedFiles.length} items:`);
console.log(JSON.stringify(results, null, 2));
