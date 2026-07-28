const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

let usePostgres = false;
let pool;

function readFileDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify({ records: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeFileDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

async function init() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set — using local file storage (data/db.json).');
    return;
  }
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pool.query(
    'CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, data JSONB NOT NULL)'
  );
  usePostgres = true;
  console.log('Connected to Postgres — using cloud database storage.');
}

async function getAll() {
  if (usePostgres) {
    const { rows } = await pool.query(
      "SELECT data FROM records ORDER BY data->>'createdAt' ASC"
    );
    return rows.map((r) => r.data);
  }
  return readFileDB().records;
}

async function getById(id) {
  if (usePostgres) {
    const { rows } = await pool.query('SELECT data FROM records WHERE id = $1', [id]);
    return rows[0]?.data;
  }
  return readFileDB().records.find((r) => r.id === id);
}

async function insert(record) {
  if (usePostgres) {
    await pool.query('INSERT INTO records (id, data) VALUES ($1, $2)', [record.id, record]);
    return record;
  }
  const db = readFileDB();
  db.records.push(record);
  writeFileDB(db);
  return record;
}

async function update(id, record) {
  if (usePostgres) {
    const { rowCount } = await pool.query('UPDATE records SET data = $2 WHERE id = $1', [
      id,
      record,
    ]);
    return rowCount > 0;
  }
  const db = readFileDB();
  const idx = db.records.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  db.records[idx] = record;
  writeFileDB(db);
  return true;
}

async function remove(id) {
  if (usePostgres) {
    const { rowCount } = await pool.query('DELETE FROM records WHERE id = $1', [id]);
    return rowCount > 0;
  }
  const db = readFileDB();
  const idx = db.records.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  db.records.splice(idx, 1);
  writeFileDB(db);
  return true;
}

module.exports = { init, getAll, getById, insert, update, remove };
