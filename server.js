require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 4000;
const FIELDS_PATH = path.join(__dirname, 'fields.json');

const FIELDS = JSON.parse(fs.readFileSync(FIELDS_PATH, 'utf-8'));

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
    sheet.getRow(1).font = { bold: true };
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
      });
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const timestamp = new Date().toISOString().slice(0, 10);
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

store.init().then(() => {
  app.listen(PORT, () => {
    console.log(`솔루션 검증이력 관리 시스템 서버 실행: http://localhost:${PORT}`);
  });
});
