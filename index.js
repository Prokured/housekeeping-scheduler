  /* ══════════════════════════════════════ PIN CODE LOGIC */
  const PIN_CODE = '8844';
  let pinEntry = '';

  function pinPress(digit) {
    if (pinEntry.length >= 4) return;
    pinEntry += digit;
    updatePinDots();
    if (pinEntry.length === 4) {
      setTimeout(checkPin, 200);
    }
  }

  function pinDelete() {
    pinEntry = pinEntry.slice(0, -1);
    updatePinDots();
    document.getElementById('pinError').textContent = '';
  }

  function pinClear() {
    pinEntry = '';
    updatePinDots();
    document.getElementById('pinError').textContent = '';
  }

  function updatePinDots() {
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < pinEntry.length);
    });
  }

  function checkPin() {
    if (pinEntry === PIN_CODE) {
      sessionStorage.setItem('hkSched_pinAuth', '1');
      const overlay = document.getElementById('pinOverlay');
      overlay.classList.add('hidden');
    } else {
      document.getElementById('pinError').textContent = 'Incorrect PIN';
      const dotsWrap = document.getElementById('pinDots');
      dotsWrap.classList.add('pin-shake');
      setTimeout(() => {
        dotsWrap.classList.remove('pin-shake');
        pinEntry = '';
        updatePinDots();
      }, 500);
    }
  }

  (function initPin() {
    if (sessionStorage.getItem('hkSched_pinAuth') === '1') {
      document.getElementById('pinOverlay').classList.add('hidden');
    }
    document.addEventListener('keydown', function(e) {
      const overlay = document.getElementById('pinOverlay');
      if (overlay.classList.contains('hidden')) return;
      if (e.key >= '0' && e.key <= '9') pinPress(e.key);
      else if (e.key === 'Backspace') pinDelete();
      else if (e.key === 'Escape') pinClear();
    });
  })();

  /* ══════════════════════════════════════ SCHEDULER LOGIC */
  const MAX_MIN     = 450;
  const CO_MIN      = 30;
  const SO_MIN      = 15;
  const FS_MIN      = 23;

  const BREAK1_OFFSET = 120;
  const BREAK1_DUR    = 15;
  const LUNCH_OFFSET  = BREAK1_OFFSET + BREAK1_DUR + 60;
  const LUNCH_DUR     = 30;
  const BREAK2_OFFSET = LUNCH_OFFSET + LUNCH_DUR + 120;
  const BREAK2_DUR    = 15;

  let rows     = [];
  let nextId   = 1;
  let nextHkId = 1;

  function loadData() {
    try {
      let s = localStorage.getItem('hkSched_v4');
      if (s) {
        const d = JSON.parse(s);
        rows     = d.rows     || [];
        nextId   = d.nextId   || 1;
        nextHkId = d.nextHkId || 1;
        const sd = document.getElementById('schedDate');
        if (d.date) sd.value = d.date;
      } else {
        s = localStorage.getItem('hkSched_v3');
        if (s) {
          const d = JSON.parse(s);
          rows = (d.rows || []).map(r => ({
            ...r,
            housekeepers: [],
            hkExpanded: false
          }));
          nextId   = d.nextId || 1;
          nextHkId = 1;
          const sd = document.getElementById('schedDate');
          if (d.date) sd.value = d.date;
          saveData();
        }
      }
    } catch(_) {}
  }

  function saveData() {
    try {
      localStorage.setItem('hkSched_v4', JSON.stringify({
        rows, nextId, nextHkId,
        date: document.getElementById('schedDate').value
      }));
    } catch(_) {}
    updatePrintDate();
  }

  function calc(co, so, fs) {
    co = Math.max(0, parseInt(co) || 0);
    so = Math.max(0, parseInt(so) || 0);
    fs = Math.max(0, parseInt(fs) || 0);
    const totalMin = co * CO_MIN + so * SO_MIN + fs * FS_MIN;
    if (totalMin === 0) return { hk: 0, hrs: 0, totalMin: 0 };
    const hk  = Math.ceil(totalMin / MAX_MIN);
    const hrs = totalMin / hk / 60;
    return { hk, hrs, totalMin };
  }

  function effective(res, row) {
    if (res.totalMin === 0) return { hk: 0, hrs: 0, isCustom: false, isOver: false, isUnder: false };

    const customHK = parseInt(row.customHK);
    const useCustom = customHK > 0;

    const hk  = useCustom ? customHK : res.hk;
    const hrs = res.totalMin / hk / 60;

    return {
      hk,
      hrs,
      isCustom: useCustom,
      isOver:   hrs > 7.5,
      isUnder:  useCustom && hrs < 1 && res.totalMin > 0
    };
  }

  function calcShift(clockInStr, productiveHrs) {
    if (!clockInStr || productiveHrs <= 0) return null;
    const [hh, mm] = clockInStr.split(':').map(Number);
    const ciMins   = hh * 60 + mm;
    const prodMins = Math.round(productiveHrs * 60);
    const hasBreak1 = productiveHrs >= 2;
    const totalHrsOnSite = productiveHrs + (hasBreak1 ? BREAK1_DUR / 60 : 0);
    const fullShift = totalHrsOnSite > 6;
    const extraMins = fullShift ? (BREAK1_DUR + LUNCH_DUR + BREAK2_DUR) : BREAK1_DUR;
    const coMins    = ciMins + prodMins + extraMins;

    const b1s = ciMins + BREAK1_OFFSET;
    const b1e = b1s + BREAK1_DUR;
    let lunch = null, break2 = null;

    if (fullShift) {
      const ls = ciMins + LUNCH_OFFSET;
      const le = ls + LUNCH_DUR;
      lunch  = { start: ls, end: le };
      const b2s = ciMins + BREAK2_OFFSET;
      break2 = { start: b2s, end: b2s + BREAK2_DUR };
    }
    return { clockOut: coMins, break1: { start: b1s, end: b1e }, lunch, break2, fullShift };
  }

  function fmtTime(totalMins) {
    const t   = Math.round(totalMins);
    const h24 = Math.floor(t / 60) % 24;
    const m   = t % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12  = h24 % 12 || 12;
    return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
  }

  function fmtRange(start, end) { return `${fmtTime(start)} – ${fmtTime(end)}`; }

  function breakSchedHTML(shift, productiveHrs) {
    if (!shift) return '<span class="dash">—</span>';
    if (productiveHrs < 2) return '<span class="brk-pill nobrk">Short shift — no breaks</span>';

    let html = `<span class="brk-pill break">☕ Break: ${fmtRange(shift.break1.start, shift.break1.end)}</span>`;
    if (shift.fullShift && shift.lunch) {
      html += `<span class="brk-pill lunch">🍽 Lunch: ${fmtRange(shift.lunch.start, shift.lunch.end)}</span>`;
      html += `<span class="brk-pill break">☕ Break: ${fmtRange(shift.break2.start, shift.break2.end)}</span>`;
    }
    return html;
  }

  function clockOutHTML(clockIn, hrs) {
    if (!clockIn || hrs <= 0)
      return '<span style="color:var(--gray-400);font-size:.78rem;">Enter clock-in time</span>';
    const shift = calcShift(clockIn, hrs);
    if (!shift) return '<span class="dash">—</span>';
    return `
      <div class="clkout-label">Clock Out</div>
      <div class="clkout-time">${fmtTime(shift.clockOut)}</div>
      <div class="break-sched">${breakSchedHTML(shift, hrs)}</div>`;
  }

  function calcHKShift(hk) {
    const co = Math.max(0, parseInt(hk.co) || 0);
    const so = Math.max(0, parseInt(hk.so) || 0);
    const fs = Math.max(0, parseInt(hk.fs) || 0);
    const totalMin = co * CO_MIN + so * SO_MIN + fs * FS_MIN;
    if (totalMin === 0) return { hrs: 0, totalMin: 0, shift: null, isOver: false };
    const hrs = totalMin / 60;
    const shift = hk.clockIn ? calcShift(hk.clockIn, hrs) : null;
    return { hrs, totalMin, shift, isOver: hrs > 7.5 };
  }

  function hkHrsCellHTML(hk) {
    const result = calcHKShift(hk);
    if (result.hrs <= 0) return '<span class="dash">—</span>';
    const cls = result.isOver ? 'hk-rv-warn' : 'hk-rv';
    let html = `<span class="${cls}">${result.hrs.toFixed(2)}</span><span class="hk-rs"> hrs</span>`;
    if (result.isOver) html += '<br><span class="hk-warn-pill">Over 7.5 hrs</span>';
    return html;
  }

  function hkClockOutHTML(hk) {
    const result = calcHKShift(hk);
    if (!hk.clockIn || result.hrs <= 0)
      return '<span style="color:var(--gray-400);font-size:.75rem;">Enter clock-in</span>';
    if (!result.shift) return '<span class="dash">—</span>';
    return `
      <div class="clkout-label">Clock Out</div>
      <div class="clkout-time">${fmtTime(result.shift.clockOut)}</div>
      <div class="break-sched">${breakSchedHTML(result.shift, result.hrs)}</div>`;
  }

  function hkActualOutHTML(hk) {
    const result = calcHKShift(hk);
    const hasScheduled = hk.clockIn && result.hrs > 0 && result.shift;
    if (!hk.actualOut) {
      return hasScheduled
        ? '<span style="color:var(--gray-400);font-size:.75rem;">Enter actual out</span>'
        : '<span class="dash">—</span>';
    }
    const [ah, am] = hk.actualOut.split(':').map(Number);
    const actualMins = ah * 60 + am;
    let html = `<div style="font-size:.82rem;font-weight:700;color:var(--gray-800);">${fmtTime(actualMins)}</div>`;
    if (hasScheduled) {
      const scheduledMins = result.shift.clockOut;
      const diff = actualMins - scheduledMins;
      if (diff === 0) {
        html += '<span class="variance-pill on-time">&#x2705; On time</span>';
      } else if (diff > 0) {
        const h = Math.floor(diff / 60);
        const m = diff % 60;
        const label = h > 0 ? `${h}h ${m}m over` : `${diff}m over`;
        html += `<span class="variance-pill over">&#x1F534; +${label}</span>`;
      } else {
        const absDiff = Math.abs(diff);
        const h = Math.floor(absDiff / 60);
        const m = absDiff % 60;
        const label = h > 0 ? `${h}h ${m}m early` : `${absDiff}m early`;
        html += `<span class="variance-pill under">&#x1F7E2; -${label}</span>`;
      }
    }
    return html;
  }

  function assignTrackerHTML(row) {
    const totalCO = Math.max(0, parseInt(row.co) || 0);
    const totalSO = Math.max(0, parseInt(row.so) || 0);
    const totalFS = Math.max(0, parseInt(row.fs) || 0);
    const hks = row.housekeepers || [];
    const assignedCO = hks.reduce((s, h) => s + (Math.max(0, parseInt(h.co) || 0)), 0);
    const assignedSO = hks.reduce((s, h) => s + (Math.max(0, parseInt(h.so) || 0)), 0);
    const assignedFS = hks.reduce((s, h) => s + (Math.max(0, parseInt(h.fs) || 0)), 0);
    function cc(a, t) {
      if (t === 0 && a === 0) return '';
      if (a > t) return 'warn';
      if (a === t && t > 0) return 'ok';
      return '';
    }
    return `
      <span class="assign-chip ${cc(assignedCO, totalCO)}">${assignedCO}/${totalCO} CO assigned</span>
      <span class="assign-chip ${cc(assignedSO, totalSO)}">${assignedSO}/${totalSO} SO assigned</span>
      <span class="assign-chip ${cc(assignedFS, totalFS)}">${assignedFS}/${totalFS} FS assigned</span>`;
  }

  function hkSectionHTML(row) {
    const hks = row.housekeepers || [];
    const expanded = row.hkExpanded;
    const chevronClass = expanded ? 'chevron open' : 'chevron';
    const bodyClass = expanded ? 'hk-section-body' : 'hk-section-body collapsed';

    let hkRows = '';
    hks.forEach((hk, idx) => {
      hkRows += `
      <tr id="hkrow_${hk.hkId}">
        <td style="color:var(--gray-400);font-size:.75rem;">${idx + 1}</td>
        <td>
          <input type="text" class="hk-name-input" placeholder="Name…"
            value="${esc(hk.name)}" oninput="updateHKField(${row.id},${hk.hkId},'name',this.value)" />
        </td>
        <td class="ctr">
          <input type="number" class="hk-num-input" min="0" placeholder="0"
            value="${hk.co || ''}" oninput="updateHKField(${row.id},${hk.hkId},'co',this.value)" />
        </td>
        <td class="ctr">
          <input type="number" class="hk-num-input" min="0" placeholder="0"
            value="${hk.so || ''}" oninput="updateHKField(${row.id},${hk.hkId},'so',this.value)" />
        </td>
        <td class="ctr">
          <input type="number" class="hk-num-input" min="0" placeholder="0"
            value="${hk.fs || ''}" oninput="updateHKField(${row.id},${hk.hkId},'fs',this.value)" />
        </td>
        <td class="hk-gc">
          <input type="time" style="min-width:100px;"
            value="${hk.clockIn || ''}" onchange="updateHKField(${row.id},${hk.hkId},'clockIn',this.value)" />
        </td>
        <td class="hk-rc ctr" id="hkhrs_${hk.hkId}">${hkHrsCellHTML(hk)}</td>
        <td class="hk-gc" id="hkco_${hk.hkId}">${hkClockOutHTML(hk)}</td>
        <td class="hk-gc">
          <div class="hk-actual-wrap">
            <input type="time" class="hk-actual-input"
              value="${hk.actualOut || ''}" onchange="updateHKField(${row.id},${hk.hkId},'actualOut',this.value)" />
            <span id="hkvar_${hk.hkId}">${hkActualOutHTML(hk)}</span>
          </div>
        </td>
        <td class="no-print ctr">
          <button class="btn btn-danger" onclick="removeHousekeeper(${row.id},${hk.hkId})" title="Remove">&#x2715;</button>
        </td>
      </tr>`;
    });

    const emptyMsg = hks.length === 0
      ? '<div class="hk-empty-msg">No housekeepers assigned yet. Click <b>+ Add Housekeeper</b> to begin.</div>'
      : '';

    const miniTable = hks.length > 0 ? `
      <div style="overflow-x:auto;">
        <table class="hk-mini-table">
          <thead>
            <tr>
              <th style="width:28px;">#</th>
              <th class="pc">Name</th>
              <th class="pc ctr">CO</th>
              <th class="pc ctr">SO</th>
              <th class="pc ctr">FS</th>
              <th class="hk-gc">Clock In</th>
              <th class="hk-rc ctr">Hours</th>
              <th class="hk-gc">Scheduled Out<br>&amp; Breaks</th>
              <th class="hk-gc">Actual Out<br>&amp; Variance</th>
              <th class="no-print" style="width:36px;"></th>
            </tr>
          </thead>
          <tbody id="hktbody_${row.id}">${hkRows}</tbody>
        </table>
      </div>` : '';

    return `
    <tr class="hk-section" id="hksec_${row.id}">
      <td colspan="11" style="padding:0;">
        <button class="hk-section-toggle" onclick="toggleHKSection(${row.id})">
          <span>&#x1F465; Housekeepers (${hks.length}) <span style="font-weight:400;font-size:.75rem;margin-left:6px;">— Assign individual rooms &amp; schedules</span></span>
          <span class="${chevronClass}">&#x25BC;</span>
        </button>
        <div class="${bodyClass}" id="hkbody_${row.id}">
          <div class="assign-tracker" id="hktrack_${row.id}">${assignTrackerHTML(row)}</div>
          ${emptyMsg}
          ${miniTable}
          <div style="padding:10px 0 2px;" class="no-print">
            <button class="btn btn-purple-outline btn-sm" onclick="addHousekeeper(${row.id})">+ Add Housekeeper</button>
          </div>
        </div>
      </td>
    </tr>`;
  }

  function addHousekeeper(rowId) {
    const row = rows.find(r => r.id === rowId);
    if (!row) return;
    if (!row.housekeepers) row.housekeepers = [];
    row.housekeepers.push({
      hkId: nextHkId++,
      name: '',
      co: '',
      so: '',
      fs: '',
      clockIn: row.clockIn || ''
    });
    row.hkExpanded = true;
    saveData();
    renderFull();
  }

  function removeHousekeeper(rowId, hkId) {
    const row = rows.find(r => r.id === rowId);
    if (!row || !row.housekeepers) return;
    row.housekeepers = row.housekeepers.filter(h => h.hkId !== hkId);
    saveData();
    renderFull();
  }

  function updateHKField(rowId, hkId, field, value) {
    const row = rows.find(r => r.id === rowId);
    if (!row || !row.housekeepers) return;
    const hk = row.housekeepers.find(h => h.hkId === hkId);
    if (hk) {
      hk[field] = value;
      saveData();
      refreshHKResults(rowId);
    }
  }

  function toggleHKSection(rowId) {
    const row = rows.find(r => r.id === rowId);
    if (!row) return;
    row.hkExpanded = !row.hkExpanded;
    saveData();
    const body = document.getElementById(`hkbody_${rowId}`);
    const chevron = document.querySelector(`#hksec_${rowId} .chevron`);
    if (body) body.classList.toggle('collapsed', !row.hkExpanded);
    if (chevron) chevron.classList.toggle('open', row.hkExpanded);
  }

  function refreshHKResults(rowId) {
    const row = rows.find(r => r.id === rowId);
    if (!row) return;
    const trackEl = document.getElementById(`hktrack_${rowId}`);
    if (trackEl) trackEl.innerHTML = assignTrackerHTML(row);
    (row.housekeepers || []).forEach(hk => {
      const hrsEl = document.getElementById(`hkhrs_${hk.hkId}`);
      const coEl  = document.getElementById(`hkco_${hk.hkId}`);
      const varEl = document.getElementById(`hkvar_${hk.hkId}`);
      if (hrsEl) hrsEl.innerHTML = hkHrsCellHTML(hk);
      if (coEl)  coEl.innerHTML  = hkClockOutHTML(hk);
      if (varEl) varEl.innerHTML = hkActualOutHTML(hk);
    });
    const results = rows.map(r => calc(r.co, r.so, r.fs));
    renderFoot(results);
    updateSummary(results);
  }

  function hkCellHTML(res, row) {
    if (res.hk <= 0) return '<span class="dash">—</span>';

    const eff       = effective(res, row);
    const isCustom  = eff.isCustom;
    const isOver    = eff.isOver;
    const isUnder   = eff.isUnder;

    const displayHK = eff.hk;
    const numClass  = isOver ? 'rv-over' : (isCustom ? 'rv-custom' : 'rv');
    const tag       = isCustom
      ? '<span class="hk-tag custom">Custom</span>'
      : '<span class="hk-tag auto">Auto</span>';

    let warning = '';
    if (isOver)  warning = '<span class="over-pill">⚠️ Exceeds 7.5 hr max</span>';
    if (isUnder) warning = '<span class="under-pill">⚡ Very light load</span>';

    const autoNote = isCustom
      ? `<div style="font-size:.68rem;color:var(--blue);margin-top:1px;">Auto: ${res.hk}</div>`
      : '';

    return `
      <div class="hk-cell">
        <div class="hk-auto-row">
          ${tag}
          <span class="${numClass}">${displayHK}</span>
        </div>
        ${autoNote}
        <div class="hk-override-row">
          <span class="hk-override-lbl">Override:</span>
          <input type="number" class="hk-override-input no-print" min="1" placeholder="—"
            value="${row.customHK || ''}"
            oninput="updateField(${row.id},'customHK',this.value)"
            title="Enter a custom number of housekeepers to override the auto-calculated amount" />
          <span class="print-only" style="font-size:.82rem;">${row.customHK || '—'}</span>
        </div>
        ${warning}
      </div>`;
  }

  function hrsCellHTML(res, row) {
    if (res.hk <= 0) return '<span class="dash">—</span>';
    const eff      = effective(res, row);
    const numClass = eff.isOver ? 'rv-over' : (eff.isCustom ? 'rv-custom' : 'rv');
    const rsClass  = eff.isOver ? '' : '';
    return `<span class="${numClass}">${eff.hrs.toFixed(2)}</span><span class="rs"> hrs</span>`;
  }

  function addRow(name='', co='', so='', fs='', dnd='', clockIn='', customHK='') {
    rows.push({ id: nextId++, name, co, so, fs, dnd, clockIn, customHK, housekeepers: [], hkExpanded: false });
    saveData();
    renderFull();
  }

  function removeRow(id) {
    rows = rows.filter(r => r.id !== id);
    saveData();
    renderFull();
  }

  function updateField(id, field, val) {
    const r = rows.find(r => r.id === id);
    if (r) { r[field] = val; saveData(); refreshResults(); }
  }

  function clearAll() {
    if (!rows.length) return;
    if (confirm('Clear all properties? This cannot be undone.')) {
      rows = []; nextId = 1; nextHkId = 1; saveData(); renderFull();
    }
  }

  function renderFull() {
    const tbody = document.getElementById('tBody');
    const empty = document.getElementById('emptyState');

    if (!rows.length) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      renderFoot([]);
      updateSummary([]);
      return;
    }
    empty.style.display = 'none';

    const results = rows.map(r => calc(r.co, r.so, r.fs));

    tbody.innerHTML = rows.map((r, i) => {
      const res = results[i];
      const eff = effective(res, r);
      return `
      <tr>
        <td style="color:var(--gray-400);font-size:.78rem;padding-top:14px;">${i+1}</td>
        <td style="padding-top:11px;">
          <input type="text" class="prop-input" placeholder="Property name…"
            value="${esc(r.name)}" oninput="updateField(${r.id},'name',this.value)" />
        </td>
        <td class="ctr" style="padding-top:11px;">
          <input type="number" class="num-input" min="0" placeholder="0"
            value="${r.co}" oninput="updateField(${r.id},'co',this.value)" />
        </td>
        <td class="ctr" style="padding-top:11px;">
          <input type="number" class="num-input" min="0" placeholder="0"
            value="${r.so}" oninput="updateField(${r.id},'so',this.value)" />
        </td>
        <td class="ctr" style="padding-top:11px;">
          <input type="number" class="num-input" min="0" placeholder="0"
            value="${r.fs}" oninput="updateField(${r.id},'fs',this.value)" />
        </td>
        <td class="dc ctr sep-left dc" style="padding-top:11px;">
          <input type="number" class="num-input" min="0" placeholder="0"
            value="${r.dnd || ''}" oninput="updateField(${r.id},'dnd',this.value)"
            style="border-color:var(--dnd-bd);color:var(--dnd);"
            title="Do Not Disturb rooms — no cleaning time allocated" />
        </td>
        <td class="gc sep-left gc" style="padding-top:11px;">
          <input type="time" style="min-width:108px;"
            value="${r.clockIn || ''}"
            onchange="updateField(${r.id},'clockIn',this.value)" />
        </td>
        <td class="rc sep-left rc" id="hk_${r.id}">${hkCellHTML(res, r)}</td>
        <td class="rc ctr"         id="hr_${r.id}" style="padding-top:14px;">${hrsCellHTML(res, r)}</td>
        <td class="gc sep-left gc" id="co_${r.id}">${clockOutHTML(r.clockIn, eff.hrs)}</td>
        <td class="no-print ctr" style="padding-top:11px;">
          <button class="btn btn-danger" onclick="removeRow(${r.id})" title="Remove">&#x2715;</button>
        </td>
      </tr>
      ${hkSectionHTML(r)}`;
    }).join('');

    renderFoot(results);
    updateSummary(results);
  }

  function refreshResults() {
    const results = rows.map(r => calc(r.co, r.so, r.fs));
    rows.forEach((r, i) => {
      const res  = results[i];
      const eff  = effective(res, r);
      const hkEl = document.getElementById(`hk_${r.id}`);
      const hrEl = document.getElementById(`hr_${r.id}`);
      const coEl = document.getElementById(`co_${r.id}`);
      if (hkEl) hkEl.innerHTML = hkCellHTML(res, r);
      if (hrEl) hrEl.innerHTML = hrsCellHTML(res, r);
      if (coEl) coEl.innerHTML = clockOutHTML(r.clockIn, eff.hrs);
      const trackEl = document.getElementById(`hktrack_${r.id}`);
      if (trackEl) trackEl.innerHTML = assignTrackerHTML(r);
      (r.housekeepers || []).forEach(hk => {
        const hkHrsEl = document.getElementById(`hkhrs_${hk.hkId}`);
        const hkCoEl  = document.getElementById(`hkco_${hk.hkId}`);
        const hkVarEl = document.getElementById(`hkvar_${hk.hkId}`);
        if (hkHrsEl) hkHrsEl.innerHTML = hkHrsCellHTML(hk);
        if (hkCoEl)  hkCoEl.innerHTML  = hkClockOutHTML(hk);
        if (hkVarEl) hkVarEl.innerHTML = hkActualOutHTML(hk);
      });
    });
    renderFoot(results);
    updateSummary(results);
  }

  function renderFoot(results) {
    const tfoot = document.getElementById('tFoot');
    if (!results.length) { tfoot.innerHTML = ''; return; }

    let totalHK  = 0;
    let totalMin = 0;
    rows.forEach((r, i) => {
      const hks = r.housekeepers || [];
      if (hks.length > 0) {
        totalHK += hks.length;
        hks.forEach(hk => { totalMin += calcHKShift(hk).totalMin; });
      } else {
        const eff = effective(results[i], r);
        totalHK  += eff.hk;
        totalMin += results[i].totalMin;
      }
    });
    const avgHrs   = totalHK > 0 ? (totalMin / totalHK / 60) : 0;
    const propWord = results.length === 1 ? 'property' : 'properties';

    const totalDND = rows.reduce((s,r) => s + (Math.max(0, parseInt(r.dnd) || 0)), 0);

    tfoot.innerHTML = `
    <tr>
      <td colspan="5">TOTALS — ${results.length} ${propWord}</td>
      <td class="dc" style="text-align:center;">
        ${totalDND > 0 ? `<span style="font-size:1.1rem;font-weight:800;">${totalDND}</span><div style="font-size:.65rem;margin-top:1px;opacity:.8;">DND rooms</div>` : '—'}
      </td>
      <td class="rc sep-left rc" style="text-align:left;padding-top:10px;">
        <div style="font-size:.68rem;opacity:.7;margin-bottom:2px;">Effective total</div>
        <span style="font-size:1.1rem;font-weight:800;">${totalHK}</span>
      </td>
      <td class="rc" style="text-align:center;">${avgHrs > 0 ? avgHrs.toFixed(2)+' avg' : '—'}</td>
      <td class="gc" style="color:#81e6d9;font-size:.78rem;padding-top:14px;">Varies by property start time</td>
      <td class="no-print"></td>
    </tr>`;
  }

  function updateSummary(results) {
    const totalServiced = rows.reduce((s,r) =>
      s + (Math.max(0,parseInt(r.co)||0))
        + (Math.max(0,parseInt(r.so)||0))
        + (Math.max(0,parseInt(r.fs)||0)), 0);
    const totalDND = rows.reduce((s,r) => s + (Math.max(0, parseInt(r.dnd) || 0)), 0);
    const totalRooms = totalServiced + totalDND;

    let totalHK  = 0;
    let totalLaborMin = 0;
    rows.forEach((r, i) => {
      const hks = r.housekeepers || [];
      if (hks.length > 0) {
        totalHK += hks.length;
        hks.forEach(hk => { totalLaborMin += calcHKShift(hk).totalMin; });
      } else {
        const eff = effective(results[i], r);
        totalHK  += eff.hk;
        totalLaborMin += results[i].totalMin;
      }
    });

    document.getElementById('sumProps').textContent    = rows.length;
    document.getElementById('sumRooms').textContent    = totalRooms;
    document.getElementById('sumRoomsSub').textContent = totalDND > 0
      ? `${totalServiced} serviced · ${totalDND} DND`
      : 'all properties';
    document.getElementById('sumHK').textContent       = totalHK;
    document.getElementById('sumHrs').textContent      = (totalLaborMin / 60).toFixed(1);
  }

  function exportCSV() {
    const dateVal = document.getElementById('schedDate').value || 'No-date';

    const headers = [
      '#','Property Name','Checkouts','Stayovers','Full Service Stayovers','DND Rooms',
      'Clock In','Auto HK','Custom HK Override','Effective HK','Hours Each (Productive)',
      'Clock Out','Break 1','Lunch','Break 2','Over Limit?','HK Assigned'
    ];

    const dataRows = rows.map((r, i) => {
      const res = calc(r.co, r.so, r.fs);
      const eff = effective(res, r);

      let clockInDisp = '';
      if (r.clockIn) {
        const [hh,mm] = r.clockIn.split(':').map(Number);
        clockInDisp = fmtTime(hh * 60 + mm);
      }

      const shift = (r.clockIn && eff.hrs > 0) ? calcShift(r.clockIn, eff.hrs) : null;
      const clockOutDisp = shift ? fmtTime(shift.clockOut) : '';
      const brk1Disp     = (shift && eff.hrs >= 2) ? fmtRange(shift.break1.start, shift.break1.end) : '';
      const lunchDisp    = (shift && shift.lunch)   ? fmtRange(shift.lunch.start, shift.lunch.end)   : '';
      const brk2Disp     = (shift && shift.break2)  ? fmtRange(shift.break2.start, shift.break2.end) : '';

      return [
        i+1,
        `"${(r.name||'').replace(/"/g,'""')}"`,
        parseInt(r.co)||0,
        parseInt(r.so)||0,
        parseInt(r.fs)||0,
        parseInt(r.dnd)||0,
        `"${clockInDisp}"`,
        res.hk,
        r.customHK || '',
        eff.hk,
        eff.hrs.toFixed(2),
        `"${clockOutDisp}"`,
        `"${brk1Disp}"`,
        `"${lunchDisp}"`,
        `"${brk2Disp}"`,
        eff.isOver ? 'YES' : '',
        (r.housekeepers || []).length
      ].join(',');
    });

    const results  = rows.map(r => calc(r.co, r.so, r.fs));
    let totalHK = 0, totalMin = 0;
    const totalDNDcsv = rows.reduce((s,r) => s + (Math.max(0, parseInt(r.dnd)||0)), 0);
    rows.forEach((r,i) => {
      const hks = r.housekeepers || [];
      if (hks.length > 0) { totalHK += hks.length; hks.forEach(hk => { totalMin += calcHKShift(hk).totalMin; }); }
      else { const e = effective(results[i],r); totalHK += e.hk; totalMin += results[i].totalMin; }
    });
    const avgHrs = totalHK > 0 ? (totalMin/totalHK/60).toFixed(2) : 0;
    const totRow = ['','TOTALS','','','',totalDNDcsv,'','','',totalHK,avgHrs+' avg','','','','','',''].join(',');

    const hkHeaders = [
      'Property','Housekeeper Name','CO Rooms','SO Rooms','FS Rooms',
      'Clock In','Productive Hours','Scheduled Out','Actual Out','Variance (min)',
      'Break 1','Lunch','Break 2','Over 7.5 hrs?'
    ];
    const hkDataRows = [];
    rows.forEach(r => {
      (r.housekeepers || []).forEach(hk => {
        const result = calcHKShift(hk);
        let ciDisp = '';
        if (hk.clockIn) { const [hh,mm] = hk.clockIn.split(':').map(Number); ciDisp = fmtTime(hh*60+mm); }
        const sh = result.shift;
        const coDisp = sh ? fmtTime(sh.clockOut) : '';
        let actualDisp = '', varianceDisp = '';
        if (hk.actualOut) {
          const [ah,am] = hk.actualOut.split(':').map(Number);
          actualDisp = fmtTime(ah*60+am);
          if (sh) {
            const diff = (ah*60+am) - sh.clockOut;
            varianceDisp = diff > 0 ? `+${diff}` : diff === 0 ? '0' : `${diff}`;
          }
        }
        const b1 = (sh && result.hrs >= 2) ? fmtRange(sh.break1.start, sh.break1.end) : '';
        const lu = (sh && sh.lunch) ? fmtRange(sh.lunch.start, sh.lunch.end) : '';
        const b2 = (sh && sh.break2) ? fmtRange(sh.break2.start, sh.break2.end) : '';
        hkDataRows.push([
          `"${(r.name||'').replace(/"/g,'""')}"`,
          `"${(hk.name||'').replace(/"/g,'""')}"`,
          parseInt(hk.co)||0, parseInt(hk.so)||0, parseInt(hk.fs)||0,
          `"${ciDisp}"`, result.hrs.toFixed(2), `"${coDisp}"`,
          `"${actualDisp}"`, varianceDisp,
          `"${b1}"`, `"${lu}"`, `"${b2}"`, result.isOver ? 'YES' : ''
        ].join(','));
      });
    });

    const csvParts = [
      `"Housekeeping Schedule — ${dateVal}"`,
      '',
      '"--- PROPERTY SUMMARY ---"',
      headers.join(','), ...dataRows, totRow
    ];
    if (hkDataRows.length > 0) {
      csvParts.push('', '"--- HOUSEKEEPER DETAIL ---"', hkHeaders.join(','), ...hkDataRows);
    }
    const csv = csvParts.join('\n');

    const blob = new Blob([csv], {type:'text/csv'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `housekeeping-${dateVal}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function esc(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function updatePrintDate() {
    const val      = document.getElementById('schedDate').value;
    const printDiv = document.getElementById('printDate');
    const printVal = document.getElementById('printDateVal');
    if (val) {
      const d = new Date(val + 'T00:00:00');
      printVal.textContent = d.toLocaleDateString('en-US', {weekday:'long',year:'numeric',month:'long',day:'numeric'});
      printDiv.style.display = 'block';
    } else { printDiv.style.display = 'none'; }
  }

  function setHeaderDate() {
    document.getElementById('headerDate').textContent = new Date().toLocaleDateString('en-US', {
      weekday:'long', year:'numeric', month:'long', day:'numeric'
    });
  }

  loadData();
  setHeaderDate();
  updatePrintDate();

  const sd = document.getElementById('schedDate');
  if (!sd.value) { sd.value = new Date().toISOString().split('T')[0]; saveData(); }

  if (!rows.length) { addRow(); } else { renderFull(); }
