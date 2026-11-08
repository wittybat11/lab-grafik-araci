'use strict';

/* =========================================================
   Ortak hesap yardımcıları: sayı okuma, doğrusal fit, biçimlendirme
   ========================================================= */
const Lab = (() => {
  const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

  /** Hücre metnini sayıya çevirir. Nokta ve virgül ondalık ayırıcı olarak kabul edilir. */
  function parseNum(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/−/g, '-').replace(/\s+/g, '');
    if (s === '') return { empty: true };
    if ((s.match(/,/g) || []).length === 1 && !s.includes('.')) s = s.replace(',', '.');
    if (!NUM_RE.test(s)) return { error: true };
    const v = Number(s);
    return Number.isFinite(v) ? { value: v } : { error: true };
  }

  /** En küçük kareler: y = kx + b. */
  function linFit(xs, ys) {
    const n = xs.length;
    if (n < 2) return { ok: false, n, reason: 'few' };
    let Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
    for (let i = 0; i < n; i++) {
      Sx += xs[i]; Sy += ys[i]; Sxx += xs[i] * xs[i]; Sxy += xs[i] * ys[i];
    }
    const D = n * Sxx - Sx * Sx;
    if (!(Math.abs(D) > 1e-14 * Math.max(1e-300, n * Sxx))) return { ok: false, n, reason: 'samex' };
    const k = (n * Sxy - Sx * Sy) / D;
    let b = (Sy - k * Sx) / n;
    // Kayan nokta artıklarını temizle (ör. tam doğrusal veride 1e-17 gibi kesişimler)
    const yScale = Math.max(...ys.map(Math.abs)) || 1;
    if (Math.abs(b) < 1e-12 * yScale) b = 0;
    const ym = Sy / n;
    let ssr = 0, sst = 0;
    for (let i = 0; i < n; i++) {
      const r = ys[i] - (k * xs[i] + b);
      ssr += r * r;
      sst += (ys[i] - ym) * (ys[i] - ym);
    }
    if (ssr < 1e-24 * yScale * yScale * n) ssr = 0;
    const r2 = sst > 0 ? 1 - ssr / sst : null;
    let dk = null, db = null;
    if (n > 2) {
      const s2 = ssr / (n - 2);
      dk = Math.sqrt(n * s2 / D);
      db = Math.sqrt(s2 * Sxx / D);
    }
    return { ok: true, n, k, b, dk, db, r2 };
  }

  function fixed(v, d) {
    const s = v.toFixed(Math.max(0, Math.min(15, d)));
    return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
  }

  /** Belirsizlik olmadan kısa gösterim (4 anlamlı basamak). */
  function auto(v, sig = 4) {
    if (!Number.isFinite(v)) return '—';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e-4 && a < 1e7) return String(Number(v.toPrecision(sig)));
    return v.toExponential(sig - 1);
  }

  /** Değer ± belirsizlik: belirsizlik 2 anlamlı basamak, değer aynı ondalık basamakta. */
  function pm(v, u) {
    if (u == null || !Number.isFinite(u)) return auto(v);
    if (u === 0 || u <= Math.abs(v) * 1e-9) return `${fixed(v, 3)} ± 0`;
    const ur = Number(u.toPrecision(2));
    const dec = 1 - Math.floor(Math.log10(ur));
    if (dec >= 0) return `${fixed(v, dec)} ± ${fixed(ur, dec)}`;
    const f = Math.pow(10, -dec);
    return `${fixed(Math.round(v / f) * f, 0)} ± ${fixed(Math.round(ur / f) * f, 0)}`;
  }

  /** Ekranda gösterim için tire yerine eksi işareti. */
  const minus = (s) => String(s).replace(/(^|[\s(=])-(?=\d)/g, '$1−');

  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
    a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ' };
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '−': '⁻', '-': '⁻' };
  const mapAll = (s, tbl) => ([...s].every((c) => tbl[c]) ? [...s].map((c) => tbl[c]).join('') : null);

  /** HTML etiketini düz metne çevirir (pano ve hata mesajları için). */
  function text(html) {
    return String(html)
      .replace(/<sub>(.*?)<\/sub>/g, (_, s) => mapAll(s, SUB) || `_${s}`)
      .replace(/<sup>(.*?)<\/sup>/g, (_, s) => mapAll(s, SUP) || `^${s}`)
      .replace(/<[^>]+>/g, '');
  }

  return { parseNum, linFit, fixed, auto, pm, minus, text };
})();

/* =========================================================
   Deney tanımları
   ========================================================= */
const G = 9.8;           // föydeki değer
const G_ACCEPTED = 9.81; // Deney 4 karşılaştırması

const chk = {
  pos: (v) => (v > 0 ? null : "0'dan büyük olmalı"),
  time: (v) => (v > 0 ? null : 'süre pozitif olmalı'),
  nonneg: (v) => (v >= 0 ? null : 'negatif olamaz'),
  any: () => null,
};

const col = (key, html, unit, check, extra = {}) => ({ key, html, unit, check, ...extra });
const out = (key, html, unit, dec = 3) => ({ key, html, unit, dec });
const cst = (key, html, unit, def, check = chk.pos) => ({ key, html, unit, def, check });

const f = Lab.fixed;
const pm = (v, u) => Lab.minus(Lab.pm(v, u));

/* ---------- Deney 3 ortak tanımı ---------- */
const MEMORY_OPT = {
  key: 'memory',
  label: 't<sub>2</sub> sütununa hafıza okumasını (t<sub>1</sub> + t<sub>2</sub>) giriyorum',
  hint: 'Zamanlayıcı MEMORY modunda ikinci okuma olarak t<sub>1</sub> + t<sub>2</sub> gösterir. İşaretliyse t<sub>2</sub> = okuma − t<sub>1</sub> hesaplanır.',
  def: true,
};

function d3Calc(v, ctx) {
  const L = ctx.c.L / 100, dt = ctx.c.dt, mem = ctx.opts.memory;
  const t2p = mem ? v.t2 - v.t1 : v.t2;
  if (!(t2p > 0)) return { cellErr: { t2: 'hafıza okuması (t₁ + t₂) t₁’den büyük olmalı' } };
  const v1 = L / v.t1, v2 = L / t2p;
  const a = (v2 - v1) / v.t3;
  const Fa = (v.ma / 1000) * G;
  const mt = (v.m + v.ma) / 1000;
  const ath = Fa / mt;
  const err = Math.abs(ath - a) / ath * 100;
  const dv1 = v1 * dt / v.t1;
  const dt2 = mem ? Math.SQRT2 * dt : dt;
  const dv2 = v2 * dt2 / t2p;
  // δa = |a|·√[(δv₁²+δv₂²)/(v₂−v₁)² + (δt/t₃)²]; |a|/|v₂−v₁| = 1/t₃ olduğundan v₁ = v₂ durumunda da tanımlı yazılır.
  const da = Math.sqrt((dv1 * dv1 + dv2 * dv2) / (v.t3 * v.t3) + Math.pow(a * dt / v.t3, 2));
  return { values: { m: v.m, ma: v.ma, t2p, v1, v2, a, da, Fa, ath, err, mt, invm: 1 / mt } };
}

const D3_BASE = {
  constants: [
    cst('L', 'Bayrak uzunluğu L', 'cm', 10),
    cst('dt', 'Zaman belirsizliği δt', 's', 0.001, chk.nonneg),
  ],
  options: [MEMORY_OPT],
  columns: [
    col('m', 'm', 'g', chk.pos),
    col('ma', 'm<sub>a</sub>', 'g', chk.pos),
    col('t1', 't<sub>1</sub>', 's', chk.time),
    col('t2', 't<sub>2</sub>', 's', chk.time),
    col('t3', 't<sub>3</sub>', 's', chk.time),
  ],
  rows: 4,
  calc: d3Calc,
  // Rapordaki Table 3.1 düzeni: 3a satırları, ardından 3b satırları
  report: {
    label: 'Föy tablosu 3.1 (3a + 3b satırları birlikte)',
    sources: ['d3a', 'd3b'],
    cols: [
      { html: 'Row', unit: '', row: true },
      { html: 'm', unit: 'g', raw: 'm' },
      { html: 'm<sub>a</sub>', unit: 'g', raw: 'ma' },
      { html: 't<sub>1</sub>', unit: 's', raw: 't1' },
      { html: 't<sub>2</sub>', unit: 's', key: 't2p', dec: 3 },
      { html: 't<sub>3</sub>', unit: 's', raw: 't3' },
      { html: 'v<sub>1</sub>', unit: 'm/s', key: 'v1', dec: 3 },
      { html: 'v<sub>2</sub>', unit: 'm/s', key: 'v2', dec: 3 },
      { html: 'a', unit: 'm/s²', key: 'a', dec: 3 },
      { html: 'F<sub>a</sub>', unit: 'N', key: 'Fa', dec: 3 },
      { html: 'Error', unit: '%', key: 'err', dec: 1 },
    ],
  },
  outputs: [
    out('t2p', 't<sub>2</sub>', 's'),
    out('v1', 'v<sub>1</sub>', 'm/s'),
    out('v2', 'v<sub>2</sub>', 'm/s'),
    out('a', 'a', 'm/s²'),
    out('da', 'δa', 'm/s²'),
    out('Fa', 'F<sub>a</sub>', 'N'),
    out('ath', 'a<sub>th</sub>', 'm/s²'),
    out('err', 'Hata', '%', 1),
  ],
};

const spread = (vals) => Math.max(...vals) - Math.min(...vals);

const EXPERIMENTS = [
  /* ---------------- Deney 2 ---------------- */
  {
    id: 'd2',
    tab: 'Deney 2', tabSub: 'v<sub>avg</sub> – D',
    title: 'Deney 2 — Instantaneous vs Average Velocity',
    note: 'Föy: v<sub>avg</sub> – D grafiği, D yatay eksende. Fit doğrusunun D = 0 kesişimi anlık hızın tahminidir. Her D için en fazla üç süre girin; boş bırakılan ölçüm ortalamaya katılmaz.',
    constants: [],
    options: [],
    columns: [
      col('D', 'D', 'cm', chk.pos),
      col('t1', 't<sub>1</sub>', 's', chk.time, { optional: true }),
      col('t2', 't<sub>2</sub>', 's', chk.time, { optional: true }),
      col('t3', 't<sub>3</sub>', 's', chk.time, { optional: true }),
    ],
    requireAny: { keys: ['t1', 't2', 't3'], label: 'en az bir süre' },
    rows: 8,
    calc(v) {
      const ts = [v.t1, v.t2, v.t3].filter((t) => t !== null);
      const tavg = ts.reduce((s, t) => s + t, 0) / ts.length;
      const D = v.D / 100;
      const vavg = D / tavg;
      const dt = ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / 2 : 0;
      return { values: { D, tavg, vavg, dv: vavg * dt / tavg } };
    },
    outputs: [
      out('D', 'D', 'm'),
      out('tavg', 't<sub>avg</sub>', 's'),
      out('vavg', 'v<sub>avg</sub>', 'm/s'),
      out('dv', 'δv', 'm/s'),
    ],
    plot: () => ({
      x: 'D', y: 'vavg', err: 'dv',
      xTitle: 'Photogate separation D (m)',
      yTitle: 'Average velocity v<sub>avg</sub> (m/s)',
      fromOrigin: true,
      defaults: { fit: true, err: true, theory: false, connect: false },
      theory: null,
      file: 'deney2_vavg-D',
      kUnit: 's⁻¹', bUnit: 'm/s',
      interpret(fit) {
        if (!fit || !fit.ok) return [];
        return [`D = 0'daki kesişim (anlık hız tahmini): <b>v<sub>inst</sub> = ${pm(fit.b, fit.db)} m/s</b>`];
      },
    }),
  },

  /* ---------------- Deney 3a ---------------- */
  {
    ...D3_BASE,
    id: 'd3a',
    tab: 'Deney 3a', tabSub: 'a – F<sub>a</sub>',
    title: "Deney 3a — Newton's Second Law: a – F<sub>a</sub>",
    note: 'Föy madde 4: toplam kütle m + m<sub>a</sub> sabit tutulur, asılı kütle m<sub>a</sub> değiştirilir. Grafik a – F<sub>a</sub>; eğim 1/(m + m<sub>a</sub>) olmalıdır.',
    plot: () => ({
      x: 'Fa', y: 'a', err: 'da',
      xTitle: 'Applied force F<sub>a</sub> (N)',
      yTitle: 'Average acceleration a (m/s<sup>2</sup>)',
      fromOrigin: true,
      defaults: { fit: true, err: true, theory: true, connect: false },
      theory: (valid, [x0, x1]) => {
        const mt = valid[0].mt;
        return { x: [x0, x1], y: [x0 / mt, x1 / mt] };
      },
      file: 'deney3_a-Fa',
      kUnit: 'kg⁻¹', bUnit: 'm/s²',
      interpret(fit, valid) {
        const mt = valid[0].mt, kth = 1 / mt;
        const L = [`Teorik eğim 1/m<sub>toplam</sub> = 1/(${f(mt, 3)} kg) = <b>${f(kth, 2)} kg⁻¹</b> <span class="muted">(m<sub>toplam</sub> ilk geçerli satırdan)</span>`];
        if (fit && fit.ok) {
          L.push(`Ölçülen eğim: <b>${pm(fit.k, fit.dk)} kg⁻¹</b> — teorik eğimden fark <b>%${f(Math.abs(fit.k - kth) / kth * 100, 1)}</b>`);
          L.push(`Kesişim: ${pm(fit.b, fit.db)} m/s² (ideal durumda 0)`);
        }
        if (spread(valid.map((r) => r.mt)) > 0.0005) {
          L.push({ warn: true, html: 'm + m<sub>a</sub> satırlar arasında sabit değil; bu grafikte toplam kütle sabit tutulmalı.' });
        }
        return L;
      },
    }),
  },

  /* ---------------- Deney 3b ---------------- */
  {
    ...D3_BASE,
    id: 'd3b',
    tab: 'Deney 3b', tabSub: 'a – m',
    title: "Deney 3b — Newton's Second Law: a – m",
    note: 'Föy madde 5: asılı kütle m<sub>a</sub> sabit, kızak kütlesi m değiştirilir. a – m ilişkisi eğridir; x ekseni 1/(m + m<sub>a</sub>) seçilince doğrusal olur ve eğim F<sub>a</sub>’yı verir.',
    xModes: [
      { value: 'm', label: 'm (g)' },
      { value: 'inv', label: '1/(m + mₐ) (kg⁻¹)' },
    ],
    plot(mode) {
      const Fa0 = (valid) => valid[0].Fa;
      const maWarn = (valid) => (spread(valid.map((r) => r.ma)) > 1e-9
        ? [{ warn: true, html: 'm<sub>a</sub> satırlar arasında sabit değil; bu grafikte asılı kütle sabit tutulmalı.' }] : []);
      if (mode === 'inv') {
        return {
          x: 'invm', y: 'a', err: 'da',
          xTitle: '1/(m + m<sub>a</sub>) (kg<sup>−1</sup>)',
          yTitle: 'Average acceleration a (m/s<sup>2</sup>)',
          fromOrigin: true,
          defaults: { fit: true, err: true, theory: true, connect: false },
          theory: (valid, [x0, x1]) => ({ x: [x0, x1], y: [Fa0(valid) * x0, Fa0(valid) * x1] }),
          file: 'deney3_a-inv_m',
          kUnit: 'N', bUnit: 'm/s²',
          interpret(fit, valid) {
            const Fa = Fa0(valid);
            const L = [`Beklenen eğim F<sub>a</sub> = m<sub>a</sub>g = <b>${f(Fa, 3)} N</b>`];
            if (fit && fit.ok) {
              L.push(`Ölçülen eğim: <b>${pm(fit.k, fit.dk)} N</b> — beklenen eğimden fark <b>%${f(Math.abs(fit.k - Fa) / Fa * 100, 1)}</b>`);
              L.push(`Kesişim: ${pm(fit.b, fit.db)} m/s² (ideal durumda 0)`);
            }
            return L.concat(maWarn(valid));
          },
        };
      }
      return {
        x: 'm', y: 'a', err: 'da',
        xTitle: 'Glider mass m (g)',
        yTitle: 'Average acceleration a (m/s<sup>2</sup>)',
        fromOrigin: false,
        defaults: { fit: false, err: true, theory: true, connect: true },
        theory: (valid, [x0, x1]) => {
          const ma = valid[0].ma, Fa = Fa0(valid);
          const lo = Math.max(x0, -ma + 1e-6), xs = [], ys = [];
          for (let i = 0; i <= 80; i++) {
            const x = lo + (x1 - lo) * i / 80;
            xs.push(x); ys.push(Fa / ((x + ma) / 1000));
          }
          return { x: xs, y: ys };
        },
        file: 'deney3_a-m',
        kUnit: 'm/(s²·g)', bUnit: 'm/s²',
        interpret(fit, valid) {
          return [
            `Teori eğrisi: a = F<sub>a</sub> / (m + m<sub>a</sub>), F<sub>a</sub> = <b>${f(Fa0(valid), 3)} N</b>`,
            'a – m ilişkisi doğrusal değildir. Eğimden F<sub>a</sub> bulmak için x eksenini <b>1/(m + m<sub>a</sub>)</b> seçin.',
          ].concat(maWarn(valid));
        },
      };
    },
  },

  /* ---------------- Deney 4 ---------------- */
  {
    id: 'd4',
    tab: 'Deney 4', tabSub: 'F<sub>g</sub> – m',
    title: 'Deney 4 — The Force of Gravity',
    note: 'Föy: F<sub>g</sub> – m grafiği, m yatay eksende; eğim g’yi verir. Föyde kütleler 190–240 g. Aynı kütle için birden fazla satır girebilirsiniz.',
    constants: [
      cst('d', 'Ayaklar arası d', 'cm', 100),
      cst('h', 'Blok kalınlığı h', 'cm', 1),
      cst('D', 'Kapılar arası D', 'cm', 50),
      cst('L', 'Bayrak uzunluğu L', 'cm', 10),
    ],
    options: [MEMORY_OPT],
    columns: [
      col('m', 'm', 'g', chk.pos),
      col('t1', 't<sub>1</sub>', 's', chk.time),
      col('t2', 't<sub>2</sub>', 's', chk.time),
    ],
    rows: 6,
    calc(v, ctx) {
      const { d, h, D, L } = ctx.c;
      const t2p = ctx.opts.memory ? v.t2 - v.t1 : v.t2;
      if (!(t2p > 0)) return { cellErr: { t2: 'hafıza okuması (t₁ + t₂) t₁’den büyük olmalı' } };
      const theta = Math.atan(h / d);
      const v1 = (L / 100) / v.t1, v2 = (L / 100) / t2p;
      const a = (v2 * v2 - v1 * v1) / (2 * D / 100);
      const mkg = v.m / 1000;
      const F = mkg * a;
      return { values: { mkg, t2p, v1, v2, a, F, Fg: F / Math.sin(theta) } };
    },
    outputs: [
      out('t2p', 't<sub>2</sub>', 's'),
      out('v1', 'v<sub>1</sub>', 'm/s'),
      out('v2', 'v<sub>2</sub>', 'm/s'),
      out('a', 'a', 'm/s²'),
      out('F', 'F', 'N', 4),
      out('Fg', 'F<sub>g</sub>', 'N'),
    ],
    plot: () => ({
      x: 'mkg', y: 'Fg', err: null,
      xTitle: 'Glider mass m (kg)',
      yTitle: 'Gravitational force F<sub>g</sub> (N)',
      fromOrigin: true,
      defaults: { fit: true, err: false, theory: true, connect: false },
      theory: (valid, [x0, x1]) => ({ x: [x0, x1], y: [G_ACCEPTED * x0, G_ACCEPTED * x1] }),
      file: 'deney4_Fg-m',
      kUnit: 'm/s²', bUnit: 'N',
      interpret(fit, valid, ctx) {
        const theta = Math.atan(ctx.c.h / ctx.c.d) * 180 / Math.PI;
        const L = [`Eğim açısı θ = arctan(h/d) = <b>${f(theta, 3)}°</b>`];
        if (fit && fit.ok) {
          L.push(`g = eğim = <b>${pm(fit.k, fit.dk)} m/s²</b> — kabul edilen 9.81 m/s²’den fark <b>%${f(Math.abs(fit.k - G_ACCEPTED) / G_ACCEPTED * 100, 1)}</b>`);
          L.push(`Kesişim: ${pm(fit.b, fit.db)} N (ideal durumda 0)`);
        }
        return L;
      },
    }),
  },

  /* ---------------- Deney 5 ---------------- */
  {
    id: 'd5',
    tab: 'Deney 5', tabSub: 'F – x',
    title: 'Deney 5 — Elastic-Kinetic Energy (yay sabiti)',
    note: 'Föy: F = mg – x grafiği, uzama x yatay eksende. Eğim yay sabiti k’yı (N/m) verir.',
    constants: [],
    options: [],
    columns: [
      col('mass', 'Asılı kütle', 'g', chk.nonneg),
      col('x', 'Uzama x', 'cm', chk.nonneg),
    ],
    rows: 5,
    calc: (v) => ({ values: { F: (v.mass / 1000) * G, xm: v.x / 100 } }),
    outputs: [out('F', 'F', 'N'), out('xm', 'x', 'm')],
    plot: () => ({
      x: 'xm', y: 'F', err: null,
      xTitle: 'Spring stretch x (m)',
      yTitle: 'Applied force F = mg (N)',
      fromOrigin: true,
      defaults: { fit: true, err: false, theory: false, connect: false },
      theory: null,
      file: 'deney5_F-x',
      kUnit: 'N/m', bUnit: 'N',
      interpret(fit) {
        if (!fit || !fit.ok) return [];
        return [
          `Yay sabiti k = eğim = <b>${pm(fit.k, fit.dk)} N/m</b>`,
          `Kesişim: ${pm(fit.b, fit.db)} N (ideal durumda 0)`,
        ];
      },
    }),
  },

  /* ---------------- Serbest grafik ---------------- */
  {
    id: 'free',
    tab: 'Serbest grafik', tabSub: '',
    title: 'Serbest grafik',
    note: 'Herhangi bir x – y verisini çizin. δy isteğe bağlıdır; girilirse hata çubuğu olarak gösterilir. Hesap yapılmaz.',
    constants: [],
    options: [],
    columns: [
      col('x', 'x', '', chk.any),
      col('y', 'y', '', chk.any),
      col('dy', 'δy', '', chk.nonneg, { optional: true }),
    ],
    rows: 6,
    calc: (v) => ({ values: { x: v.x, y: v.y, dy: v.dy } }),
    outputs: [out('x', 'x', '', null), out('y', 'y', '', null), out('dy', 'δy', '', null)],
    plot: () => ({
      x: 'x', y: 'y', err: 'dy',
      xTitle: 'x',
      yTitle: 'y',
      fromOrigin: false,
      defaults: { fit: true, err: true, theory: false, connect: false },
      theory: null,
      file: 'serbest_grafik',
      kUnit: '', bUnit: '',
      interpret: () => [],
    }),
  },
];
