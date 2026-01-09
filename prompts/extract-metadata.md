# Transcript Metadata Extraction

Extract structured metadata from this session transcript.

## Session Classification
{{CLASSIFICATION_SUMMARY}}

Example: "meeting: 85%, learning: 45%"

## Metadata Types to Extract

### 1. Speakers (extract if meeting/tutorial)
List all participants mentioned in the conversation with their roles if provided.

**Fields:**
- `name`: Participant's name
- `role`: Their role/title if mentioned (e.g., "Engineering Lead", "Product Manager")

**Example Output:**
```json
{
  "speakers": [
    {"name": "Alice", "role": "Engineering Lead"},
    {"name": "Bob", "role": "Product Manager"},
    {"name": "Carol", "role": "Designer"}
  ]
}
```

### 2. Key Moments (extract always)
Important timestamps with descriptions of significant events, decisions, or insights.

**Fields:**
- `timestamp`: Time in seconds
- `description`: What happened
- `importance`: "high", "medium", or "low"

**Importance Guidelines:**
- **high**: Major decisions, critical issues, breakthrough insights
- **medium**: Important discussions, technical findings
- **low**: Minor details, background information

**Example Output:**
```json
{
  "keyMoments": [
    {"timestamp": 120, "description": "Decided on Q1 priorities", "importance": "high"},
    {"timestamp": 450, "description": "Identified root cause of authentication bug", "importance": "high"},
    {"timestamp": 600, "description": "Reviewed database schema", "importance": "medium"}
  ]
}
```

### 3. Action Items (extract if meeting/working)
Specific tasks that need to be completed, with owners and priorities.

**Fields:**
- `description`: What needs to be done
- `owner`: Who is responsible (use "Unknown" if unclear)
- `priority`: "high", "medium", or "low"

**Example Output:**
```json
{
  "actionItems": [
    {"description": "Create technical spec for auth feature", "owner": "Alice", "priority": "high"},
    {"description": "Schedule user research sessions", "owner": "Bob", "priority": "medium"},
    {"description": "Update documentation", "owner": "Carol", "priority": "low"}
  ]
}
```

### 4. Technical Terms (extract if debugging/working/learning)
Error messages, file paths, function names, variables, or other technical concepts mentioned.

**Fields:**
- `term`: The technical term
- `context`: Where it was mentioned or what it means
- `type`: One of: "error", "file", "function", "variable", "other"

**Type Guidelines:**
- **error**: Error messages, stack traces, exception names
- **file**: File paths, document names, configuration files
- **function**: Function/method names, API calls
- **variable**: Variable names, constants, configuration keys
- **other**: Other technical terms not fitting above categories

**Example Output:**
```json
{
  "technicalTerms": [
    {"term": "NullPointerException", "context": "User login flow error", "type": "error"},
    {"term": "/api/auth/validate", "context": "Endpoint for validating JWT tokens", "type": "function"},
    {"term": "config.yaml", "context": "Configuration file for auth service", "type": "file"},
    {"term": "MAX_RETRIES", "context": "Environment variable for retry logic", "type": "variable"}
  ]
}
```

### 5. Code Snippets (extract if working/tutorial/learning)
Code examples, commands, or technical explanations with code.

**Fields:**
- `language`: Programming language or command type (e.g., "typescript", "python", "bash")
- `code`: The actual code
- `description`: What the code does (optional)
- `timestamp`: Approximate time in seconds if mentioned (optional)

**Example Output:**
```json
{
  "codeSnippets": [
    {
      "language": "typescript",
      "code": "if (user != null) {\n  validateToken(user.token);\n}",
      "description": "Null check before token validation"
    },
    {
      "language": "bash",
      "code": "npm install --save @auth/sdk",
      "description": "Install authentication SDK"
    }
  ]
}
```

## Output Format

Output ONLY valid JSON with the following structure. If a metadata type doesn't apply to this session, include it as an empty array.

```json
{
  "speakers": [...],
  "keyMoments": [...],
  "actionItems": [...],
  "technicalTerms": [...],
  "codeSnippets": [...]
}
```

## Transcript

{{TRANSCRIPT_SEGMENTS}}
