import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.use(express.json());

// In-memory presence tracker
const activePresences = new Map();

// API health endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Heartbeat ping from clients
app.post('/api/presence/ping', (req, res) => {
  const { sid, page, device, os, browser } = req.body || {};
  if (sid) {
    activePresences.set(sid, {
      sid,
      page: page || 'Startseite',
      device: device || 'desktop',
      os: os || 'Anderes',
      browser: browser || 'Browser',
      lastSeen: Date.now()
    });
  }
  res.json({ ok: true });
});

// Leave notification when tab is closed/hidden
app.post('/api/presence/leave', (req, res) => {
  const { sid } = req.body || {};
  if (sid) {
    activePresences.delete(sid);
  }
  res.json({ ok: true });
});

// Current active count & visitors list
app.get('/api/presence', (req, res) => {
  const now = Date.now();
  const list = [];
  for (const [sid, item] of activePresences.entries()) {
    if (now - item.lastSeen < 75000) {
      list.push({
        sid: item.sid,
        page: item.page,
        device: item.device,
        os: item.os,
        browser: item.browser,
        lastSeenAgoSec: Math.max(1, Math.round((now - item.lastSeen) / 1000))
      });
    } else {
      activePresences.delete(sid);
    }
  }
  res.json({ count: list.length, visitors: list });
});

// Serve static files with html extension fallback
app.use(express.static(__dirname, { extensions: ['html'] }));

// Fallback to index.html for unrecognized routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
