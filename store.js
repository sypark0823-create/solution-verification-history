const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

let usePostgres = false;
let pool;
let fileDbInitialized = false;

function readFileDB() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    if (fileDbInitialized) {
      // The file existed a moment ago and just vanished (sync conflict, antivirus
      // lock, etc.) — refuse to silently recreate an empty DB and lose history.
      throw new Error(
        'data/db.json 파일이 예기치 않게 사라졌습니다. 데이터 유실을 막기 위해 자동 초기화를 중단합니다. 파일 동기화 상태를 확인해 주세요.'
      );
    }
    fs.writeFileSync(DB_PATH, JSON.stringify({ records: [] }, null, 2));
  }

  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  fileDbInitialized = true;
  return JSON.parse(raw);
}

function writeFileDB(db) {
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2));
  fs.renameSync(tmpPath, DB_PATH);
}

async function init() {
  if (!process.env.DATABASE_URL) {
    if (process.env.RENDER) {
      // Render's disk is ephemeral — every redeploy/restart wipes it. Refuse to
      // silently run in a mode that looks like it's saving data but isn't.
      throw new Error(
        'DATABASE_URL이 설정되지 않았습니다. Render는 파일시스템이 임시 저장소라 재배포/재시작 시 데이터가 사라집니다. ' +
          'Render 대시보드 > Environment에서 DATABASE_URL(Neon 등 Postgres 연결 문자열)을 설정한 뒤 다시 배포해 주세요.'
      );
    }
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
