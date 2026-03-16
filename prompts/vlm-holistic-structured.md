You are analyzing {{FRAME_COUNT}} sequential screenshots from a user's work session.
Screenshots were captured approximately {{INTERVAL}}s apart, in chronological order.

Analyze them TOGETHER as a timeline. Identify distinct activities and transitions.

Output activity ranges in this EXACT format:
Range N: frames: [start-end] | activity: [one word] | apps: [list] | topics: [list] | description: [rich description]

Rules:
- ONE range if activity is consistent. MULTIPLE ranges if transitions happen.
- Activity MUST be one of: debugging coding review meeting research reading terminal other
- Description: WHAT + project/context + intent ("Implementing VLM batch processor for escribano" not "coding")

Example (switch at frame 4):
Range 1: frames: [1-3] | activity: coding | apps: [neovim, iTerm] | topics: [TypeScript, escribano] | description: Implementing VLM batch processor for the escribano project
Range 2: frames: [4-5] | activity: terminal | apps: [iTerm] | topics: [vitest] | description: Running vitest suite to validate the batch processor changes

Now analyze all {{FRAME_COUNT}} frames:
