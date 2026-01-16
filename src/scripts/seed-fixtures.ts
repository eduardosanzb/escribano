/**
 * Seed Fixtures for Escribano Artifact Testing
 *
 * Injects synthetic sessions with realistic transcripts into storage
 * to test all 8 artifact generation prompts.
 */

import type { Classification, Session, Transcript } from '../0_types.js';
import { createFsStorageService } from '../adapters/storage.fs.adapter.js';

const storage = createFsStorageService();

const createBaseSession = (
  id: string,
  transcript: Transcript,
  classification: Classification
): Session => {
  const date = new Date();
  return {
    id,
    recording: {
      id: `rec-${id}`,
      source: { type: 'raw', originalPath: `/fixtures/${id}` },
      videoPath: null,
      audioMicPath: `/fixtures/${id}/audio.mp3`,
      audioSystemPath: null,
      duration: transcript.duration,
      capturedAt: date,
    },
    transcripts: [{ source: 'mic', transcript }],
    visualLogs: [],
    status: 'classified',
    classification,
    metadata: null,
    artifacts: [],
    createdAt: date,
    updatedAt: date,
  };
};

const FIXTURES: Session[] = [
  // 1. DEBUGGING -> Runbook
  createBaseSession(
    'fixture-debugging',
    {
      fullText:
        "Okay, I'm seeing a hydration error in the console. 'Text content does not match server-rendered HTML'. It's happening in the Header component. Let me check the code. Ah, I see, I'm using a random number in the rendering. That's a classic mistake. The server generates one number, the client generates another. I should move this to a useEffect or use a constant. Let me try using a fixed ID for now. Okay, applied the fix. Refreshing... Error is gone. Verification successful.",
      segments: [
        {
          id: '1',
          start: 0,
          end: 10,
          text: "Okay, I'm seeing a hydration error in the console.",
        },
        {
          id: '2',
          start: 10,
          end: 20,
          text: "'Text content does not match server-rendered HTML'.",
        },
        {
          id: '3',
          start: 20,
          end: 30,
          text: "It's happening in the Header component. Let me check the code.",
        },
        {
          id: '4',
          start: 30,
          end: 45,
          text: "Ah, I see, I'm using a random number in the rendering. That's a classic mistake.",
        },
        {
          id: '5',
          start: 45,
          end: 60,
          text: 'I should move this to a useEffect or use a constant.',
        },
        {
          id: '6',
          start: 60,
          end: 75,
          text: 'Let me try using a fixed ID for now. Okay, applied the fix.',
        },
        {
          id: '7',
          start: 75,
          end: 90,
          text: 'Refreshing... Error is gone. Verification successful.',
        },
      ],
      language: 'en',
      duration: 90,
    },
    { meeting: 0, debugging: 95, tutorial: 10, learning: 20, working: 30 }
  ),

  // 2. TUTORIAL -> Step-by-Step
  createBaseSession(
    'fixture-tutorial',
    {
      fullText:
        "Today I will show you how to set up a Docker container for a Node.js app. First, you need to create a Dockerfile in your root directory. Inside, start with 'FROM node:18'. Then set the working directory to /app. Next, copy the package.json and run 'npm install'. After that, copy the rest of your files. Finally, expose port 3000 and run 'node index.js'. To build it, run 'docker build -t my-app .'. Then run it with 'docker run -p 3000:3000 my-app'. If you see an error about port already in use, make sure to stop any other containers first.",
      segments: [
        {
          id: '1',
          start: 0,
          end: 10,
          text: 'Today I will show you how to set up a Docker container for a Node.js app.',
        },
        {
          id: '2',
          start: 10,
          end: 25,
          text: 'First, you need to create a Dockerfile in your root directory.',
        },
        {
          id: '3',
          start: 25,
          end: 35,
          text: "Inside, start with 'FROM node:18'. Then set the working directory to /app.",
        },
        {
          id: '4',
          start: 35,
          end: 50,
          text: "Next, copy the package.json and run 'npm install'. After that, copy the rest of your files.",
        },
        {
          id: '5',
          start: 50,
          end: 65,
          text: "Finally, expose port 3000 and run 'node index.js'.",
        },
        {
          id: '6',
          start: 65,
          end: 80,
          text: "To build it, run 'docker build -t my-app .'.",
        },
        {
          id: '7',
          start: 80,
          end: 95,
          text: "Then run it with 'docker run -p 3000:3000 my-app'.",
        },
        {
          id: '8',
          start: 95,
          end: 110,
          text: 'If you see an error about port already in use, make sure to stop any other containers first.',
        },
      ],
      language: 'en',
      duration: 110,
    },
    { meeting: 0, debugging: 5, tutorial: 95, learning: 10, working: 40 }
  ),

  // 3. WORKING -> Code Snippets
  createBaseSession(
    'fixture-working',
    {
      fullText:
        "I'm going to implement the auth middleware today. I'll use JWT for session management. First, let me define the verifyToken function. It should take the request, response, and next function. I'll pull the token from the Authorization header. If it starts with 'Bearer ', I'll strip that. Then I use jwt.verify with our secret key. If it fails, I return a 401. If it passes, I attach the user payload to the request and call next. This looks solid. I should also add a check for token expiration.",
      segments: [
        {
          id: '1',
          start: 0,
          end: 15,
          text: "I'm going to implement the auth middleware today. I'll use JWT for session management.",
        },
        {
          id: '2',
          start: 15,
          end: 30,
          text: 'First, let me define the verifyToken function. It should take req, res, and next.',
        },
        {
          id: '3',
          start: 30,
          end: 45,
          text: "I'll pull the token from the Authorization header. If it starts with 'Bearer ', I'll strip that.",
        },
        {
          id: '4',
          start: 45,
          end: 60,
          text: 'Then I use jwt.verify with our secret key. If it fails, I return a 401.',
        },
        {
          id: '5',
          start: 60,
          end: 75,
          text: 'If it passes, I attach the user payload to the request and call next.',
        },
        {
          id: '6',
          start: 75,
          end: 90,
          text: 'This looks solid. I should also add a check for token expiration.',
        },
      ],
      language: 'en',
      duration: 90,
    },
    { meeting: 10, debugging: 10, tutorial: 20, learning: 15, working: 90 }
  ),

  // 4. LEARNING -> Research Notes
  createBaseSession(
    'fixture-learning',
    {
      fullText:
        "Let me understand how vector databases work. They store data as high-dimensional vectors, which are just arrays of numbers. This allows for similarity search, which is different from traditional keyword search. I'm looking at Pinecone and Milvus. Pinecone is a managed service, very easy to start. Milvus is open-source and highly scalable. Similarity is calculated using cosine similarity or Euclidean distance. This is crucial for RAG applications because it allows the LLM to find relevant context from a large knowledge base. The main challenge seems to be index management and dimensionality reduction.",
      segments: [
        {
          id: '1',
          start: 0,
          end: 15,
          text: 'Let me understand how vector databases work. They store data as high-dimensional vectors.',
        },
        {
          id: '2',
          start: 15,
          end: 30,
          text: 'This allows for similarity search, which is different from traditional keyword search.',
        },
        {
          id: '3',
          start: 30,
          end: 45,
          text: "I'm looking at Pinecone and Milvus. Pinecone is managed, Milvus is open-source.",
        },
        {
          id: '4',
          start: 45,
          end: 60,
          text: 'Similarity is calculated using cosine similarity or Euclidean distance.',
        },
        {
          id: '5',
          start: 60,
          end: 75,
          text: 'This is crucial for RAG applications for finding relevant context.',
        },
        {
          id: '6',
          start: 75,
          end: 90,
          text: 'The main challenge seems to be index management and dimensionality reduction.',
        },
      ],
      language: 'en',
      duration: 90,
    },
    { meeting: 5, debugging: 0, tutorial: 10, learning: 95, working: 20 }
  ),

  // 5. MEETING -> Action Items / Summary
  createBaseSession(
    'fixture-meeting',
    {
      fullText:
        "Thanks for joining the Q1 planning meeting. Our main goal is to launch the mobile app by March. Alice, you are in charge of the UI design, please finish the mockups by next Friday. Bob, you need to set up the backend API, specifically the user authentication and profile endpoints. I will handle the stakeholder communication and budget. We decided to use React Native for the app to save time. We still need to decide on the push notification provider. Let's meet again next Tuesday to review progress.",
      segments: [
        {
          id: '1',
          start: 0,
          end: 10,
          text: 'Thanks for joining the Q1 planning meeting. Our main goal is to launch the mobile app by March.',
        },
        {
          id: '2',
          start: 10,
          end: 25,
          text: 'Alice, you are in charge of the UI design, please finish the mockups by next Friday.',
        },
        {
          id: '3',
          start: 25,
          end: 40,
          text: 'Bob, you need to set up the backend API, user authentication and profile endpoints.',
        },
        {
          id: '4',
          start: 40,
          end: 55,
          text: 'I will handle the stakeholder communication and budget.',
        },
        {
          id: '5',
          start: 55,
          end: 70,
          text: 'We decided to use React Native for the app to save time.',
        },
        {
          id: '6',
          start: 70,
          end: 85,
          text: 'We still need to decide on the push notification provider.',
        },
        {
          id: '7',
          start: 85,
          end: 100,
          text: "Let's meet again next Tuesday to review progress.",
        },
      ],
      language: 'en',
      duration: 100,
    },
    { meeting: 95, debugging: 0, tutorial: 5, learning: 20, working: 10 }
  ),
];

async function seed() {
  console.log('🌱 Seeding synthetic session fixtures...');

  for (const session of FIXTURES) {
    await storage.saveSession(session);
    console.log(`  ✓ Seeded session: ${session.id}`);
  }

  console.log('✅ Seeding complete.');
}

seed().catch((err) => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
