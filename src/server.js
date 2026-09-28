const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'appdb',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

app.get('/', (req, res) => {
  res.json({ app: 'devops-portfolio', version: process.env.APP_VERSION || 'dev' });
});

// Liveness: is the process alive? (no DB check on purpose)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Readiness: can it serve traffic? (needs DB)
app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'db-down' });
  }
});

app.get('/api/items', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, created_at FROM items ORDER BY id DESC LIMIT 50');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'db error' });
  }
});

app.post('/api/items', async (req, res) => {
  try {
    const result = await pool.query('INSERT INTO items(name) VALUES($1) RETURNING id, name', [req.body.name]);
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'db error' });
  }
});

async function init() {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS items (id SERIAL PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now())'
  );
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  init()
    .then(() => app.listen(port, () => console.log('listening on ' + port)))
    .catch((err) => {
      console.error('DB init failed:', err.message);
      process.exit(1); // pod will CrashLoopBackOff if DB is unreachable (useful demo)
    });
}

module.exports = app;
