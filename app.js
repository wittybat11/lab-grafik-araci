'use strict';

(() => {
  const STORE_KEY = 'phys111-lab-grafik-v1';
  const EXP = Object.fromEntries(EXPERIMENTS.map((e) => [e.id, e]));
  const panel = document.getElementById('panel');
  const tabsEl = document.getElementById('tabs');
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = Lab.fixed;
  const pm = (v, u) => Lab.minus(Lab.pm(v, u));
  const hasPlotly = () => typeof window.Plotly !== 'undefined';

  /* =========================================================
     Kalıcı durum (localStorage yoksa uygulama yine çalışır)
     ========================================================= */
  let storageOk = true;
  function load() {
    try {
      const s = window.localStorage.getItem(STORE_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      storageOk = false;
      return null;
    }
  }
  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      storageOk = false;
      showStorageNote();
    }
  }
  function showStorageNote() {
    const el = document.getElementById('storage-note');
    if (el && !storageOk) el.textContent = 'Tarayıcı yerel depolamaya izin vermiyor; girdiğiniz veriler sayfa yenilenince kaybolur.';
  }

  const emptyRow = (exp) => exp.columns.map(() => '');
  const freshRows = (exp) => Array.from({ length: exp.rows }, () => emptyRow(exp));

  function freshExpState(exp) {
    const mode = exp.xModes ? exp.xModes[0].value : null;
    const p = exp.plot(mode);
    return {
      rows: freshRows(exp),
      consts: Object.fromEntries(exp.constants.map((c) => [c.key, String(c.def)])),
      opts: Object.fromEntries(exp.options.map((o) => [o.key, o.def])),
      xMode: mode,
      axes: { x: p.xTitle, y: p.yTitle },
      plotOpts: { ...p.defaults },
      copyOpts: { header: !exp.report, trial: true, inputs: false, format: exp.report ? 'report' : 'custom' },
    };
  }

  /** Kayıtlı veriyi doğrular; bozuk ya da eski biçimdeki alanlar varsayılana döner. */
  function sanitize(exp, s) {
    const d = freshExpState(exp);
    if (!s || typeof s !== 'object') return d;
    const n = exp.columns.length;
    if (Array.isArray(s.rows) && s.rows.length && s.rows.every((r) => Array.isArray(r) && r.length === n)) {
      d.rows = s.rows.map((r) => r.map((c) => (typeof c === 'string' ? c : '')));
    }
    if (s.consts) for (const c of exp.constants) if (typeof s.consts[c.key] === 'string') d.consts[c.key] = s.consts[c.key];
    if (s.opts) for (const o of exp.options) if (typeof s.opts[o.key] === 'boolean') d.opts[o.key] = s.opts[o.key];
    if (exp.xModes && exp.xModes.some((m) => m.value === s.xMode)) d.xMode = s.xMode;
    const p = exp.plot(d.xMode);
    d.axes = { x: p.xTitle, y: p.yTitle };
    d.plotOpts = { ...p.defaults };
    const sameMode = (s.xMode == null ? null : s.xMode) === d.xMode;
    if (s.axes && sameMode) for (const k of ['x', 'y']) if (typeof s.axes[k] === 'string') d.axes[k] = s.axes[k];
    if (s.plotOpts && sameMode) for (const k of Object.keys(d.plotOpts)) if (typeof s.plotOpts[k] === 'boolean') d.plotOpts[k] = s.plotOpts[k];
    if (s.copyOpts) for (const k of Object.keys(d.copyOpts)) if (typeof s.copyOpts[k] === 'boolean') d.copyOpts[k] = s.copyOpts[k];
    if (s.copyOpts && exp.report && ['report', 'custom'].includes(s.copyOpts.format)) d.copyOpts.format = s.copyOpts.format;
    return d;
  }

  const saved = load();
  const state = {
    active: saved && EXP[saved.active] ? saved.active : EXPERIMENTS[0].id,
    exps: {},
  };
  for (const e of EXPERIMENTS) state.exps[e.id] = sanitize(e, saved && saved.exps && saved.exps[e.id]);

  const cur = () => EXP[state.active];
  const cs = () => state.exps[state.active];
  const plotSpec = () => cur().plot(cs().xMode);
  const colLabel = (exp, key) => Lab.text(exp.columns.find((c) => c.key === key).html);

  /* =========================================================
     Değerlendirme: hücreleri oku, doğrula, hesapla
     ========================================================= */
  function evalConsts(exp, es) {
    const values = {}, errors = {};
    for (const c of exp.constants) {
      const r = Lab.parseNum(es.consts[c.key]);
      if (r.empty) errors[c.key] = 'değer girin';
      else if (r.error) errors[c.key] = 'sayı değil';
      else {
        const m = c.check(r.value);
        if (m) errors[c.key] = m;
        else values[c.key] = r.value;
      }
    }
    return { values, errors, ok: Object.keys(errors).length === 0 };
  }

  function evalRow(exp, raw, ctx, constsOk, index) {
    const vals = {}, cellErr = {};
    let filled = false;
    exp.columns.forEach((c, i) => {
      const r = Lab.parseNum(raw[i]);
      vals[c.key] = null;
      if (r.empty) return;
      filled = true;
      if (r.error) { cellErr[c.key] = 'sayı değil'; return; }
      const m = c.check(r.value);
      if (m) cellErr[c.key] = m;
      vals[c.key] = r.value;
    });
    if (!filled) return { index, status: 'empty' };
    if (Object.keys(cellErr).length) return { index, status: 'error', cellErr };
    const missing = exp.columns.filter((c) => !c.optional && vals[c.key] === null).map((c) => Lab.text(c.html));
    if (exp.requireAny && exp.requireAny.keys.every((k) => vals[k] === null)) missing.push(exp.requireAny.label);
    if (missing.length) return { index, status: 'incomplete', missing };
    if (!constsOk) return { index, status: 'blocked' };
    let res;
    try {
      res = exp.calc(vals, ctx);
    } catch (e) {
      return { index, status: 'error', rowErr: 'hesaplanamadı' };
    }
    if (res.cellErr) return { index, status: 'error', cellErr: res.cellErr };
    const bad = Object.values(res.values).some((v) => v !== null && !Number.isFinite(v));
    if (bad) return { index, status: 'error', rowErr: 'sonuç tanımsız (sıfıra bölme)' };
    return { index, status: 'ok', values: res.values };
  }

  function evaluate(exp, es) {
    const cc = evalConsts(exp, es);
    const ctx = { c: cc.values, opts: es.opts };
    const rows = es.rows.map((raw, i) => evalRow(exp, raw, ctx, cc.ok, i));
    const valid = rows.filter((r) => r.status === 'ok').map((r) => ({ ...r.values, _row: r.index }));
    return { cc, ctx, rows, valid };
  }

  /* =========================================================
     Arayüz: sekmeler ve panel
     ========================================================= */
  function renderTabs() {
    tabsEl.innerHTML = EXPERIMENTS.map((e) => {
      const on = e.id === state.active;
      return `<button type="button" class="tab" role="tab" id="tab-${e.id}" data-id="${e.id}"
        aria-controls="panel" aria-selected="${on}" tabindex="${on ? 0 : -1}">
        <b>${e.tab}</b>${e.tabSub ? `<span>${e.tabSub}</span>` : ''}</button>`;
    }).join('');
    panel.setAttribute('aria-labelledby', `tab-${state.active}`);
  }

  function checkbox(key, label, on) {
    return `<label class="check" data-check="${key}"><input type="checkbox" data-popt="${key}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
  }

  function renderPanel() {
    const exp = cur(), es = cs(), p = plotSpec();
    const plotEl = document.getElementById('plot');
    if (plotEl && hasPlotly()) window.Plotly.purge(plotEl);

    const constsCard = exp.constants.length || exp.options.length ? `
      <div class="card">
        ${exp.constants.length ? `<h3>Sabitler</h3>
        <div class="consts">${exp.constants.map((c) => `
          <label class="field">
            <span class="field-label">${c.html}</span>
            <span class="input-unit" data-const-wrap="${c.key}">
              <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-const="${c.key}"
                value="${esc(es.consts[c.key])}" aria-describedby="cerr-${c.key}">
              <em>${c.unit}</em>
            </span>
            <span class="field-error" id="cerr-${c.key}"></span>
          </label>`).join('')}
        </div>` : ''}
        ${exp.options.map((o) => `
          <div class="opts">
            <label class="check"><input type="checkbox" data-opt="${o.key}" ${es.opts[o.key] ? 'checked' : ''}><span>${o.label}</span></label>
            ${o.hint ? `<p class="hint">${o.hint}</p>` : ''}
          </div>`).join('')}
      </div>` : '';

    const head = `<tr>
      <th scope="col"><span class="sr">Satır</span></th>
      ${exp.columns.map((c) => `<th scope="col">${c.html}${c.unit ? ` <span class="unit">(${c.unit})</span>` : ''}${c.optional && exp.id === 'free' ? ' <span class="unit">isteğe bağlı</span>' : ''}</th>`).join('')}
      <th scope="col"><span class="sr">Sil</span></th></tr>`;

    const theoryLabel = p.theoryName || 'Teori çizgisi';

    panel.innerHTML = `
      <section class="col col-input" aria-label="Veri girişi">
        <div class="card intro">
          <h2>${exp.title}</h2>
          <p>${exp.note}</p>
        </div>
        ${constsCard}
        <div class="card">
          <div class="card-head">
            <h3>Ölçümler</h3>
            <span class="paste-hint">Excel/Word tablosundan yapıştırabilirsiniz · ondalık: nokta veya virgül</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>${head}</thead>
              <tbody id="rows"></tbody>
            </table>
          </div>
          <div class="table-actions" id="table-actions">
            <button type="button" class="btn" id="add-row">+ Satır ekle</button>
            <button type="button" class="btn" id="clear-table">Tabloyu temizle</button>
          </div>
          <div class="confirm" id="clear-confirm" role="group" aria-labelledby="clear-q" hidden>
            <p id="clear-q">Tablodaki tüm değerler silinsin mi? Tablo ${exp.rows} boş satıra döner.</p>
            <button type="button" class="btn primary" id="clear-yes">Evet, temizle</button>
            <button type="button" class="btn" id="clear-no">Vazgeç</button>
          </div>
        </div>
      </section>

      <section class="col col-output" aria-label="Grafik ve sonuçlar">
        <div class="card">
          <div class="card-head">
            <h3>Grafik</h3>
            <button type="button" class="btn primary" id="dl-png">PNG indir</button>
          </div>
          <div class="plot-area">
            <div id="plot" role="img" aria-label="Deney grafiği"></div>
            <div class="plot-empty" id="plot-empty"><span>Veri girince grafik burada görünecek.</span></div>
          </div>
          <div class="plot-controls">
            ${exp.xModes ? `<label class="select-row"><span>x ekseni:</span>
              <select id="x-mode">${exp.xModes.map((m) => `<option value="${m.value}" ${m.value === es.xMode ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>` : ''}
            <fieldset class="checks">
              <legend>Grafik seçenekleri</legend>
              ${checkbox('fit', 'Doğrusal fit', es.plotOpts.fit)}
              ${p.err ? checkbox('err', 'Hata çubukları', es.plotOpts.err) : ''}
              ${p.theory ? checkbox('theory', theoryLabel, es.plotOpts.theory) : ''}
              ${checkbox('connect', 'Noktaları birleştir', es.plotOpts.connect)}
            </fieldset>
            <div class="axis-fields">
              <label class="field"><span class="field-label">x ekseni başlığı</span>
                <span class="input-unit"><input type="text" autocomplete="off" spellcheck="false" data-axis="x" value="${esc(es.axes.x)}" aria-describedby="axis-hint"></span></label>
              <label class="field"><span class="field-label">y ekseni başlığı</span>
                <span class="input-unit"><input type="text" autocomplete="off" spellcheck="false" data-axis="y" value="${esc(es.axes.y)}" aria-describedby="axis-hint"></span></label>
            </div>
            <div class="axis-foot">
              <p class="hint" id="axis-hint">Alt simge <code>&lt;sub&gt;</code>, üst simge <code>&lt;sup&gt;</code>: <code>v&lt;sub&gt;avg&lt;/sub&gt;</code> → v<sub>avg</sub>, <code>m/s&lt;sup&gt;2&lt;/sup&gt;</code> → m/s<sup>2</sup></p>
              <button type="button" class="btn btn-small" id="axes-reset">Varsayılan başlıklar</button>
            </div>
          </div>
        </div>

        <div class="card">
          <h3>Sonuçlar</h3>
          <div id="results" aria-live="polite"></div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>Hesaplanan değerler</h3>
            <button type="button" class="btn" id="copy-table">Tabloyu kopyala</button>
          </div>
          ${exp.report ? `<label class="select-row copy-format"><span>Tablo biçimi:</span>
            <select id="copy-format">
              <option value="report" ${useReport(exp, es) ? 'selected' : ''}>${exp.report.label}</option>
              <option value="custom" ${useReport(exp, es) ? '' : 'selected'}>Özel: bu sekmenin tüm hesaplanan değerleri</option>
            </select></label>` : ''}
          <fieldset class="checks copy-opts">
            <legend>Kopyalanacak tablo</legend>
            <label class="check"><input type="checkbox" data-copt="header" ${es.copyOpts.header ? 'checked' : ''}><span>Başlık satırı</span></label>
            ${useReport(exp, es) ? '' : `<label class="check"><input type="checkbox" data-copt="trial" ${es.copyOpts.trial ? 'checked' : ''}><span>Deneme no (Trial) sütunu</span></label>`}
            ${exp.id === 'free' || useReport(exp, es) ? '' : `<label class="check"><input type="checkbox" data-copt="inputs" ${es.copyOpts.inputs ? 'checked' : ''}><span>Ölçülen değerler (girdiğiniz sütunlar)</span></label>`}
          </fieldset>
          <div class="table-wrap" id="calc"></div>
          <p class="hint copy-hint" id="copy-hint"></p>
        </div>
      </section>`;

    renderRows();
    refresh();
  }

  function renderRows() {
    const exp = cur(), es = cs();
    $('#rows').innerHTML = es.rows.map((row, i) => `
      <tr data-row="${i}">
        <td class="rownum">${i + 1}</td>
        ${exp.columns.map((c, j) => `<td><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
          data-r="${i}" data-c="${j}" value="${esc(row[j])}"
          aria-label="${i + 1}. satır, ${esc(Lab.text(c.html))}${c.unit ? ` (${c.unit})` : ''}" aria-describedby="msg-${i}"></td>`).join('')}
        <td class="rowdel"><button type="button" class="btn-icon" data-del="${i}" title="Satırı sil" aria-label="${i + 1}. satırı sil">✕</button></td>
      </tr>
      <tr class="msg-row" id="msgrow-${i}" hidden><td></td><td colspan="${exp.columns.length + 1}"><span class="row-msg" id="msg-${i}"></span></td></tr>`).join('');
  }

  /* =========================================================
     Güncelleme: doğrulama, grafik, sonuçlar, tablo
     ========================================================= */
  let lastEval = null;
  let lastTableRows = 0; // kopyalanacak tablodaki veri satırı sayısı
  let activeRow = null; // odaktaki satır: eksik uyarısı yazarken gösterilmez
  const focusedRow = () => { const a = document.activeElement; return a && a.dataset && a.dataset.r !== undefined ? +a.dataset.r : null; };

  function refresh() {
    const exp = cur(), es = cs(), p = plotSpec();
    const ev = evaluate(exp, es);
    lastEval = ev;
    applyValidation(exp, ev);
    applyConstValidation(exp, ev);
    const fit = es.plotOpts.fit ? Lab.linFit(ev.valid.map((r) => r[p.x]), ev.valid.map((r) => r[p.y])) : null;
    renderPlot(es, ev, p, fit);
    renderResults(es, ev, p, fit);
    renderCalc(exp, ev);
    updateControls(exp, es, ev, p);
  }

  function applyValidation(exp, ev) {
    for (const r of ev.rows) {
      const tr = panel.querySelector(`tr[data-row="${r.index}"]`);
      if (!tr) continue;
      const inputs = tr.querySelectorAll('input[data-c]');
      exp.columns.forEach((c, j) => {
        const bad = !!(r.cellErr && r.cellErr[c.key]);
        inputs[j].classList.toggle('invalid', bad);
        if (bad) inputs[j].setAttribute('aria-invalid', 'true');
        else inputs[j].removeAttribute('aria-invalid');
      });
      let text = '', isErr = false;
      if (r.status === 'error') {
        isErr = true;
        text = (r.rowErr || Object.entries(r.cellErr).map(([k, m]) => `${colLabel(exp, k)}: ${m}`).join(' · ')) + ' — satır hesaba katılmadı';
      } else if (r.status === 'incomplete' && r.index !== focusedRow()) {
        text = `Eksik: ${r.missing.join(', ')} — satır hesaba katılmadı`;
      }
      tr.classList.toggle('row-ignored', isErr);
      const msg = document.getElementById(`msg-${r.index}`);
      msg.textContent = text;
      msg.classList.toggle('error', isErr);
      document.getElementById(`msgrow-${r.index}`).hidden = !text;
    }
  }

  function applyConstValidation(exp, ev) {
    for (const c of exp.constants) {
      const err = ev.cc.errors[c.key];
      const wrap = panel.querySelector(`[data-const-wrap="${c.key}"]`);
      wrap.classList.toggle('invalid', !!err);
      const input = wrap.querySelector('input');
      if (err) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      document.getElementById(`cerr-${c.key}`).textContent = err || '';
    }
  }

  /* ---------- Grafik (rapordaki Python/matplotlib şekilleriyle aynı görünüm) ---------- */
  const PLOT_FONT = '"DejaVu Serif", "Bitstream Vera Serif", Georgia, "Times New Roman", serif';
  const PLOT_CONFIG = { displayModeBar: false, responsive: true };
  const COLORS = { data: '#1f4e79', fit: '#c00000', theory: '#808080', grid: '#e6e6e6' };

  function axis(title, range) {
    return {
      title: { text: title, font: { size: 16 }, standoff: 8 },
      range,
      autorange: false,
      showline: true, linecolor: '#000', linewidth: 1, mirror: true,
      ticks: 'outside', ticklen: 5, tickwidth: 1, tickcolor: '#000',
      showgrid: true, gridcolor: COLORS.grid, gridwidth: 1,
      zeroline: false,
      tickfont: { size: 14 },
      automargin: true,
    };
  }

  /** Lejanttaki katsayı: belirsizliğin 1 anlamlı basamağına göre (ör. 3.123 ± 0.047 → 3.12). */
  function eqCoef(v, u) {
    if (u == null || !Number.isFinite(u) || u <= Math.abs(v) * 1e-9) return Lab.auto(v, 3);
    const dec = -Math.floor(Math.log10(Number(u.toPrecision(1))));
    return Lab.fixed(v, Math.max(0, Math.min(10, dec)));
  }

  function fitLabel(p, fit) {
    const eq = p.eq || { y: 'y', x: 'x' };
    const k = eqCoef(fit.k, fit.dk), b = eqCoef(fit.b, fit.db);
    const bNeg = b.startsWith('-');
    return `Linear fit: ${eq.y} = ${Lab.minus(k)} ${eq.x} ${bNeg ? '−' : '+'} ${bNeg ? b.slice(1) : b}`;
  }

  function buildFigure(es, ev, p, fit) {
    const pts = ev.valid.map((r) => ({ x: r[p.x], y: r[p.y], e: p.err ? r[p.err] : null }));
    if (es.plotOpts.connect) pts.sort((a, b) => a.x - b.x);
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const xspan = (xmax - xmin) || Math.abs(xmax) || 1;
    const x0 = p.fromOrigin && xmin >= 0 ? 0 : xmin - 0.05 * xspan;
    const x1 = xmax + 0.05 * xspan;

    const showErr = !!p.err && es.plotOpts.err && pts.some((q) => q.e > 0);
    const traces = [{
      type: 'scatter',
      mode: es.plotOpts.connect ? 'lines+markers' : 'markers',
      name: 'Measured data',
      legendrank: 3, // matplotlib gibi: önce çizgiler, sonra ölçümler
      x: xs, y: ys,
      marker: { color: COLORS.data, size: 9, symbol: 'circle' },
      line: { color: COLORS.data, width: 2 },
      error_y: showErr
        ? { type: 'data', array: pts.map((q) => q.e || 0), visible: true, color: COLORS.data, thickness: 1.5, width: 4 }
        : { visible: false },
      hovertemplate: '(%{x}, %{y})<extra></extra>',
    }];
    if (fit && fit.ok) {
      traces.push({
        type: 'scatter', mode: 'lines', name: fitLabel(p, fit), legendrank: 1,
        x: [x0, x1], y: [fit.k * x0 + fit.b, fit.k * x1 + fit.b],
        line: { color: COLORS.fit, width: 2 }, hoverinfo: 'skip',
      });
    }
    if (p.theory && es.plotOpts.theory) {
      const t = p.theory(ev.valid, [x0, x1], ev.ctx);
      traces.push({
        type: 'scatter', mode: 'lines', name: p.theoryLabel ? p.theoryLabel(ev.valid) : 'Theory', legendrank: 2,
        x: t.x, y: t.y,
        line: { color: COLORS.theory, width: 2, dash: 'dash' }, hoverinfo: 'skip',
      });
    }
    // Ölçümler çizgilerin üstünde görünsün
    traces.push(traces.shift());

    // y aralığı: veriler, hata çubukları ve çizgiler; lejant için üstte boşluk
    const yAll = [];
    pts.forEach((q) => { yAll.push(q.y); if (showErr && q.e) yAll.push(q.y + q.e, q.y - q.e); });
    traces.slice(0, -1).forEach((t) => yAll.push(...t.y));
    let ylo = Math.min(...yAll), yhi = Math.max(...yAll);
    const yspan = (yhi - ylo) || Math.abs(yhi) || 1;
    const legend = traces.length > 1;
    ylo -= 0.06 * yspan;
    yhi += (legend ? 0.30 : 0.06) * yspan;
    if (p.fromOrigin && Math.min(...ys) >= 0 && ylo < 0 && ylo > -0.1 * yspan) ylo = 0;

    const layout = {
      font: { family: PLOT_FONT, size: 15, color: '#000' },
      paper_bgcolor: '#fff', plot_bgcolor: '#fff',
      margin: { l: 70, r: 20, t: 16, b: 56 },
      xaxis: axis(es.axes.x, [x0, x1]),
      yaxis: axis(es.axes.y, [ylo, yhi]),
      showlegend: legend,
      legend: {
        x: 0.015, y: 0.985, xanchor: 'left', yanchor: 'top',
        bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#cccccc', borderwidth: 1,
        font: { size: 13 },
      },
      hovermode: 'closest',
    };
    return { traces, layout };
  }

  function renderPlot(es, ev, p, fit) {
    const plotEl = document.getElementById('plot');
    const empty = document.getElementById('plot-empty');
    const say = (t) => { empty.firstElementChild.textContent = t; empty.hidden = false; };
    if (!hasPlotly()) {
      say('Grafik kütüphanesi (Plotly) yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.');
      return;
    }
    if (!ev.cc.ok) { window.Plotly.purge(plotEl); say('Sabitlerdeki hatalı değeri düzeltin.'); return; }
    if (!ev.valid.length) { window.Plotly.purge(plotEl); say('Veri girince grafik burada görünecek.'); return; }
    empty.hidden = true;
    const { traces, layout } = buildFigure(es, ev, p, fit);
    window.Plotly.react(plotEl, traces, layout, PLOT_CONFIG);
  }

  /* ---------- Sonuç kutusu ---------- */
  function renderResults(es, ev, p, fit) {
    const el = document.getElementById('results');
    if (!ev.cc.ok) { el.innerHTML = '<p class="results-empty">Sabitlerdeki hata düzeltilince sonuçlar hesaplanır.</p>'; return; }
    if (!ev.valid.length) { el.innerHTML = '<p class="results-empty">Sonuçlar için ölçüm girin (fit için en az 2 geçerli satır).</p>'; return; }
    let html = '';
    if (!es.plotOpts.fit) {
      html += `<p class="results-empty">${p.noFitNote || 'Doğrusal fit kapalı. Eğim ve kesişim için “Doğrusal fit” kutusunu işaretleyin.'}</p>`;
    } else if (!fit.ok) {
      html += `<p class="results-empty">${fit.reason === 'samex'
        ? 'Tüm x değerleri aynı; doğru uydurulamaz.'
        : 'Doğrusal fit için en az 2 geçerli nokta gerekli.'} (n = ${fit.n})</p>`;
    } else {
      // Denklem katsayıları, belirsizlikle aynı ondalık basamağa yuvarlanır
      const coef = (v, u) => Lab.pm(v, u).split(' ± ')[0];
      const kS = coef(fit.k, fit.dk), bS = coef(fit.b, fit.db);
      const bNeg = bS.startsWith('-');
      html += `<p class="fit-eq"><i>y</i> = ${Lab.minus(kS)}<i>x</i> ${bNeg ? '−' : '+'} ${bNeg ? bS.slice(1) : bS}</p>
        <dl class="fit-list">
          <dt>Eğim</dt><dd>${pm(fit.k, fit.dk)} ${p.kUnit}</dd>
          <dt>Kesişim</dt><dd>${pm(fit.b, fit.db)} ${p.bUnit}</dd>
          <dt>R²</dt><dd>${fit.r2 == null ? '— (tüm y değerleri aynı)' : f(fit.r2, 4)}</dd>
          <dt>Nokta sayısı</dt><dd>n = ${fit.n}</dd>
        </dl>`;
      if (fit.n < 3) html += '<p class="note">n &lt; 3 olduğu için eğim ve kesişimin belirsizlikleri hesaplanamaz (en az 3 nokta gerekli).</p>';
    }
    const lines = p.interpret(es.plotOpts.fit ? fit : null, ev.valid, ev.ctx);
    if (lines.length) {
      html += `<ul class="interp">${lines.map((l) => (typeof l === 'string' ? `<li>${l}</li>` : `<li class="warn">${l.html}</li>`)).join('')}</ul>`;
    }
    el.innerHTML = html;
  }

  /* ---------- Hesaplanan değerler ---------- */
  const fmtOut = (o, v) => (v == null || !Number.isFinite(v) ? '' : o.dec == null ? Lab.auto(v, 6) : f(v, o.dec));
  const outHead = (o) => `${o.html}${o.unit ? ` <span class="unit">(${o.unit})</span>` : ''}`;

  /** Ekranda gösterilen ve panoya kopyalanan tablo aynı modelden üretilir. */
  function useReport(exp, es) { return !!exp.report && es.copyOpts.format === 'report'; }

  /** Föy tablosu: birden çok sekmenin geçerli satırları, föydeki sütun sırasıyla. */
  function reportModel(exp, ev) {
    const items = [], counts = [];
    for (const id of exp.report.sources) {
      const e2 = EXP[id], s2 = state.exps[id];
      const ev2 = id === exp.id ? ev : evaluate(e2, s2);
      ev2.valid.forEach((r) => items.push({ r, es: s2, exp: e2 }));
      counts.push({ tab: e2.tab, n: ev2.valid.length });
    }
    const cols = exp.report.cols.map((c) => ({
      html: c.html, unit: c.unit,
      get: (it, i) => {
        if (c.row) return String(i + 1);
        if (c.raw) {
          const txt = String(it.es.rows[it.r._row][it.exp.columns.findIndex((k) => k.key === c.raw)]).trim().replace(',', '.');
          if (c.dec == null) return txt;
          const p = Lab.parseNum(txt); // ör. üç okumanın ortalaması 0.2248 → tabloda 0.225
          return p.value === undefined ? txt : f(p.value, c.dec);
        }
        return fmtOut(c, it.r[c.key]);
      },
    }));
    return { cols, body: items.map((it, i) => cols.map((c) => c.get(it, i))), counts };
  }

  function tableModel(exp, es, ev) {
    if (useReport(exp, es)) return reportModel(exp, ev);
    const o = es.copyOpts, cols = [];
    if (o.trial) cols.push({ html: 'Trial', unit: '', get: (r, i) => String(i + 1) });
    if (o.inputs && exp.id !== 'free') {
      exp.columns.forEach((c, j) => {
        const html = c.key === 't2' && es.opts.memory ? 't<sub>1</sub> + t<sub>2</sub>' : c.html;
        cols.push({ html, unit: c.unit, get: (r) => String(es.rows[r._row][j]).trim().replace(',', '.') });
      });
    }
    exp.outputs.forEach((out) => cols.push({ html: out.html, unit: out.unit, get: (r) => fmtOut(out, r[out.key]) }));
    const body = ev.valid.map((r, i) => cols.map((c) => c.get(r, i)));
    return { cols, body };
  }

  function renderCalc(exp, ev) {
    const el = document.getElementById('calc'), es = cs();
    const hint = document.getElementById('copy-hint');
    const { cols, body, counts } = tableModel(exp, es, ev);
    lastTableRows = body.length;
    if (!body.length) { el.innerHTML = '<p class="results-empty">Geçerli satır yok.</p>'; hint.textContent = ''; return; }
    const head = es.copyOpts.header;
    el.innerHTML = `<table class="calc-table">
      <thead><tr${head ? '' : ' class="head-off" title="Başlık satırı kopyalanmayacak"'}>${cols.map((c) => `<th scope="col">${outHead(c)}</th>`).join('')}</tr></thead>
      <tbody>${body.map((row) => `<tr>${row.map((v) => `<td>${esc(Lab.minus(v))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
    const nRows = body.length + (head ? 1 : 0);
    const from = counts ? ` — ${counts.map((c) => `${esc(c.tab)} sekmesinden ${c.n} satır`).join(', ')}` : '';
    const first = Lab.text(cols[0].html), last = Lab.text(cols[cols.length - 1].html);
    hint.innerHTML = `<b>Kopyalanacak alan: ${nRows} satır × ${cols.length} sütun</b>${head ? ' (başlık dahil)' : ' (başlıksız)'}${from}.
      <ol class="paste-steps">
        <li>Word tablonuzda <b>${esc(first)}</b> sütununun ilk ${head ? 'satırından (başlık)' : 'veri hücresinden'} <b>${esc(last)}</b> sütununun ${nRows}. satırına kadar <b>${nRows} × ${cols.length} hücreyi fareyle seçin</b>.</li>
        <li><b>Ctrl+V</b> yapın; seçili hücrelerin üzerine yazılır.</li>
      </ol>
      İmleci yalnızca bir hücreye koyup yapıştırırsanız Word tabloyu böler ya da her şeyi tek hücreye koyar.${head ? ' Tablonuzda başlık zaten varsa “Başlık satırı”nı kaldırın.' : ''}`;
  }

  /* ---------- Buton durumları ---------- */
  function setDisabled(el, off, why) {
    if (!el) return;
    el.disabled = off;
    if (off && why) el.title = why; else el.removeAttribute('title');
  }

  function updateControls(exp, es, ev, p) {
    const allEmpty = es.rows.every((r) => r.every((c) => c.trim() === ''));
    setDisabled($('#clear-table'), allEmpty && es.rows.length === exp.rows, 'Tablo zaten boş');
    panel.querySelectorAll('[data-del]').forEach((b) => {
      b.disabled = es.rows.length <= 1;
      b.title = b.disabled ? 'En az bir satır kalmalı' : 'Satırı sil';
    });
    setDisabled($('#dl-png'), !ev.valid.length || !hasPlotly(), hasPlotly() ? 'Önce geçerli veri girin' : 'Grafik kütüphanesi yüklenemedi');
    setDisabled($('#copy-table'), !lastTableRows, 'Kopyalanacak geçerli satır yok');
    const def = exp.plot(es.xMode);
    setDisabled($('#axes-reset'), es.axes.x === def.xTitle && es.axes.y === def.yTitle, 'Başlıklar zaten varsayılan');

    // Serbest grafikte δy girilmemişse hata çubuğu seçeneği işlevsiz: devre dışı göster
    const errBox = panel.querySelector('[data-popt="err"]');
    if (errBox) {
      const any = ev.valid.some((r) => r[p.err] > 0);
      errBox.disabled = !any;
      errBox.closest('.check').classList.toggle('disabled', !any);
      errBox.closest('.check').title = any ? '' : 'Hata değeri girilmemiş';
    }
  }

  /* =========================================================
     Bildirim
     ========================================================= */
  let toastTimer = null, toastHideTimer = null;
  function toast(msg, action) {
    const el = $('#toast'), btn = $('#toast-action');
    clearTimeout(toastTimer); clearTimeout(toastHideTimer);
    $('#toast-msg').textContent = msg;
    btn.hidden = !action;
    btn.onclick = null;
    if (action) {
      btn.textContent = action.label;
      btn.onclick = () => { hideToast(); action.fn(); };
    }
    el.classList.remove('leaving');
    el.hidden = false;
    toastTimer = setTimeout(hideToast, action ? 6000 : 2800);
  }
  function hideToast() {
    const el = $('#toast');
    clearTimeout(toastTimer);
    el.classList.add('leaving');
    toastHideTimer = setTimeout(() => { el.hidden = true; el.classList.remove('leaving'); }, 200);
  }

  /* =========================================================
     İşlemler
     ========================================================= */
  function focusCell(r, c) {
    const el = panel.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
    if (el) { el.focus(); el.select(); }
  }

  function addRow() {
    const exp = cur(), es = cs();
    es.rows.push(emptyRow(exp));
    save(); renderRows(); refresh();
    focusCell(es.rows.length - 1, 0);
    toast(`Satır eklendi (${es.rows.length}. satır)`);
  }

  function deleteRow(i) {
    const exp = cur(), es = cs(), id = exp.id;
    if (es.rows.length <= 1) return;
    const removed = es.rows.splice(i, 1)[0];
    save(); renderRows(); refresh();
    const next = panel.querySelector(`[data-del="${Math.min(i, es.rows.length - 1)}"]`);
    if (next && !next.disabled) next.focus(); else $('#add-row').focus();
    const hadData = removed.some((c) => c.trim() !== '');
    toast(`${i + 1}. satır silindi`, hadData ? {
      label: 'Geri al',
      fn: () => {
        state.exps[id].rows.splice(i, 0, removed);
        save();
        if (state.active === id) { renderRows(); refresh(); }
        toast('Satır geri alındı');
      },
    } : null);
  }

  function showClearConfirm(on) {
    $('#clear-confirm').hidden = !on;
    $('#table-actions').hidden = on;
    if (on) $('#clear-no').focus(); else $('#clear-table').focus();
  }

  function clearTable() {
    const exp = cur(), es = cs(), id = exp.id;
    const snapshot = es.rows.map((r) => r.slice());
    es.rows = freshRows(exp);
    save(); renderRows();
    $('#clear-confirm').hidden = true;
    $('#table-actions').hidden = false;
    refresh();
    focusCell(0, 0);
    toast('Tablo temizlendi', {
      label: 'Geri al',
      fn: () => {
        state.exps[id].rows = snapshot;
        save();
        if (state.active === id) { renderRows(); refresh(); }
        toast('Tablo geri yüklendi');
      },
    });
  }

  /* ---------- Yapıştırma: çok hücreli veriyi tabloya dağıt ---------- */
  function onPaste(e) {
    const t = e.target;
    if (!t.matches || !t.matches('input[data-c]')) return;
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text) return;
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (!lines.length) return;
    let grid = lines.map((l) => l.split('\t'));
    if (grid.length === 1 && grid[0].length === 1) return; // tek hücre: normal yapıştırma

    e.preventDefault();
    const exp = cur(), es = cs();
    let skippedHeader = false;
    if (grid.length > 1) {
      const first = grid[0].filter((c) => c.trim() !== '');
      if (first.length && first.every((c) => Lab.parseNum(c).error)) { grid = grid.slice(1); skippedHeader = true; }
    }
    const r0 = +t.dataset.r, c0 = +t.dataset.c, ncol = exp.columns.length;
    let added = 0, cut = false, width = 0;
    grid.forEach((cells, i) => {
      const r = r0 + i;
      while (es.rows.length <= r) { es.rows.push(emptyRow(exp)); added++; }
      cells.forEach((v, j) => {
        const c = c0 + j;
        if (c < ncol) { es.rows[r][c] = v.trim(); width = Math.max(width, j + 1); } else if (v.trim()) cut = true;
      });
    });
    save(); renderRows(); refresh();
    focusCell(r0 + grid.length - 1, c0 + Math.max(0, width - 1));
    let msg = `${grid.length} × ${width} hücre yapıştırıldı`;
    if (added) msg += `, ${added} satır eklendi`;
    if (skippedHeader) msg += ' (başlık satırı atlandı)';
    if (cut) msg += ' — tabloya sığmayan sütunlar alınmadı';
    toast(msg);
  }

  /* ---------- PNG ---------- */
  async function downloadPng() {
    const p = plotSpec(), gd = document.getElementById('plot');
    if (!hasPlotly() || !lastEval || !lastEval.valid.length) return;
    try {
      await window.Plotly.downloadImage(gd, { format: 'png', width: 800, height: 496, scale: 2.5, filename: p.file });
      toast(`PNG indirildi: ${p.file}.png`);
    } catch (err) {
      toast('PNG oluşturulamadı. Tarayıcı indirmeye izin vermemiş olabilir.');
    }
  }

  /* ---------- Tabloyu kopyala (Word/Excel'e tablo olarak yapışır) ---------- */
  function buildCopy() {
    const exp = cur(), es = cs();
    const { cols, body } = tableModel(exp, es, lastEval);
    const head = es.copyOpts.header;
    const headTxt = cols.map((c) => `${Lab.text(c.html)}${c.unit ? ` (${c.unit})` : ''}`);
    const tsv = (head ? [headTxt, ...body] : body).map((r) => r.join('\t')).join('\r\n');
    const cell = 'border:1px solid #000;padding:2px 6px;text-align:center';
    const html = `<table style="border-collapse:collapse">
      ${head ? `<tr>${cols.map((c) => `<th style="${cell}">${c.html}${c.unit ? ` (${esc(c.unit)})` : ''}</th>`).join('')}</tr>` : ''}
      ${body.map((r) => `<tr>${r.map((v) => `<td style="${cell}">${esc(v)}</td>`).join('')}</tr>`).join('')}
    </table>`;
    return { tsv, html, rows: body.length + (head ? 1 : 0), cols: cols.length };
  }

  function copyViaSelection(html) {
    const box = document.createElement('div');
    box.setAttribute('contenteditable', 'true');
    box.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    box.innerHTML = html;
    document.body.appendChild(box);
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    sel.removeAllRanges();
    box.remove();
    return ok;
  }

  async function copyTable() {
    if (!lastEval || !lastTableRows) return;
    const { tsv, html, rows, cols } = buildCopy();
    let ok = false;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new window.ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
        })]);
        ok = true;
      }
    } catch (e) { ok = false; }
    if (!ok) ok = copyViaSelection(html);
    if (!ok && navigator.clipboard) {
      try { await navigator.clipboard.writeText(tsv); ok = true; } catch (e) { ok = false; }
    }
    toast(ok ? `Tablo kopyalandı: ${rows} satır × ${cols} sütun — Word’de aynı boyuttaki hücreleri seçip Ctrl+V` : 'Kopyalanamadı: tarayıcı panoya erişime izin vermedi.');
  }

  /* =========================================================
     Olaylar
     ========================================================= */
  panel.addEventListener('input', (e) => {
    const t = e.target, es = cs();
    if (t.dataset.c !== undefined) es.rows[+t.dataset.r][+t.dataset.c] = t.value;
    else if (t.dataset.const) es.consts[t.dataset.const] = t.value;
    else if (t.dataset.axis) es.axes[t.dataset.axis] = t.value;
    else return;
    save(); refresh();
  });

  panel.addEventListener('change', (e) => {
    const t = e.target, exp = cur(), es = cs();
    if (t.dataset.opt) {
      es.opts[t.dataset.opt] = t.checked;
      save(); refresh();
    } else if (t.dataset.copt) {
      es.copyOpts[t.dataset.copt] = t.checked;
      save(); refresh();
    } else if (t.id === 'copy-format') {
      es.copyOpts.format = t.value;
      save(); renderPanel();
      $('#copy-format').focus();
      toast(t.value === 'report' ? 'Tablo biçimi: föy tablosu 3.1' : 'Tablo biçimi: özel');
    } else if (t.dataset.popt) {
      es.plotOpts[t.dataset.popt] = t.checked;
      save(); refresh();
    } else if (t.id === 'x-mode') {
      es.xMode = t.value;
      const p = exp.plot(es.xMode);
      es.axes = { x: p.xTitle, y: p.yTitle };
      es.plotOpts = { ...p.defaults };
      save(); renderPanel();
      $('#x-mode').focus();
      const label = exp.xModes.find((m) => m.value === es.xMode).label;
      toast(`x ekseni: ${label} — eksen başlıkları ve seçenekler güncellendi`);
    }
  });

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.id === 'add-row') addRow();
    else if (b.dataset.del !== undefined) deleteRow(+b.dataset.del);
    else if (b.id === 'clear-table') showClearConfirm(true);
    else if (b.id === 'clear-no') showClearConfirm(false);
    else if (b.id === 'clear-yes') clearTable();
    else if (b.id === 'dl-png') downloadPng();
    else if (b.id === 'copy-table') copyTable();
    else if (b.id === 'axes-reset') {
      const es = cs(), p = plotSpec();
      es.axes = { x: p.xTitle, y: p.yTitle };
      panel.querySelector('[data-axis="x"]').value = es.axes.x;
      panel.querySelector('[data-axis="y"]').value = es.axes.y;
      save(); refresh();
      toast('Eksen başlıkları varsayılana döndü');
    }
  });

  panel.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Escape' && !$('#clear-confirm').hidden) { showClearConfirm(false); return; }
    if (t.dataset.c === undefined) return;
    const r = +t.dataset.r, c = +t.dataset.c;
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (r + 1 >= cs().rows.length) {
        if (e.key === 'ArrowDown') return;
        cs().rows.push(emptyRow(cur()));
        save(); renderRows(); refresh();
      }
      focusCell(r + 1, c);
    } else if (e.key === 'ArrowUp' && r > 0) {
      e.preventDefault();
      focusCell(r - 1, c);
    }
  });

  panel.addEventListener('paste', onPaste);

  // Satır yazılırken "eksik" uyarısı göstermemek için odaktaki satırı izle
  panel.addEventListener('focusin', (e) => {
    const r = e.target.dataset && e.target.dataset.r !== undefined ? +e.target.dataset.r : null;
    if (r !== activeRow) { activeRow = r; if (lastEval) applyValidation(cur(), lastEval); }
  });
  panel.addEventListener('focusout', () => {
    setTimeout(() => {
      const a = document.activeElement;
      const r = a && a.dataset && a.dataset.r !== undefined ? +a.dataset.r : null;
      if (r !== activeRow) { activeRow = r; if (lastEval && document.getElementById('rows')) applyValidation(cur(), lastEval); }
    }, 0);
  });

  function selectTab(id, focus) {
    if (!EXP[id]) return;
    if (id !== state.active) {
      state.active = id;
      activeRow = null;
      save(); renderTabs(); renderPanel();
    }
    if (focus) document.getElementById(`tab-${id}`).focus();
  }

  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) selectTab(b.dataset.id);
  });
  tabsEl.addEventListener('keydown', (e) => {
    const ids = EXPERIMENTS.map((x) => x.id);
    const i = ids.indexOf(state.active);
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % ids.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = ids.length - 1;
    if (n === null) return;
    e.preventDefault();
    selectTab(ids[n], true);
  });

  document.getElementById('toast').addEventListener('mouseenter', () => clearTimeout(toastTimer));
  document.getElementById('toast').addEventListener('mouseleave', () => { toastTimer = setTimeout(hideToast, 2000); });

  /* =========================================================
     Başlat
     ========================================================= */
  showStorageNote();
  renderTabs();
  renderPanel();
})();
