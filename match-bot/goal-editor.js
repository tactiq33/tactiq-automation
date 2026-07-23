/* محرّك المحرّر البصريّ لخريطة الهدف */
var L = 40, R = 1040, T = 150, B = 1160;
function px(x) { return L + (x / 100) * (R - L); }
function py(y) { return B - (y / 100) * (B - T); }
function xInv(cx) { return ((cx - L) / (R - L)) * 100; }
function yInv(cy) { return ((B - cy) / (B - T)) * 100; }
var NS = 'http://www.w3.org/2000/svg';
var svg = document.getElementById('svg');
function el(t, a) { var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); return e; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var state = { players: [], steps: [], nextId: 1 };
var mode = null, pending = null; // pending = نقطة البداية {x,y}

function homeColor() { return document.getElementById('cHome').value; }
function awayColor() { return document.getElementById('cAway').value; }
function setMode(m) { mode = m; document.getElementById('mode').textContent = m ? ('الوضع: اضغط ' + (pending ? 'نقطة النهاية' : 'نقطة البداية') + ' (' + m + ')') : ''; }

// ===== رسم الملعب =====
function drawPitch(layer) {
  layer.appendChild(el('rect', { x: L, y: T, width: R - L, height: B - T, rx: 12, fill: '#123d24', stroke: 'rgba(255,255,255,0.45)', 'stroke-width': 3 }));
  layer.appendChild(el('line', { x1: L, y1: (T + B) / 2, x2: R, y2: (T + B) / 2, stroke: 'rgba(255,255,255,0.3)', 'stroke-width': 2 }));
  layer.appendChild(el('circle', { cx: (L + R) / 2, cy: (T + B) / 2, r: 85, fill: 'none', stroke: 'rgba(255,255,255,0.3)', 'stroke-width': 2 }));
  var bw = 420, bh = 150;
  layer.appendChild(el('rect', { x: (L + R) / 2 - bw / 2, y: T, width: bw, height: bh, fill: 'none', stroke: 'rgba(255,255,255,0.3)', 'stroke-width': 2 }));
  var gW = 150;
  layer.appendChild(el('rect', { x: (L + R) / 2 - gW / 2, y: T - 26, width: gW, height: 26, fill: 'rgba(255,255,255,0.12)', stroke: '#fff', 'stroke-width': 4 }));
  // ختم TACTIQ الحصريّ بزاوية أسفل الملعب اليمين (موقع محسوب + محاذاة نهاية)
  var wm = el('text', { x: R - 22, y: B - 26, 'font-family': 'Brink', 'font-size': 32 });
  wm.style.textAnchor = 'end';
  wm.setAttribute('text-anchor', 'end');
  var a = document.createElementNS(NS, 'tspan'); a.setAttribute('fill', '#eaf3ee'); a.textContent = 'TACT';
  var b = document.createElementNS(NS, 'tspan'); b.setAttribute('fill', '#25C971'); b.textContent = 'IQ';
  wm.appendChild(a); wm.appendChild(b); layer.appendChild(wm);
  // ضبط دقيق بعد معرفة عرض النصّ (يضمن الالتصاق بالزاوية مهما كان الخطّ)
  try {
    var w = wm.getComputedTextLength ? wm.getComputedTextLength() : 0;
    if (w) { wm.removeAttribute('text-anchor'); wm.style.textAnchor = 'start'; wm.setAttribute('x', R - 22 - w); }
  } catch (e) {}
}

function render() {
  svg.innerHTML = '';
  var base = el('g', {}); svg.appendChild(base); drawPitch(base);
  var arrowL = el('g', {}); svg.appendChild(arrowL);
  var playerL = el('g', {}); svg.appendChild(playerL);

  // أسهم (ثابتة بالتحرير)
  state.steps.forEach(function (s, i) {
    var color = s.type === 'shot' ? '#fff' : s.type === 'run' ? '#25C971' : '#F0A23C';
    var ln = el('line', { x1: px(s.from[0]), y1: py(s.from[1]), x2: px(s.to[0]), y2: py(s.to[1]), stroke: color, 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.9 });
    if (s.type === 'run') ln.setAttribute('stroke-dasharray', '14,10');
    arrowL.appendChild(ln);
    var mx = (px(s.from[0]) + px(s.to[0])) / 2, my = (py(s.from[1]) + py(s.to[1])) / 2;
    var num = el('circle', { cx: mx, cy: my, r: 15, fill: color });
    arrowL.appendChild(num);
    var nt = el('text', { x: mx, y: my + 6, fill: '#0a1420', 'font-size': 18, 'font-weight': 800, 'text-anchor': 'middle' }); nt.textContent = (i + 1); arrowL.appendChild(nt);
  });

  // لاعبين (قابلين للسحب)
  state.players.forEach(function (p) {
    var c = p.t === 'home' ? homeColor() : awayColor();
    var cx = px(p.x), cy = py(p.y);
    var circ = el('circle', { cx: cx, cy: cy, r: 25, fill: c, stroke: '#0a1420', 'stroke-width': 3, class: 'pl' });
    circ.dataset.id = p.id;
    playerL.appendChild(circ);
    var tx = el('text', { x: cx, y: cy + 8, fill: p.t === 'home' ? '#fff' : '#0a1420', 'font-size': 25, 'font-weight': 800, 'text-anchor': 'middle', 'pointer-events': 'none' }); tx.textContent = p.n; playerL.appendChild(tx);
    circ.addEventListener('dblclick', function () { var n = prompt('رقم اللاعب:', p.n); if (n != null) { p.n = n; render(); } });
  });
  renderSteps();
  updateOut();
}

function renderSteps() {
  var box = document.getElementById('stepsList'); box.innerHTML = '';
  state.steps.forEach(function (s, i) {
    var d = document.createElement('div'); d.className = 'stepItem';
    d.innerHTML = '<b>' + (i + 1) + '.</b> ' + (s.type) + ' — ' + (s.label || '') + (s.annotation ? ' 🟠' + s.annotation : '') + '<span class="x">✕</span>';
    d.querySelector('.x').onclick = function () { state.steps.splice(i, 1); render(); };
    box.appendChild(d);
  });
}

// ===== تفاعلات =====
function addPlayer(t) {
  var n = prompt('رقم اللاعب:', '');
  if (n === null) return;
  state.players.push({ id: state.nextId++, x: 50, y: t === 'home' ? 40 : 55, n: n || '', t: t });
  render();
}
function startStep(type) { setMode(type); pending = null; setMode(type); }

var dragging = null;
svg.addEventListener('mousedown', function (e) {
  if (e.target.classList && e.target.classList.contains('pl') && !mode) {
    dragging = state.players.find(function (p) { return p.id == e.target.dataset.id; });
  }
});
window.addEventListener('mousemove', function (e) {
  if (!dragging) return;
  var pt = toPitch(e);
  dragging.x = Math.max(0, Math.min(100, pt.x)); dragging.y = Math.max(0, Math.min(100, pt.y));
  render();
});
window.addEventListener('mouseup', function () { dragging = null; });

svg.addEventListener('click', function (e) {
  if (!mode) return;
  var pt = toPitch(e);
  // لو ضغط على لاعب، استعمل موقعه
  if (e.target.classList && e.target.classList.contains('pl')) {
    var p = state.players.find(function (pp) { return pp.id == e.target.dataset.id; });
    pt = { x: p.x, y: p.y };
  }
  if (!pending) { pending = { x: round(pt.x), y: round(pt.y) }; setMode(mode); }
  else {
    var end = { x: round(pt.x), y: round(pt.y) };
    var label = prompt('وصف الخطوة (مثلاً: line-break pass):', mode === 'shot' ? '1v1 finish' : 'pass');
    var ann = prompt('شرح بارز؟ (اختياريّ، مثلاً PRESS BEATEN — اتركه فاضي لو ما بدّك):', '');
    state.steps.push({ from: [pending.x, pending.y], to: [end.x, end.y], type: mode, label: label || '', annotation: ann || undefined });
    pending = null; mode = null; setMode(null); render();
  }
});

function toPitch(e) {
  var r = svg.getBoundingClientRect();
  var sx = (e.clientX - r.left) / r.width * 1080;
  var sy = (e.clientY - r.top) / r.height * 1350;
  return { x: xInv(sx), y: yInv(sy) };
}
function round(v) { return Math.round(v * 10) / 10; }

// ===== المخرجات =====
function buildPlay() {
  return {
    title: document.getElementById('fTitle').value,
    sub: document.getElementById('fSub').value,
    homeColor: homeColor(), awayColor: awayColor(),
    players: state.players.map(function (p) { return { x: p.x, y: p.y, n: p.n, t: p.t }; }),
    steps: state.steps,
    caption: document.getElementById('fCap').value
  };
}
function updateOut() { document.getElementById('out').value = JSON.stringify(buildPlay(), null, 2); }
function exportJSON() { updateOut(); document.getElementById('out').select(); document.execCommand('copy'); alert('اننسخ الـJSON! الصقه بملف play.json وشغّل: node gen-play.js play.json'); }
function downloadJSON() {
  var blob = new Blob([JSON.stringify(buildPlay(), null, 2)], { type: 'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'play.json'; a.click();
}
function resetAll() { if (confirm('تفريغ كل شي؟')) { state = { players: [], steps: [], nextId: 1 }; render(); } }

// ===== معاينة متحركة =====
var animating = false;
async function preview() {
  if (animating || state.steps.length === 0) return; animating = true;
  var arrowL = el('g', {}); var ball = el('circle', { r: 13, fill: '#fff', stroke: '#0a1420', 'stroke-width': 3 });
  render(); svg.appendChild(arrowL); svg.appendChild(ball);
  var s0 = state.steps[0]; ball.setAttribute('cx', px(s0.from[0])); ball.setAttribute('cy', py(s0.from[1]));
  for (var i = 0; i < state.steps.length; i++) {
    var s = state.steps[i];
    var color = s.type === 'shot' ? '#fff' : s.type === 'run' ? '#25C971' : '#F0A23C';
    var ln = el('line', { x1: px(s.from[0]), y1: py(s.from[1]), x2: px(s.to[0]), y2: py(s.to[1]), stroke: color, 'stroke-width': 6, 'stroke-linecap': 'round' });
    var len = Math.hypot(px(s.to[0]) - px(s.from[0]), py(s.to[1]) - py(s.from[1]));
    if (s.type !== 'run') { ln.style.strokeDasharray = len; ln.style.strokeDashoffset = len; ln.style.transition = 'stroke-dashoffset .6s'; }
    else ln.setAttribute('stroke-dasharray', '14,10');
    arrowL.appendChild(ln); await sleep(20); if (s.type !== 'run') ln.style.strokeDashoffset = 0;
    ball.style.transition = 'cx .7s, cy .7s'; ball.setAttribute('cx', px(s.to[0])); ball.setAttribute('cy', py(s.to[1]));
    await sleep(850);
  }
  animating = false;
}

// init
document.getElementById('cHome').addEventListener('input', render);
document.getElementById('cAway').addEventListener('input', render);
['fTitle', 'fSub', 'fCap'].forEach(function (id) { document.getElementById(id).addEventListener('input', updateOut); });
// بيانات بداية تجريبيّة
state.players = [
  { id: 1, x: 20, y: 25, n: '5', t: 'home' }, { id: 2, x: 40, y: 45, n: '9', t: 'home' },
  { id: 3, x: 65, y: 65, n: '19', t: 'home' }, { id: 4, x: 82, y: 85, n: '21', t: 'home' },
  { id: 5, x: 55, y: 55, n: '6', t: 'away' }
];
state.nextId = 6;
render();
if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function () { render(); }); }
