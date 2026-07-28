let FIELDS = [];
let records = [];
let filters = {};
let sortState = { key: null, dir: null };
let editingId = null;

const el = (sel) => document.querySelector(sel);

async function init() {
  FIELDS = await fetch('/api/fields').then((r) => r.json());
  buildHeader();
  buildFormGrid();
  addConditionRow();
  await loadRecords();
  bindEvents();
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

function buildFormGrid() {
  const grid = el('#formGrid');
  grid.innerHTML = '';
  FIELDS.forEach((f) => {
    const wrap = document.createElement('div');
    wrap.className = 'form-field' + (f.type === 'textarea' ? ' full-width' : '');
    const label = document.createElement('label');
    label.textContent = f.label;
    wrap.appendChild(label);

    if (f.type === 'daterange') {
      label.htmlFor = 'field_' + f.key + '_start';
      const rangeWrap = document.createElement('div');
      rangeWrap.className = 'daterange-inputs';
      const startInput = document.createElement('input');
      startInput.type = 'date';
      startInput.id = 'field_' + f.key + '_start';
      const sep = document.createElement('span');
      sep.className = 'daterange-sep';
      sep.textContent = '~';
      const endInput = document.createElement('input');
      endInput.type = 'date';
      endInput.id = 'field_' + f.key + '_end';

      const naLabel = document.createElement('label');
      naLabel.className = 'daterange-na-label';
      const naCheckbox = document.createElement('input');
      naCheckbox.type = 'checkbox';
      naCheckbox.id = 'field_' + f.key + '_na';
      naCheckbox.addEventListener('change', () => {
        startInput.disabled = naCheckbox.checked;
        endInput.disabled = naCheckbox.checked;
      });
      naLabel.appendChild(naCheckbox);
      naLabel.appendChild(document.createTextNode(' 비대상'));

      rangeWrap.appendChild(startInput);
      rangeWrap.appendChild(sep);
      rangeWrap.appendChild(endInput);
      rangeWrap.appendChild(naLabel);
      wrap.appendChild(rangeWrap);
      grid.appendChild(wrap);
      return;
    }

    label.htmlFor = 'field_' + f.key;
    let input;
    if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
    } else if (f.type === 'date') {
      input = document.createElement('input');
      input.type = 'date';
    } else if (f.type === 'select') {
      input = document.createElement('select');
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = '선택';
      input.appendChild(emptyOpt);
      f.options.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        input.appendChild(o);
      });
    } else {
      input = document.createElement('input');
      input.type = 'text';
    }
    input.id = 'field_' + f.key;
    input.name = f.key;
    wrap.appendChild(input);
    grid.appendChild(wrap);
  });
}

function createConditionValueInput(field) {
  let input;
  if (field.type === 'select') {
    input = document.createElement('select');
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = '전체';
    input.appendChild(allOpt);
    field.options.forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      input.appendChild(o);
    });
  } else if (field.type === 'date') {
    input = document.createElement('input');
    input.type = 'date';
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '검색어 입력';
  }
  input.className = 'condition-value';
  return input;
}

function clearFilterForKey(key) {
  filters[key] = '';
  const colInput = document.querySelector(`.filter-input[data-key="${key}"]`);
  if (colInput) colInput.value = '';
}

function addConditionRow() {
  const rows = el('#conditionRows');
  const row = document.createElement('div');
  row.className = 'condition-row';

  const fieldSelect = document.createElement('select');
  fieldSelect.className = 'condition-field';
  FIELDS.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.key;
    opt.textContent = f.label;
    fieldSelect.appendChild(opt);
  });

  const valueWrap = document.createElement('div');
  valueWrap.className = 'condition-value-wrap';

  const renderValueInput = () => {
    valueWrap.innerHTML = '';
    const field = FIELDS.find((f) => f.key === fieldSelect.value);
    valueWrap.appendChild(createConditionValueInput(field));
  };
  renderValueInput();
  fieldSelect.addEventListener('change', renderValueInput);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-small condition-remove';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => {
    clearFilterForKey(fieldSelect.value);
    row.remove();
    render();
  });

  row.appendChild(fieldSelect);
  row.appendChild(valueWrap);
  row.appendChild(removeBtn);
  rows.appendChild(row);
}

function applyConditions() {
  document.querySelectorAll('#conditionRows .condition-row').forEach((row) => {
    const key = row.querySelector('.condition-field').value;
    const value = row.querySelector('.condition-value').value.trim();
    filters[key] = value;
    const colInput = document.querySelector(`.filter-input[data-key="${key}"]`);
    if (colInput) colInput.value = value;
  });
  render();
}

function clearConditions() {
  document.querySelectorAll('#conditionRows .condition-row').forEach((row) => {
    const key = row.querySelector('.condition-field').value;
    row.querySelector('.condition-value').value = '';
    clearFilterForKey(key);
  });
  render();
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

  const tdAction = document.createElement('td');
  tdAction.className = 'col-action';
  const editBtn = document.createElement('button');
  editBtn.textContent = '수정';
  editBtn.type = 'button';
  editBtn.className = 'btn-small';
  editBtn.addEventListener('click', () => openEdit(r));
  const delBtn = document.createElement('button');
  delBtn.textContent = '삭제';
  delBtn.type = 'button';
  delBtn.className = 'btn-small btn-danger';
  delBtn.addEventListener('click', () => onDelete(r));
  tdAction.appendChild(editBtn);
  tdAction.appendChild(delBtn);
  tr.appendChild(tdAction);

  FIELDS.forEach((f) => {
    const td = document.createElement('td');
    if (f.type === 'daterange') {
      td.textContent = formatDateRange(r[f.key]);
    } else {
      td.textContent = r[f.key] || '';
    }
    if (f.type === 'textarea') td.classList.add('col-wide');
    tr.appendChild(td);
  });

  return tr;
}

function render() {
  const filtered = getSorted(getFiltered());
  const tbody = el('#tableBody');
  tbody.innerHTML = '';
  filtered.forEach((r) => tbody.appendChild(buildRow(r)));

  el('#recordCount').textContent = `전체 ${records.length}건 중 ${filtered.length}건 표시`;
  updateSortIndicators();
}

function openAdd() {
  editingId = null;
  el('#modalTitle').textContent = '신규 등록';
  el('#recordForm').reset();
  FIELDS.forEach((f) => {
    if (f.type === 'daterange') {
      el('#field_' + f.key + '_na').checked = false;
      el('#field_' + f.key + '_start').disabled = false;
      el('#field_' + f.key + '_end').disabled = false;
    }
  });
  el('#modalOverlay').classList.remove('hidden');
}

function openEdit(record) {
  editingId = record.id;
  el('#modalTitle').textContent = '수정';
  FIELDS.forEach((f) => {
    if (f.type === 'daterange') {
      const raw = record[f.key] || '';
      const isNA = raw === 'NA';
      const [start, end] = isNA ? ['', ''] : raw.split('~');
      el('#field_' + f.key + '_na').checked = isNA;
      el('#field_' + f.key + '_start').disabled = isNA;
      el('#field_' + f.key + '_end').disabled = isNA;
      el('#field_' + f.key + '_start').value = start || '';
      el('#field_' + f.key + '_end').value = end || '';
    } else {
      el('#field_' + f.key).value = record[f.key] || '';
    }
  });
  el('#modalOverlay').classList.remove('hidden');
}

function closeModal() {
  el('#modalOverlay').classList.add('hidden');
}

function showConfirm(message) {
  return new Promise((resolve) => {
    el('#confirmMessage').textContent = message;
    el('#confirmOverlay').classList.remove('hidden');

    const okBtn = el('#confirmOkBtn');
    const cancelBtn = el('#confirmCancelBtn');

    const cleanup = (result) => {
      el('#confirmOverlay').classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      el('#confirmOverlay').removeEventListener('click', onOverlayClick);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlayClick = (e) => {
      if (e.target.id === 'confirmOverlay') cleanup(false);
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    el('#confirmOverlay').addEventListener('click', onOverlayClick);
  });
}

async function onSubmit(e) {
  e.preventDefault();
  const payload = {};
  FIELDS.forEach((f) => {
    if (f.type === 'daterange') {
      if (el('#field_' + f.key + '_na').checked) {
        payload[f.key] = 'NA';
      } else {
        const start = el('#field_' + f.key + '_start').value;
        const end = el('#field_' + f.key + '_end').value;
        payload[f.key] = start || end ? `${start}~${end}` : '';
      }
    } else {
      payload[f.key] = el('#field_' + f.key).value;
    }
  });

  if (editingId) {
    const updated = await fetch(`/api/records/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    const idx = records.findIndex((r) => r.id === editingId);
    records[idx] = updated;
  } else {
    const created = await fetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    records.push(created);
  }

  closeModal();
  render();
}

async function onDelete(record) {
  const label = record.solutionName || record.releaseName || '이 항목';
  const confirmed = await showConfirm(`'${label}' 항목을 삭제하시겠습니까?`);
  if (!confirmed) return;
  await fetch(`/api/records/${record.id}`, { method: 'DELETE' });
  records = records.filter((r) => r.id !== record.id);
  render();
}

function resetFilters() {
  filters = {};
  document.querySelectorAll('.filter-input').forEach((i) => (i.value = ''));
  document.querySelectorAll('.condition-value').forEach((i) => (i.value = ''));
  render();
}

function bindEvents() {
  el('#addBtn').addEventListener('click', openAdd);
  el('#modalCloseBtn').addEventListener('click', closeModal);
  el('#cancelBtn').addEventListener('click', closeModal);
  el('#recordForm').addEventListener('submit', onSubmit);
  el('#exportBtn').addEventListener('click', () => {
    window.location.href = '/api/export';
  });
  el('#resetFiltersBtn').addEventListener('click', resetFilters);
  el('#addConditionBtn').addEventListener('click', () => addConditionRow());
  el('#searchBtn').addEventListener('click', applyConditions);
  el('#clearConditionsBtn').addEventListener('click', clearConditions);
  el('#modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

init();
