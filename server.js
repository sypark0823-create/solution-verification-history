require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const multer = require('multer');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 4000;
const FIELDS_PATH = path.join(__dirname, 'fields.json');

const FIELDS = JSON.parse(fs.readFileSync(FIELDS_PATH, 'utf-8'));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/fields', (req, res) => {
  res.json(FIELDS);
});

app.get('/api/records', async (req, res) => {
  try {
    const records = await store.getAll();
    res.json(records);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/records', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const record = { id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    for (const f of FIELDS) {
      record[f.key] = (req.body[f.key] ?? '').toString();
    }
    await store.insert(record);
    res.status(201).json(record);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/records/:id', async (req, res) => {
  try {
    const record = await store.getById(req.params.id);
    if (!record) return res.status(404).json({ error: 'not found' });
    for (const f of FIELDS) {
      if (req.body[f.key] !== undefined) record[f.key] = req.body[f.key].toString();
    }
    record.updatedAt = new Date().toISOString();
    await store.update(req.params.id, record);
    res.json(record);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.delete('/api/records/:id', async (req, res) => {
  try {
    const ok = await store.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    const records = await store.getAll();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('검증이력');
    sheet.columns = FIELDS.map((f) => ({ header: f.label, key: f.key, width: 18 }));
    sheet.getRow(1).font = { bold: true, name: '바탕체', size: 9 };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };

    for (const record of records) {
      const row = {};
      for (const f of FIELDS) row[f.key] = record[f.key] ?? '';
      sheet.addRow(row);
    }

    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.font =
          row.number === 1 ? { bold: true, name: '바탕체', size: 9 } : { name: '바탕체', size: 9 };
      });
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '').replace('T', '_');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="solution-verification-history-${timestamp}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cellToString(cell) {
  let value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value instanceof Date) {
      const yyyy = value.getFullYear();
      const mm = String(value.getMonth() + 1).padStart(2, '0');
      const dd = String(value.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    if (value.text) return value.text.toString().trim();
    if (Array.isArray(value.richText)) {
      return value.richText.map((rt) => rt.text).join('').trim();
    }
    return '';
  }
  return value.toString().trim();
}

function validateAndParseSheet(sheet) {
  const headerRow = sheet.getRow(1);
  const headerLabels = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headerLabels[colNumber] = cellToString(cell);
  });

  const colToField = {};
  FIELDS.forEach((f) => {
    const idx = headerLabels.findIndex((label) => label === f.label);
    if (idx !== -1) colToField[idx] = f;
  });

  const missingLabels = FIELDS.filter(
    (f) => !Object.values(colToField).some((cf) => cf.key === f.key)
  ).map((f) => f.label);
  if (missingLabels.length > 0) {
    return {
      errors: [`엑셀 양식이 올바르지 않습니다. 누락된 항목: ${missingLabels.join(', ')}`],
      records: [],
    };
  }

  const errors = [];
  const parsedRecords = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const cellValues = Object.keys(colToField).map((colIdx) =>
      cellToString(row.getCell(Number(colIdx)))
    );
    if (cellValues.every((v) => v === '')) continue;

    const record = {};
    let rowHasError = false;

    Object.entries(colToField).forEach(([colIdxStr, field]) => {
      const colIdx = Number(colIdxStr);
      const raw = cellToString(row.getCell(colIdx));

      if (field.type === 'select') {
        if (raw && !field.options.includes(raw)) {
          errors.push(
            `${rowNumber}행: '${field.label}' 값이 올바르지 않습니다 (허용값: ${field.options.join('/')}, 입력값: ${raw})`
          );
          rowHasError = true;
        }
        record[field.key] = raw;
      } else if (field.type === 'date') {
        if (raw && !DATE_RE.test(raw)) {
          errors.push(
            `${rowNumber}행: '${field.label}' 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD, 입력값: ${raw})`
          );
          rowHasError = true;
        }
        record[field.key] = raw;
      } else if (field.type === 'daterange') {
        if (!raw) {
          record[field.key] = '';
        } else if (raw === '비대상') {
          record[field.key] = 'NA';
        } else {
          const m = raw.match(/^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/);
          if (!m) {
            errors.push(
              `${rowNumber}행: '${field.label}' 형식이 올바르지 않습니다 (YYYY-MM-DD ~ YYYY-MM-DD 또는 비대상, 입력값: ${raw})`
            );
            rowHasError = true;
            record[field.key] = '';
          } else {
            let [, start, end] = m;
            if (start > end) [start, end] = [end, start];
            record[field.key] = `${start}~${end}`;
          }
        }
      } else {
        record[field.key] = raw;
      }
    });

    if (!record.solutionName) {
      errors.push(`${rowNumber}행: '솔루션명'은 필수입니다.`);
      rowHasError = true;
    }

    if (!rowHasError) parsedRecords.push(record);
  }

  return { errors, records: parsedRecords };
}

app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ errors: ['업로드된 파일이 없습니다.'] });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return res.status(400).json({ errors: ['엑셀 파일에 시트가 없습니다.'] });
    }

    const { errors, records: parsedRecords } = validateAndParseSheet(sheet);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    if (parsedRecords.length === 0) {
      return res.status(400).json({ errors: ['등록할 데이터가 없습니다.'] });
    }

    const now = new Date().toISOString();
    for (const rec of parsedRecords) {
      const full = { id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      for (const f of FIELDS) full[f.key] = rec[f.key] || '';
      await store.insert(full);
    }

    res.json({ success: true, importedCount: parsedRecords.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ errors: ['파일 처리 중 오류가 발생했습니다.'] });
  }
});

store
  .init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`솔루션 검증이력 관리 시스템 서버 실행: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('서버 시작 실패:', err.message);
    process.exit(1);
  });
