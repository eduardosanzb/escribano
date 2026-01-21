# Topic Classification Prompt

You are analyzing a cluster of observations from a screen recording session.

## Input
A list of observation summaries containing:
- OCR text from screenshots
- VLM descriptions of visual content
- Audio transcripts

## Task
Generate 1-3 specific, descriptive topic labels that capture what the user was doing.

## Rules
- Be specific: "debugging whisper hallucinations" not just "debugging"
- Be descriptive: "learning Ollama embeddings" not just "learning"
- Focus on the USER'S ACTIVITY, not just visible content
- Max 3 topics per cluster
- Output MUST be valid JSON

## Output Format
```json
{"topics": ["topic 1", "topic 2"]}
```
