import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(homedir(), '.escribano', 'escribano.db');
const ESCRIBANO_DIR = join(homedir(), '.escribano');
const PORT = 3456;

const app = express();
let db;

try {
  db = new Database(DB_PATH, { readonly: true });
  console.log(`[db] Connected to ${DB_PATH}`);
} catch (err) {
  console.error(`[db] Failed to open database: ${err.message}`);
  process.exit(1);
}

app.use(express.static(__dirname));
app.use('/frames', express.static(ESCRIBANO_DIR));
app.use('/frames-temp', express.static('/var/folders'));

app.get('/api/recordings', (req, res) => {
  try {
    const recordings = db
      .prepare(
        `SELECT id, captured_at, duration, status, source_type 
         FROM recordings 
         ORDER BY captured_at DESC 
         LIMIT 50`
      )
      .all();
    res.json(recordings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/observations/:recordingId', (req, res) => {
  try {
    const { recordingId } = req.params;
    const observations = db
      .prepare(
        `SELECT id, timestamp, image_path, vlm_description, activity_type, apps, topics, type
         FROM observations 
         WHERE recording_id = ? AND type = 'visual'
         ORDER BY timestamp ASC`
      )
      .all(recordingId);
    res.json(observations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/recording/:id', (req, res) => {
  try {
    const { id } = req.params;
    const recording = db
      .prepare(
        `SELECT id, captured_at, duration, status, source_type, video_path
         FROM recordings 
         WHERE id = ?`
      )
      .get(id);
    res.json(recording);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
});
