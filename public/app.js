let FIELDS = [];
let records = [];
let filters = {};
let sortState = { key: null, dir: null };
let editingRowIds = new Set();
let newRows = [];
let newRowSeq = 0;

const el = (sel) => document.querySelector(sel);

const ICONS = {
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path></svg>',
  delete: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
  save: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>',
  cancel: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path></svg>',
};

const NO_BADGE_KEYS = new Set(['year', 'month', 'verificationCriteria', 'solutionType', 'verificationOrg']);

const STATUS_DOT_CLASS = {
  계획: 'status-plan',
  진행: 'status-progress',
  완료: 'status-done',
  취소: 'status-cancel',
};

function iconButton(iconKey, label, extraClass) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-action-btn ' + extraClass;
  btn.innerHTML = ICONS[iconKey];
  btn.title = label;
  btn.setAttribute('aria-label', label);
  return btn;
}

async function init() {
  FIELDS = await fetch('/api/fields').then((r) => r.json());
  buildHeader();
  await loadRecords();
  bindEvents();
  await checkAutoStatusSuggestions();
}

function buildHeader() {
  const headerRow = el('#headerRow');
  const filterRow = el('#filterRow');
  headerRow.innerHTML = '';
  filterRow.innerHTML = '';

  const thAction = document.createElement('th');
  thAction.textContent = '관리';
  thAction.className = 'col-action';
  headerRow.appendChild(thAction);
  filterRow.appendChild(document.createElement('th'));

  FIELDS.forEach((f) => {
    const th = document.createElement('th');
    th.className = 'sortable';
    th.dataset.key = f.key;
    th.innerHTML = `<span>${f.label}</span><span class="sort-indicator"></span>`;
    th.addEventListener('click', () => onSort(f.key));
    headerRow.appendChild(th);

    const filterTh = document.createElement('th');
    let input;
    if (f.type === 'select') {
      input = document.createElement('select');
      input.className = 'filter-input';
      const allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = '전체';
      input.appendChild(allOpt);
      f.options.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        input.appendChild(o);
      });
      input.addEventListener('change', (e) => {
        filters[f.key] = e.target.value.trim();
        render();
      });
    } else {
      input = document.createElement('input');
      input.type = f.type === 'date' ? 'date' : 'text';
      input.placeholder = f.type === 'date' ? '' : '필터';
      input.className = 'filter-input';
      input.addEventListener('input', (e) => {
        filters[f.key] = e.target.value.trim();
        render();
      });
    }
    input.dataset.key = f.key;
    filterTh.appendChild(input);
    filterRow.appendChild(filterTh);
  });
}

const AUTO_TARGET_KEY = 'targetCompletionDate';
const PERIOD_KEYS = [
  'functionalPeriod',
  'performancePeriod',
  'securityPeriod',
  'licensePeriod',
  'cxPeriod',
  'codeQualityPeriod',
];

function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function hasStartedVerification(r) {
  const today = todayISO();
  return PERIOD_KEYS.some((key) => {
    const val = r[key];
    if (!val || val === 'NA') return false;
    const start = val.split('~')[0];
    return start && start <= today;
  });
}

function summarizeNames(items, max) {
  const names = items.map((r) => r.solutionName || '(이름없음)');
  if (names.length <= max) return names.join(', ');
  return names.slice(0, max).join(', ') + ` 외 ${names.length - max}건`;
}

async function applyStatusChange(items, status) {
  await Promise.all(
    items.map((r) =>
      fetch(`/api/records/${r.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
        .then((res) => res.json())
        .then((updated) => {
          const idx = records.findIndex((rec) => rec.id === r.id);
          if (idx !== -1) records[idx] = updated;
        })
    )
  );
}

function suggestStatusForRecord(r) {
  if ((r.result === 'PASS' || r.result === 'FAIL') && (r.status === '계획' || r.status === '진행')) {
    return '완료';
  }
  if (!hasStartedVerification(r) && (r.status === '진행' || r.status === '완료')) {
    return '계획';
  }
  return null;
}

async function checkAutoStatusSuggestions() {
  const toComplete = records.filter((r) => suggestStatusForRecord(r) === '완료');
  if (toComplete.length > 0) {
    const confirmed = await showConfirm(
      `수행결과가 등록되었지만 진행상태가 완료가 아닌 항목이 ${toComplete.length}건 있습니다 (${summarizeNames(toComplete, 5)}). 진행상태를 '완료'로 변경하시겠습니까?`,
      { title: '진행상태 확인', okLabel: '완료로 변경', danger: false }
    );
    if (confirmed) {
      await applyStatusChange(toComplete, '완료');
      render();
    }
  }

  const toPlan = records.filter((r) => suggestStatusForRecord(r) === '계획');
  if (toPlan.length > 0) {
    const confirmed = await showConfirm(
      `검증기간이 아직 시작되지 않았는데 진행상태가 진행/완료로 되어 있는 항목이 ${toPlan.length}건 있습니다 (${summarizeNames(toPlan, 5)}). 진행상태를 '계획'으로 변경하시겠습니까?`,
      { title: '진행상태 확인', okLabel: '계획으로 변경', danger: false }
    );
    if (confirmed) {
      await applyStatusChange(toPlan, '계획');
      render();
    }
  }
}

function createFieldInput(field, value) {
  let input;
  if (field.type === 'date') {
    input = document.createElement('input');
    input.type = 'date';
    input.value = value || '';
    if (field.key === AUTO_TARGET_KEY) {
      input.disabled = true;
    }
  } else if (field.type === 'select') {
    input = document.createElement('select');
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '선택';
    input.appendChild(emptyOpt);
    field.options.forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      input.appendChild(o);
    });
    input.value = value || '';
  } else if (field.type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 2;
    input.value = value || '';
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
  }
  input.className = 'inline-input';
  input.dataset.key = field.key;
  return input;
}

function createDaterangeCell(field, value) {
  const wrap = document.createElement('div');
  wrap.className = 'daterange-inputs';
  const isNA = value === 'NA';
  const [start, end] = isNA ? ['', ''] : (value || '').split('~');

  const startInput = document.createElement('input');
  startInput.type = 'date';
  startInput.value = start || '';
  startInput.disabled = isNA;
  startInput.dataset.key = field.key;
  startInput.dataset.part = 'start';

  const sep = document.createElement('span');
  sep.className = 'daterange-sep';
  sep.textContent = '~';

  const endInput = document.createElement('input');
  endInput.type = 'date';
  endInput.value = end || '';
  endInput.disabled = isNA;
  endInput.dataset.key = field.key;
  endInput.dataset.part = 'end';

  const normalizeOrder = () => {
    if (startInput.value && endInput.value && startInput.value > endInput.value) {
      const swapped = startInput.value;
      startInput.value = endInput.value;
      endInput.value = swapped;
      endInput.dispatchEvent(new Event('change'));
    }
  };
  startInput.addEventListener('change', normalizeOrder);
  endInput.addEventListener('change', normalizeOrder);

  const naLabel = document.createElement('label');
  naLabel.className = 'daterange-na-label';
  const naCheckbox = document.createElement('input');
  naCheckbox.type = 'checkbox';
  naCheckbox.checked = isNA;
  naCheckbox.dataset.key = field.key;
  naCheckbox.dataset.part = 'na';
  naCheckbox.addEventListener('change', () => {
    startInput.disabled = naCheckbox.checked;
    endInput.disabled = naCheckbox.checked;
  });
  naLabel.appendChild(naCheckbox);
  naLabel.appendChild(document.createTextNode(' 비대상'));

  wrap.appendChild(startInput);
  wrap.appendChild(sep);
  wrap.appendChild(endInput);
  wrap.appendChild(naLabel);
  return wrap;
}

function recalcTargetCompletionDate(tr) {
  const targetInput = tr.querySelector(`[data-key="${AUTO_TARGET_KEY}"]`);
  if (!targetInput) return;
  let latest = '';
  PERIOD_KEYS.forEach((key) => {
    const naCb = tr.querySelector(`[data-key="${key}"][data-part="na"]`);
    if (naCb && naCb.checked) return;
    const endInput = tr.querySelector(`[data-key="${key}"][data-part="end"]`);
    if (endInput && endInput.value && endInput.value > latest) {
      latest = endInput.value;
    }
  });
  targetInput.value = latest;
}

function readRowValues(tr) {
  const payload = {};
  FIELDS.forEach((f) => {
    if (f.type === 'daterange') {
      const naCb = tr.querySelector(`[data-key="${f.key}"][data-part="na"]`);
      if (naCb.checked) {
        payload[f.key] = 'NA';
      } else {
        let start = tr.querySelector(`[data-key="${f.key}"][data-part="start"]`).value;
        let end = tr.querySelector(`[data-key="${f.key}"][data-part="end"]`).value;
        if (start && end && start > end) {
          [start, end] = [end, start];
        }
        payload[f.key] = start || end ? `${start}~${end}` : '';
      }
    } else {
      payload[f.key] = tr.querySelector(`[data-key="${f.key}"]`).value;
    }
  });
  return payload;
}

function formatDateRange(value) {
  if (!value) return '';
  if (value === 'NA') return '비대상';
  const [start, end] = value.split('~');
  if (start && end) return `${start} ~ ${end}`;
  if (start) return `${start} ~`;
  if (end) return `~ ${end}`;
  return '';
}

async function loadRecords() {
  records = await fetch('/api/records').then((r) => r.json());
  render();
}

function getFiltered() {
  return records.filter((r) =>
    FIELDS.every((f) => {
      const fv = (filters[f.key] || '').toLowerCase();
      if (!fv) return true;
      const raw = f.type === 'daterange' ? formatDateRange(r[f.key]) : r[f.key];
      const val = (raw || '').toString().toLowerCase();
      return val.includes(fv);
    })
  );
}

function getSorted(list) {
  if (!sortState.key) return list;
  const { key, dir } = sortState;
  const field = FIELDS.find((f) => f.key === key);
  return [...list].sort((a, b) => {
    let av = a[key] || '';
    let bv = b[key] || '';
    if (field && field.type === 'date') {
      av = av ? new Date(av).getTime() : -Infinity;
      bv = bv ? new Date(bv).getTime() : -Infinity;
    } else if (field && field.type === 'daterange') {
      const aStart = av === 'NA' ? '' : (av || '').split('~')[0];
      const bStart = bv === 'NA' ? '' : (bv || '').split('~')[0];
      av = aStart ? new Date(aStart).getTime() : -Infinity;
      bv = bStart ? new Date(bStart).getTime() : -Infinity;
    } else {
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      const aIsNum = av !== '' && !isNaN(an) && String(an) === av.toString().trim();
      const bIsNum = bv !== '' && !isNaN(bn) && String(bn) === bv.toString().trim();
      if (aIsNum && bIsNum) {
        av = an;
        bv = bn;
      }
    }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function onSort(key) {
  if (sortState.key !== key) {
    sortState = { key, dir: 'asc' };
  } else if (sortState.dir === 'asc') {
    sortState.dir = 'desc';
  } else {
    sortState = { key: null, dir: null };
  }
  render();
}

function updateSortIndicators() {
  document.querySelectorAll('#headerRow th.sortable').forEach((th) => {
    const indicator = th.querySelector('.sort-indicator');
    if (th.dataset.key === sortState.key) {
      indicator.textContent = sortState.dir === 'asc' ? '▲' : '▼';
      th.classList.add('sorted');
    } else {
      indicator.textContent = '';
      th.classList.remove('sorted');
    }
  });
}

function buildRow(r) {
  const tr = document.createElement('tr');

  const autoInProgress = hasStartedVerification(r) && r.status !== '완료' && r.status !== '취소';
  if (autoInProgress) tr.classList.add('row-auto-progress');
  if (r.status === '완료') tr.classList.add('row-done');

  const tdAction = document.createElement('td');
  tdAction.className = 'col-action';
  const editBtn = iconButton('edit', '수정', 'icon-edit');
  editBtn.addEventListener('click', () => {
    editingRowIds.add(r.id);
    render();
  });
  const delBtn = iconButton('delete', '삭제', 'icon-delete');
  delBtn.addEventListener('click', () => onDelete(r));
  tdAction.appendChild(editBtn);
  tdAction.appendChild(delBtn);
  tr.appendChild(tdAction);

  FIELDS.forEach((f) => {
    const td = document.createElement('td');
    let value = r[f.key] || '';
    if (f.key === 'status' && autoInProgress) value = '진행';
    if (f.type === 'daterange') {
      td.textContent = formatDateRange(value);
    } else if (f.key === 'status' && value) {
      const dot = document.createElement('span');
      dot.className = 'status-dot ' + (STATUS_DOT_CLASS[value] || '');
      td.appendChild(dot);
      td.appendChild(document.createTextNode(value));
    } else if (f.type === 'select' && value && !NO_BADGE_KEYS.has(f.key)) {
      const badge = document.createElement('span');
      const resultClass = f.key === 'result' ? (value === 'PASS' ? ' badge-pass' : ' badge-fail') : '';
      badge.className = 'badge' + resultClass;
      badge.textContent = value;
      td.appendChild(badge);
    } else {
      td.textContent = value;
    }
    if (f.type === 'textarea') td.classList.add('col-wide');
    tr.appendChild(td);
  });

  return tr;
}

function buildEditableRow(record, isNew, tempId) {
  const tr = document.createElement('tr');
  tr.className = 'editing-row';
  if (isNew) tr.dataset.tempId = tempId;
  else tr.dataset.recordId = record.id;

  const tdAction = document.createElement('td');
  tdAction.className = 'col-action';
  const saveBtn = iconButton('save', '저장', 'icon-save');
  saveBtn.addEventListener('click', () => saveRow(tr, record, isNew, tempId));
  const cancelBtn = iconButton('cancel', '취소', 'icon-cancel');
  cancelBtn.addEventListener('click', () => {
    if (isNew) newRows = newRows.filter((nr) => nr.tempId !== tempId);
    else editingRowIds.delete(record.id);
    render();
  });
  tdAction.appendChild(saveBtn);
  tdAction.appendChild(cancelBtn);
  tr.appendChild(tdAction);

  FIELDS.forEach((f) => {
    const td = document.createElement('td');
    td.className = 'col-editing';
    if (f.type === 'daterange') {
      td.appendChild(createDaterangeCell(f, record[f.key]));
    } else {
      td.appendChild(createFieldInput(f, record[f.key]));
    }
    tr.appendChild(td);
  });

  const recalc = () => recalcTargetCompletionDate(tr);
  PERIOD_KEYS.forEach((key) => {
    const endInput = tr.querySelector(`[data-key="${key}"][data-part="end"]`);
    const naCb = tr.querySelector(`[data-key="${key}"][data-part="na"]`);
    if (endInput) {
      endInput.addEventListener('input', recalc);
      endInput.addEventListener('change', recalc);
    }
    if (naCb) naCb.addEventListener('change', recalc);
  });
  recalc();

  return tr;
}

async function saveRow(tr, record, isNew, tempId) {
  const payload = readRowValues(tr);
  const suggestedStatus = suggestStatusForRecord(payload);
  if (suggestedStatus) payload.status = suggestedStatus;

  const label = payload.solutionName || record.solutionName || '이 항목';

  const wasResultSet = record.result === 'PASS' || record.result === 'FAIL';
  const resultCleared = wasResultSet && !payload.result;
  if (!isNew && resultCleared && payload.status === '완료') {
    await showAlert(
      `'${label}' 항목의 수행결과가 삭제되었습니다. 진행상태가 '완료'로 되어 있으니 상태값을 다시 확인해 주세요.`,
      { title: '진행상태 확인 필요' }
    );
  }

  let message = isNew
    ? `'${label}' 항목을 등록하시겠습니까?`
    : `'${label}' 항목의 변경사항을 저장하시겠습니까?`;
  if (suggestedStatus) {
    message += ` (진행상태가 '${suggestedStatus}'(으)로 자동 반영됩니다)`;
  }
  const confirmed = await showConfirm(message, {
    title: isNew ? '등록 확인' : '수정 확인',
    okLabel: isNew ? '등록' : '저장',
    danger: false,
  });
  if (!confirmed) return;

  if (isNew) {
    const created = await fetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    records.push(created);
    newRows = newRows.filter((nr) => nr.tempId !== tempId);
  } else {
    const updated = await fetch(`/api/records/${record.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    const idx = records.findIndex((rec) => rec.id === record.id);
    records[idx] = updated;
    editingRowIds.delete(record.id);
  }
  render();
}

async function saveAllPending() {
  const pendingCount = newRows.length + editingRowIds.size;
  if (pendingCount === 0) return;

  const editingRowEls = Array.from(document.querySelectorAll('#tableBody tr.editing-row'));
  const rowPayloads = editingRowEls.map((tr) => {
    const payload = readRowValues(tr);
    const suggestedStatus = suggestStatusForRecord(payload);
    if (suggestedStatus) payload.status = suggestedStatus;
    return { tr, payload, suggestedStatus };
  });
  const autoAdjustedCount = rowPayloads.filter((rp) => rp.suggestedStatus).length;

  const staleCompleteNames = rowPayloads
    .filter(({ tr, payload }) => {
      const id = tr.dataset.recordId;
      if (!id) return false;
      const original = records.find((rec) => rec.id === id);
      const wasResultSet = original && (original.result === 'PASS' || original.result === 'FAIL');
      return wasResultSet && !payload.result && payload.status === '완료';
    })
    .map(({ payload }) => payload.solutionName || '(이름없음)');
  if (staleCompleteNames.length > 0) {
    await showAlert(
      `수행결과가 삭제되었지만 진행상태가 '완료'로 되어 있는 항목이 있습니다 (${staleCompleteNames.join(', ')}). 상태값을 다시 확인해 주세요.`,
      { title: '진행상태 확인 필요' }
    );
  }

  let message = `작성 중인 ${pendingCount}건을 일괄 저장하시겠습니까?`;
  if (autoAdjustedCount > 0) {
    message += ` (${autoAdjustedCount}건은 진행상태가 자동 반영됩니다)`;
  }

  const confirmed = await showConfirm(message, {
    title: '일괄 저장 확인',
    okLabel: '일괄 저장',
    danger: false,
  });
  if (!confirmed) return;

  const tasks = rowPayloads.map(({ tr, payload }) => {
    if (tr.dataset.tempId) {
      const tempId = tr.dataset.tempId;
      return fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then((r) => r.json())
        .then((created) => {
          records.push(created);
          newRows = newRows.filter((nr) => String(nr.tempId) !== tempId);
        });
    }
    const id = tr.dataset.recordId;
    return fetch(`/api/records/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((updated) => {
        const idx = records.findIndex((rec) => rec.id === id);
        records[idx] = updated;
        editingRowIds.delete(id);
      });
  });

  await Promise.all(tasks);
  render();
}

function render() {
  const filtered = getSorted(getFiltered());
  const tbody = el('#tableBody');
  tbody.innerHTML = '';

  newRows.forEach((nr) => {
    tbody.appendChild(buildEditableRow({}, true, nr.tempId));
  });

  filtered.forEach((r) => {
    if (editingRowIds.has(r.id)) {
      tbody.appendChild(buildEditableRow(r, false));
    } else {
      tbody.appendChild(buildRow(r));
    }
  });

  el('#recordCount').textContent = `전체 ${records.length}건 중 ${filtered.length}건 표시`;
  updateSortIndicators();

  if (newRows.length > 0) {
    const lastTempId = String(newRows[newRows.length - 1].tempId);
    const lastRow = tbody.querySelector(`tr.editing-row[data-temp-id="${lastTempId}"]`);
    const firstInput = lastRow && lastRow.querySelector('input, select');
    if (firstInput) firstInput.focus();
  }
}

function startAdd() {
  newRows.push({ tempId: ++newRowSeq });
  render();
}

function showConfirm(message, options) {
  const { title = '확인', okLabel = '확인', danger = true, alertOnly = false } = options || {};
  return new Promise((resolve) => {
    el('#confirmTitle').textContent = title;
    el('#confirmMessage').textContent = message;
    el('#confirmOverlay').classList.remove('hidden');

    const okBtn = el('#confirmOkBtn');
    okBtn.textContent = okLabel;
    okBtn.className = 'btn ' + (danger ? 'btn-danger-solid' : 'btn-primary');
    const cancelBtn = el('#confirmCancelBtn');
    cancelBtn.style.display = alertOnly ? 'none' : '';

    const cleanup = (result) => {
      el('#confirmOverlay').classList.add('hidden');
      cancelBtn.style.display = '';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      el('#confirmOverlay').removeEventListener('click', onOverlayClick);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlayClick = (e) => {
      if (alertOnly) return;
      if (e.target.id === 'confirmOverlay') cleanup(false);
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    el('#confirmOverlay').addEventListener('click', onOverlayClick);
  });
}

async function showAlert(message, options) {
  await showConfirm(message, { ...options, alertOnly: true });
}

async function onDelete(record) {
  const label = record.solutionName || record.releaseName || '이 항목';
  const confirmed = await showConfirm(`'${label}' 항목을 삭제하시겠습니까?`, {
    title: '삭제 확인',
    okLabel: '삭제',
    danger: true,
  });
  if (!confirmed) return;
  await fetch(`/api/records/${record.id}`, { method: 'DELETE' });
  records = records.filter((r) => r.id !== record.id);
  render();
}

function resetFilters() {
  filters = {};
  document.querySelectorAll('.filter-input').forEach((i) => (i.value = ''));
  render();
}

function bindEvents() {
  el('#addBtn').addEventListener('click', startAdd);
  el('#bulkSaveBtn').addEventListener('click', saveAllPending);
  el('#exportBtn').addEventListener('click', () => {
    window.location.href = '/api/export';
  });
  el('#resetFiltersBtn').addEventListener('click', resetFilters);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (newRows.length > 0 || editingRowIds.size > 0)) {
      newRows = [];
      editingRowIds.clear();
      render();
    }
  });
}

init();
