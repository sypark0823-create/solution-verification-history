let FIELDS = [];
let records = [];
let filters = {};
let sortState = { key: null, dir: null };
let editingRowIds = new Set();
let newRows = [];
let newRowSeq = 0;
let selectedIds = new Set();

const el = (sel) => document.querySelector(sel);

const ICONS = {
  edit: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path></svg>',
  delete: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
  save: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>',
  cancel: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path></svg>',
};

const NO_BADGE_KEYS = new Set(['year', 'month', 'verificationCriteria', 'solutionType', 'verificationOrg', 'qrbKickoff']);

const STATUS_DOT_CLASS = {
  계획: 'status-plan',
  진행: 'status-progress',
  완료: 'status-done',
  취소: 'status-cancel',
};

const AUTO_TARGET_KEY = 'targetCompletionDate';
const PERIOD_KEYS = [
  'functionalPeriod',
  'performancePeriod',
  'securityPeriod',
  'licensePeriod',
  'cxPeriod',
  'codeQualityPeriod',
];
const NARROW_KEYS = new Set(['year', 'month']);
const DEFAULT_SORT_KEYS = ['year', 'month', 'releaseDate'];

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
}

function fieldByKey(key) {
  return FIELDS.find((f) => f.key === key);
}

function formatDateValue(field, value) {
  if (field.type === 'daterange') return formatDateRange(value);
  if (value === 'NA') return '비대상';
  return value || '';
}

function getUniqueValuesForField(field) {
  const set = new Set();
  records.forEach((r) => set.add(formatDateValue(field, r[field.key])));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
}

function closeAllFilterPanels() {
  document.querySelectorAll('.excel-filter-panel').forEach((p) => p.classList.add('hidden'));
}

function updateFilterButtonStates() {
  document.querySelectorAll('.excel-filter-btn').forEach((btn) => {
    const key = btn.dataset.key;
    btn.classList.toggle('active', !!filters[key]);
  });
}

function buildFilterDropdown(field) {
  const wrap = document.createElement('div');
  wrap.className = 'excel-filter';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'excel-filter-btn';
  btn.dataset.key = field.key;
  btn.innerHTML = '필터 <span class="filter-caret">▾</span>';
  wrap.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'excel-filter-panel hidden';
  panel.addEventListener('click', (e) => e.stopPropagation());
  wrap.appendChild(panel);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = panel.classList.contains('hidden');
    closeAllFilterPanels();
    if (wasHidden) {
      renderFilterPanel(field, panel);
      panel.classList.remove('hidden');
    }
  });

  return wrap;
}

function renderFilterPanel(field, panel) {
  panel.innerHTML = '';
  const values = getUniqueValuesForField(field);
  const selected = filters[field.key];

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = '검색';
  searchInput.className = 'excel-filter-search';
  panel.appendChild(searchInput);

  const listWrap = document.createElement('div');
  listWrap.className = 'excel-filter-list';
  panel.appendChild(listWrap);

  const selectAllRow = document.createElement('label');
  selectAllRow.className = 'excel-filter-item excel-filter-all';
  const selectAllCb = document.createElement('input');
  selectAllCb.type = 'checkbox';
  selectAllCb.checked = !selected;
  selectAllRow.appendChild(selectAllCb);
  selectAllRow.appendChild(document.createTextNode(' (전체 선택)'));
  listWrap.appendChild(selectAllRow);

  const valueCbs = [];
  values.forEach((v) => {
    const row = document.createElement('label');
    row.className = 'excel-filter-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !selected || selected.has(v);
    cb.dataset.value = v;
    row.appendChild(cb);
    row.appendChild(document.createTextNode(' ' + (v === '' ? '(비어 있음)' : v)));
    listWrap.appendChild(row);
    valueCbs.push(cb);
  });

  selectAllCb.addEventListener('change', () => {
    valueCbs.forEach((cb) => {
      cb.checked = selectAllCb.checked;
    });
  });
  valueCbs.forEach((cb) => {
    cb.addEventListener('change', () => {
      selectAllCb.checked = valueCbs.every((c) => c.checked);
    });
  });

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase();
    listWrap.querySelectorAll('.excel-filter-item').forEach((row, i) => {
      if (i === 0) return;
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  const actions = document.createElement('div');
  actions.className = 'excel-filter-actions';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn btn-small';
  clearBtn.textContent = '초기화';
  clearBtn.addEventListener('click', () => {
    delete filters[field.key];
    panel.classList.add('hidden');
    updateFilterButtonStates();
    render();
  });

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'btn btn-small';
  applyBtn.textContent = '적용';
  applyBtn.addEventListener('click', () => {
    const checkedValues = valueCbs.filter((cb) => cb.checked).map((cb) => cb.dataset.value);
    if (checkedValues.length === values.length) {
      delete filters[field.key];
    } else {
      filters[field.key] = new Set(checkedValues);
    }
    panel.classList.add('hidden');
    updateFilterButtonStates();
    render();
  });

  actions.appendChild(clearBtn);
  actions.appendChild(applyBtn);
  panel.appendChild(actions);
}

function buildHeader() {
  const headerRow = el('#headerRow');
  const filterRow = el('#filterRow');
  headerRow.innerHTML = '';
  filterRow.innerHTML = '';

  const thSelect = document.createElement('th');
  thSelect.className = 'col-select';
  const selectAllHeaderCb = document.createElement('input');
  selectAllHeaderCb.type = 'checkbox';
  selectAllHeaderCb.id = 'selectAllCheckbox';
  selectAllHeaderCb.addEventListener('change', (e) => {
    const filtered = getSorted(getFiltered());
    if (e.target.checked) filtered.forEach((r) => selectedIds.add(r.id));
    else filtered.forEach((r) => selectedIds.delete(r.id));
    render();
  });
  thSelect.appendChild(selectAllHeaderCb);
  headerRow.appendChild(thSelect);
  filterRow.appendChild(document.createElement('th'));

  const thSerial = document.createElement('th');
  thSerial.className = 'col-serial';
  thSerial.textContent = 'No.';
  headerRow.appendChild(thSerial);
  filterRow.appendChild(document.createElement('th'));

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
    filterTh.appendChild(buildFilterDropdown(f));
    filterRow.appendChild(filterTh);
  });
}

function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
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
  if (NARROW_KEYS.has(field.key)) input.classList.add('inline-input-narrow');
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

function createSingleDateNACell(field, value) {
  const wrap = document.createElement('div');
  wrap.className = 'daterange-inputs';
  const isNA = value === 'NA';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = isNA ? '' : value || '';
  dateInput.disabled = isNA;
  dateInput.dataset.key = field.key;
  dateInput.dataset.part = 'single';

  const naLabel = document.createElement('label');
  naLabel.className = 'daterange-na-label';
  const naCheckbox = document.createElement('input');
  naCheckbox.type = 'checkbox';
  naCheckbox.checked = isNA;
  naCheckbox.dataset.key = field.key;
  naCheckbox.dataset.part = 'na';
  naCheckbox.addEventListener('change', () => {
    dateInput.disabled = naCheckbox.checked;
  });
  naLabel.appendChild(naCheckbox);
  naLabel.appendChild(document.createTextNode(' 비대상'));

  wrap.appendChild(dateInput);
  wrap.appendChild(naLabel);
  return wrap;
}

const D2_CRITERIA = new Set(['개발스프린트점검', '출시QRB', '서비스오픈점검', '시스템오픈점검']);

function subtractBusinessDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function recalcTargetCompletionDate(tr) {
  const targetInput = tr.querySelector(`[data-key="${AUTO_TARGET_KEY}"]`);
  if (!targetInput) return;

  const vcInput = tr.querySelector('[data-key="verificationCriteria"]');
  if (vcInput && D2_CRITERIA.has(vcInput.value)) {
    const releaseDateInput = tr.querySelector('[data-key="releaseDate"]');
    const releaseDate = releaseDateInput ? releaseDateInput.value : '';
    targetInput.value = releaseDate ? subtractBusinessDays(releaseDate, 2) : '';
    return;
  }

  let latest = '';
  PERIOD_KEYS.forEach((key) => {
    const field = fieldByKey(key);
    const naCb = tr.querySelector(`[data-key="${key}"][data-part="na"]`);
    if (naCb && naCb.checked) return;
    const part = field && field.type === 'daterange' ? 'end' : 'single';
    const dateInput = tr.querySelector(`[data-key="${key}"][data-part="${part}"]`);
    if (dateInput && dateInput.value && dateInput.value > latest) {
      latest = dateInput.value;
    }
  });
  targetInput.value = latest;
}

async function promptBulkNA(tr, criteria) {
  if (!D2_CRITERIA.has(criteria)) return;
  const allNA = PERIOD_KEYS.every((key) => {
    const naCb = tr.querySelector(`[data-key="${key}"][data-part="na"]`);
    return naCb && naCb.checked;
  });
  if (allNA) return;

  const confirmed = await showConfirm(
    `검증기준을 '${criteria}'(으)로 선택하셨습니다. 기능검증, 성능검증, 보안검증, OSL검증, CX검증, 코드품질을 일괄 비대상으로 처리하시겠습니까?`,
    { title: '비대상 일괄 처리', okLabel: '일괄 비대상', danger: false }
  );
  if (!confirmed) return;

  PERIOD_KEYS.forEach((key) => {
    const naCb = tr.querySelector(`[data-key="${key}"][data-part="na"]`);
    if (naCb && !naCb.checked) {
      naCb.checked = true;
      naCb.dispatchEvent(new Event('change'));
    }
  });
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
    } else if (f.type === 'date' && f.allowNA) {
      const naCb = tr.querySelector(`[data-key="${f.key}"][data-part="na"]`);
      if (naCb.checked) {
        payload[f.key] = 'NA';
      } else {
        payload[f.key] = tr.querySelector(`[data-key="${f.key}"][data-part="single"]`).value;
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
  return records.filter((r) => {
    // Rows currently being edited must stay visible (and thus saveable) even if
    // they no longer match the active filters — otherwise a filter change mid-edit
    // would silently drop their unsaved changes from a bulk save.
    if (editingRowIds.has(r.id)) return true;
    return FIELDS.every((f) => {
      const sel = filters[f.key];
      if (!sel) return true;
      const raw = formatDateValue(f, r[f.key]);
      return sel.has(raw);
    });
  });
}

function defaultSortCompare(a, b) {
  for (const key of DEFAULT_SORT_KEYS) {
    let av = a[key] || '';
    let bv = b[key] || '';
    if (key === 'year' || key === 'month') {
      av = av !== '' ? parseInt(av, 10) : -Infinity;
      bv = bv !== '' ? parseInt(bv, 10) : -Infinity;
    } else {
      av = av ? new Date(av).getTime() : -Infinity;
      bv = bv ? new Date(bv).getTime() : -Infinity;
    }
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function getSorted(list) {
  if (!sortState.key) {
    return [...list].sort(defaultSortCompare);
  }
  const { key, dir } = sortState;
  const field = fieldByKey(key);
  return [...list].sort((a, b) => {
    let av = a[key] || '';
    let bv = b[key] || '';
    if (field && field.type === 'date') {
      const avd = av === 'NA' ? '' : av;
      const bvd = bv === 'NA' ? '' : bv;
      av = avd ? new Date(avd).getTime() : -Infinity;
      bv = bvd ? new Date(bvd).getTime() : -Infinity;
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

function updateSummary(filtered) {
  const counts = { 완료: 0, 진행: 0, 계획: 0 };
  filtered.forEach((r) => {
    if (counts[r.status] !== undefined) counts[r.status]++;
  });
  el('#summaryTotal').textContent = filtered.length;
  el('#summaryDone').textContent = counts['완료'];
  el('#summaryProgress').textContent = counts['진행'];
  el('#summaryPlan').textContent = counts['계획'];
}

function buildRow(r, serial) {
  const tr = document.createElement('tr');
  if (r.status === '완료') tr.classList.add('row-done');
  if (r.status === '진행') tr.classList.add('row-progress');

  const tdSelect = document.createElement('td');
  tdSelect.className = 'col-select';
  const selectCb = document.createElement('input');
  selectCb.type = 'checkbox';
  selectCb.checked = selectedIds.has(r.id);
  selectCb.addEventListener('change', (e) => {
    if (e.target.checked) selectedIds.add(r.id);
    else selectedIds.delete(r.id);
    const headerCb = document.getElementById('selectAllCheckbox');
    if (headerCb) headerCb.checked = false;
  });
  tdSelect.appendChild(selectCb);
  tr.appendChild(tdSelect);

  const tdSerial = document.createElement('td');
  tdSerial.className = 'col-serial';
  tdSerial.textContent = serial;
  tr.appendChild(tdSerial);

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
    const value = r[f.key] || '';
    if (f.type === 'daterange' || (f.type === 'date' && f.allowNA)) {
      td.textContent = formatDateValue(f, value);
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

function buildEditableRow(record, isNew, tempId, serial) {
  const tr = document.createElement('tr');
  tr.className = 'editing-row';
  if (isNew) tr.dataset.tempId = tempId;
  else tr.dataset.recordId = record.id;

  const tdSelect = document.createElement('td');
  tdSelect.className = 'col-select';
  tr.appendChild(tdSelect);

  const tdSerial = document.createElement('td');
  tdSerial.className = 'col-serial';
  tdSerial.textContent = isNew ? '' : serial || '';
  tr.appendChild(tdSerial);

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
    } else if (f.type === 'date' && f.allowNA) {
      td.appendChild(createSingleDateNACell(f, record[f.key]));
    } else {
      td.appendChild(createFieldInput(f, record[f.key]));
    }
    tr.appendChild(td);
  });

  const recalc = () => recalcTargetCompletionDate(tr);
  PERIOD_KEYS.forEach((key) => {
    const field = fieldByKey(key);
    const part = field && field.type === 'daterange' ? 'end' : 'single';
    const dateInput = tr.querySelector(`[data-key="${key}"][data-part="${part}"]`);
    const naCb = tr.querySelector(`[data-key="${key}"][data-part="na"]`);
    if (dateInput) {
      dateInput.addEventListener('input', recalc);
      dateInput.addEventListener('change', recalc);
    }
    if (naCb) naCb.addEventListener('change', recalc);
  });
  const vcInput = tr.querySelector('[data-key="verificationCriteria"]');
  if (vcInput) {
    vcInput.addEventListener('change', recalc);
    vcInput.addEventListener('change', () => promptBulkNA(tr, vcInput.value));
  }
  const releaseDateInput = tr.querySelector('[data-key="releaseDate"]');
  if (releaseDateInput) {
    releaseDateInput.addEventListener('input', recalc);
    releaseDateInput.addEventListener('change', recalc);
  }
  recalc();

  return tr;
}

function isPayloadEmpty(payload) {
  return Object.values(payload).every((v) => !v);
}

async function saveRow(tr, record, isNew, tempId) {
  const payload = readRowValues(tr);

  if (isNew && isPayloadEmpty(payload)) {
    newRows = newRows.filter((nr) => nr.tempId !== tempId);
    render();
    return;
  }

  const label = payload.solutionName || record.solutionName || '이 항목';
  const message = isNew
    ? `'${label}' 항목을 등록하시겠습니까?`
    : `'${label}' 항목의 변경사항을 저장하시겠습니까?`;
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

  const confirmed = await showConfirm(`작성 중인 ${pendingCount}건을 일괄 저장하시겠습니까?`, {
    title: '일괄 저장 확인',
    okLabel: '일괄 저장',
    danger: false,
  });
  if (!confirmed) return;

  const editingRowEls = Array.from(document.querySelectorAll('#tableBody tr.editing-row'));
  const tasks = editingRowEls.map((tr) => {
    const payload = readRowValues(tr);
    if (tr.dataset.tempId) {
      const tempId = tr.dataset.tempId;
      if (isPayloadEmpty(payload)) {
        newRows = newRows.filter((nr) => String(nr.tempId) !== tempId);
        return Promise.resolve();
      }
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

async function bulkEdit() {
  if (selectedIds.size === 0) {
    const filtered = getSorted(getFiltered());
    filtered.forEach((r) => editingRowIds.add(r.id));
    render();
    return;
  }
  selectedIds.forEach((id) => editingRowIds.add(id));
  selectedIds.clear();
  render();
}

async function bulkDelete() {
  if (selectedIds.size === 0) {
    await showAlert('선택된 항목이 없습니다.', { title: '안내', danger: false });
    return;
  }
  const count = selectedIds.size;
  const confirmed = await showConfirm(`선택한 ${count}건을 삭제하시겠습니까?`, {
    title: '일괄 삭제 확인',
    okLabel: '삭제',
    danger: true,
  });
  if (!confirmed) return;

  await Promise.all(
    Array.from(selectedIds).map((id) => fetch(`/api/records/${id}`, { method: 'DELETE' }))
  );
  records = records.filter((r) => !selectedIds.has(r.id));
  selectedIds.clear();
  render();
}

function render() {
  const filtered = getSorted(getFiltered());
  const tbody = el('#tableBody');
  tbody.innerHTML = '';

  filtered.forEach((r, idx) => {
    if (editingRowIds.has(r.id)) {
      tbody.appendChild(buildEditableRow(r, false, undefined, idx + 1));
    } else {
      tbody.appendChild(buildRow(r, idx + 1));
    }
  });

  newRows.forEach((nr) => {
    tbody.appendChild(buildEditableRow({}, true, nr.tempId));
  });

  updateSummary(filtered);
  el('#recordCount').textContent = `전체 ${records.length}건 중 ${filtered.length}건 표시`;
  updateSortIndicators();

  const selectAllCb = document.getElementById('selectAllCheckbox');
  if (selectAllCb) {
    selectAllCb.checked = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id));
  }

  if (newRows.length > 0) {
    const lastTempId = String(newRows[newRows.length - 1].tempId);
    const lastRow = tbody.querySelector(`tr.editing-row[data-temp-id="${lastTempId}"]`);
    if (lastRow) {
      lastRow.scrollIntoView({ block: 'nearest' });
      const firstInput = lastRow.querySelector('input, select');
      if (firstInput) firstInput.focus();
    }
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
  selectedIds.delete(record.id);
  render();
}

function resetFilters() {
  filters = {};
  closeAllFilterPanels();
  updateFilterButtonStates();
  render();
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const confirmed = await showConfirm(
    `'${file.name}' 파일을 업로드하시겠습니까? 파일의 각 행이 새 항목으로 등록됩니다.`,
    { title: '엑셀 업로드 확인', okLabel: '업로드', danger: false }
  );
  if (!confirmed) return;

  const formData = new FormData();
  formData.append('file', file);

  let data;
  try {
    const res = await fetch('/api/import', { method: 'POST', body: formData });
    data = await res.json();
    if (!res.ok || !data.success) {
      const errors = data.errors || ['업로드 중 오류가 발생했습니다.'];
      const shown = errors.slice(0, 15);
      const more = errors.length > 15 ? `\n외 ${errors.length - 15}건` : '';
      await showAlert(`업로드를 완료하지 못했습니다. 아래 항목을 확인해 주세요.\n\n${shown.join('\n')}${more}`, {
        title: '업로드 실패',
      });
      return;
    }
  } catch (err) {
    await showAlert('업로드 중 오류가 발생했습니다.', { title: '업로드 실패' });
    return;
  }

  await showAlert(`${data.importedCount}건이 성공적으로 등록되었습니다.`, {
    title: '업로드 완료',
    danger: false,
  });
  await loadRecords();
}

function bindEvents() {
  el('#addBtn').addEventListener('click', startAdd);
  el('#bulkEditBtn').addEventListener('click', bulkEdit);
  el('#bulkDeleteBtn').addEventListener('click', bulkDelete);
  el('#bulkSaveBtn').addEventListener('click', saveAllPending);
  el('#exportBtn').addEventListener('click', () => {
    window.location.href = '/api/export';
  });
  el('#importBtn').addEventListener('click', () => el('#importFileInput').click());
  el('#importFileInput').addEventListener('change', handleImportFile);
  el('#resetFiltersBtn').addEventListener('click', resetFilters);
  document.addEventListener('click', () => closeAllFilterPanels());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (newRows.length > 0 || editingRowIds.size > 0)) {
      newRows = [];
      editingRowIds.clear();
      render();
    }
  });
}

init();
