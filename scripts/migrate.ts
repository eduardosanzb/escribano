import { ensureDb } from '../src/db/index.js';

ensureDb();
console.log('[migrate] DB migrations applied.');
