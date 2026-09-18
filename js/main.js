/* ============================================================
   main.js  … 画面のつなぎ役
   第1段階：写真をえらぶ → タップで切り抜く → ぴょこぴょこループ → さわっても止まらない
   ============================================================ */

import { loadSegmenter, segmentAt } from './segmenter.js';
import { loadPhotoToCanvas, maskFromLabels, paintCircle, buildCutout, buildFaceCrop } from './cutout.js';
import { createPlayer } from './player.js';
import { MOTIONS, motionsForPart } from './motions.js';
import { TRAVELS } from './travel.js';

const STORE_KEY = 'dogAnim.play.v2';
const FAV_KEY   = 'dogAnim.favs.v1';
const FAV_MAX   = 6;
const OLD_KEY = 'dogAnim.cutout.v1';
const $ = (id) => document.getElementById(id);

/* ---------- 状態 ---------- */
const state = {
  photo: null,      // 写真の canvas
  mask: null,       // Uint8Array（0 か 255）
  mw: 0, mh: 0,
  cutout: null,     // 切り抜き後の canvas / img（全身）
  part: 'body',     // body（ぜんしん）/ face（かおだけ）/ chara（かおだけ＋イラストの体）
  spots: {},        // ゆらす場所 { tail:{x,y,r}, te:{x,y,r} }
  spotKey: null,    // いま えらんでいる場所の名前
  playAfterSpot: false,
  face: null,       // かおの丸 { cx, cy, r }（切り抜き画像の中の座標）
  playImage: null,  // じっさいに動かす絵
  mode: 'tap',      // tap | add | erase
  noAI: false,      // AIが読みこめなかったときは手ぬりだけで進める
  undo: [],
};

/* ---------- 部品 ---------- */
const photoCanvas   = $('photo-canvas');
const overlayCanvas = $('overlay-canvas');
const photoCtx      = photoCanvas.getContext('2d');
const overlayCtx    = overlayCanvas.getContext('2d');
const previewCanvas = $('preview-canvas');
const partCanvas    = $('part-canvas');
const faceCanvas    = $('face-canvas');
const faceOverlay   = $('face-overlay');
const faceOverlayCtx = faceOverlay.getContext('2d');
const spotCanvas    = $('spot-canvas');
const spotOverlay   = $('spot-overlay');
const spotOverlayCtx = spotOverlay.getContext('2d');

const player = createPlayer({
  root: $('player'),
  canvas: $('play-canvas'),
  exitBtn: $('exit-btn'),
  ring: $('exit-ring'),
  toast: $('play-toast'),
});

/* ---------- 画面きりかえ ---------- */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('is-active', s.id === id));
}
function alertBox(text) {
  $('alert-text').textContent = text;
  $('alert').hidden = false;
}
$('alert-ok').addEventListener('click', () => { $('alert').hidden = true; });

function spinner(on, text = 'よみこみ中…') {
  $('spinner-text').textContent = text;
  $('cut-spinner').hidden = !on;
}

/* ---------- 写真をえらぶ ---------- */
$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';                    // 同じ写真をもう一度えらべるように
  if (!file) return;

  showScreen('screen-cut');
  spinner(true, '写真をよみこみ中…');
  try {
    state.photo = await loadPhotoToCanvas(file, 1024);
    state.mw = state.photo.width;
    state.mh = state.photo.height;
    state.mask = new Uint8Array(state.mw * state.mh);
    state.undo = [];
    setMode('tap');
    layoutPhoto();
    drawPhoto();
    updateNextButton();
    $('cut-hint').textContent = 'うごかしたいものの まん中あたりを タップしてください。';
    spinner(true, 'AIの準備中…（はじめは10〜30秒ほどかかります）');
    await loadSegmenter();
    spinner(false);
  } catch (err) {
    spinner(false);
    console.error(err);
    fallbackToBrush('じどう切り抜きの準備ができませんでした（通信がとどいていないかもしれません）。「たす」の ふで で ぬれば 切り抜けます。');
  }
});

/** AIが使えないときは、ふで（手ぬり）モードに切りかえて そのまま遊べるようにする */
function fallbackToBrush(message) {
  state.noAI = true;
  setMode('add');
  $('cut-hint').textContent = 'うごかしたいものを 指で なぞって ぬってください。はみ出したら「けす」で直せます。';
  alertBox(message);
}

/* ---------- 画面の大きさあわせ（切り抜き画面と 顔まる画面で共通） ---------- */
function fitStage(stageId, wrapId, canvases, srcW, srcH) {
  const stage = $(stageId);
  const availW = stage.clientWidth  - 20;
  const availH = stage.clientHeight - 20;
  if (availW <= 0 || availH <= 0) return;
  const scale = Math.min(availW / srcW, availH / srcH);
  const w = Math.max(40, Math.round(srcW * scale));
  const h = Math.max(40, Math.round(srcH * scale));
  for (const c of canvases) {
    c.width = srcW; c.height = srcH;          // ここで中身は消えるので、呼んだ側で描きなおす
    c.style.width  = w + 'px';
    c.style.height = h + 'px';
  }
  $(wrapId).style.width  = w + 'px';
  $(wrapId).style.height = h + 'px';
}

function layoutPhoto() {
  if (!state.photo) return;
  fitStage('cut-stage', 'canvas-wrap', [photoCanvas, overlayCanvas], state.mw, state.mh);
}

function layoutFace() {
  if (!state.cutout) return;
  fitStage('face-stage', 'face-wrap', [faceCanvas, faceOverlay], state.cutout.width, state.cutout.height);
}

function layoutSpot() {
  const img = state.playImage;
  if (!img) return;
  fitStage('spot-stage', 'spot-wrap', [spotCanvas, spotOverlay], img.width, img.height);
}

window.addEventListener('resize', () => {
  if ($('screen-cut').classList.contains('is-active')) { layoutPhoto(); drawPhoto(); }
  if ($('screen-face').classList.contains('is-active')) { layoutFace(); drawFace(); }
  if ($('screen-spot').classList.contains('is-active')) { layoutSpot(); drawSpot(); }
});

/* ---------- 写真とマスクを描く ---------- */
function drawPhoto() {
  if (!state.photo) return;
  photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
  photoCtx.drawImage(state.photo, 0, 0);
  drawOverlay();
}

let maskImageData = null;
let maskCanvas = null;
let overlayPending = 0;

/** 指でなぞっている間も軽く動くよう、描きなおしは1フレームに1回にまとめる */
function drawOverlay() {
  if (overlayPending) return;
  overlayPending = requestAnimationFrame(() => { overlayPending = 0; renderOverlay(); });
}

function renderOverlay() {
  const { mw, mh, mask } = state;
  if (!mask) return;

  if (!maskCanvas || maskCanvas.width !== mw || maskCanvas.height !== mh) {
    maskCanvas = document.createElement('canvas');
    maskCanvas.width = mw; maskCanvas.height = mh;
    maskImageData = overlayCtx.createImageData(mw, mh);
    const d0 = maskImageData.data;
    for (let j = 0; j < d0.length; j += 4) { d0[j] = 255; d0[j + 1] = 255; d0[j + 2] = 255; }
  }
  const d = maskImageData.data;
  for (let i = 0, j = 3; i < mask.length; i++, j += 4) d[j] = mask[i];
  maskCanvas.getContext('2d').putImageData(maskImageData, 0, 0);

  overlayCtx.clearRect(0, 0, mw, mh);
  overlayCtx.fillStyle = 'rgba(20,10,20,.55)';
  overlayCtx.fillRect(0, 0, mw, mh);
  // えらんだ部分だけ、うすぐらい幕に穴をあける
  overlayCtx.globalCompositeOperation = 'destination-out';
  overlayCtx.drawImage(maskCanvas, 0, 0);
  overlayCtx.globalCompositeOperation = 'source-over';
}

/* ---------- 道具のきりかえ ---------- */
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tool[data-mode]').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === mode));
  $('cut-hint').textContent = {
    tap:   'うごかしたいものの まん中あたりを タップしてください。',
    add:   '足りないところを 指で なぞって ふやします。',
    erase: 'いらないところを 指で なぞって けします。',
  }[mode];
}
document.querySelectorAll('.tool[data-mode]').forEach((b) => {
  b.addEventListener('click', () => setMode(b.dataset.mode));
});

function pushUndo() {
  state.undo.push(state.mask.slice());
  if (state.undo.length > 12) state.undo.shift();
}
$('tool-undo').addEventListener('click', () => {
  const prev = state.undo.pop();
  if (!prev) return;
  state.mask = prev;
  drawOverlay();
  updateNextButton();
});

function updateNextButton() {
  const has = state.mask && state.mask.some((v) => v);
  $('btn-to-motion').disabled = !has;
}

/* ---------- 指の位置を写真の座標に ---------- */
function toPhotoXY(e) {
  const r = photoCanvas.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - r.left) / r.width  * state.mw),
    y: Math.round((e.clientY - r.top)  / r.height * state.mh),
    ratio: state.mw / r.width,
  };
}

/* ---------- タップして切り抜く／ふでで直す ---------- */
let drawing = false, lastPt = null;

overlayCanvas.addEventListener('pointerdown', async (e) => {
  if (!state.photo) return;
  e.preventDefault();
  const pt = toPhotoXY(e);
  if (pt.x < 0 || pt.y < 0 || pt.x >= state.mw || pt.y >= state.mh) return;

  if (state.mode === 'tap') {
    if (state.noAI) { setMode('add'); return; }
    await tapSegment(pt);
    return;
  }
  drawing = true;
  lastPt = pt;
  overlayCanvas.setPointerCapture(e.pointerId);
  pushUndo();
  brushAt(pt);
});

overlayCanvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  e.preventDefault();
  const pt = toPhotoXY(e);
  // 点と点の間をうめて、線がとぎれないようにする
  const steps = Math.ceil(Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y) / 4);
  for (let i = 1; i <= steps; i++) {
    brushAt({
      x: lastPt.x + (pt.x - lastPt.x) * i / steps,
      y: lastPt.y + (pt.y - lastPt.y) * i / steps,
      ratio: pt.ratio,
    }, false);
  }
  lastPt = pt;
  drawOverlay();
});

const endDraw = () => { if (drawing) { drawing = false; updateNextButton(); } };
overlayCanvas.addEventListener('pointerup', endDraw);
overlayCanvas.addEventListener('pointercancel', endDraw);
overlayCanvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
overlayCanvas.addEventListener('touchmove',  (e) => e.preventDefault(), { passive: false });

function brushAt(pt, redraw = true) {
  const radius = Number($('brush-size').value) * pt.ratio / 2;
  paintCircle(state.mask, state.mw, state.mh, pt.x, pt.y, radius, state.mode === 'erase' ? 0 : 255);
  if (redraw) { drawOverlay(); updateNextButton(); }
}

async function tapSegment(pt) {
  spinner(true, '切り抜き中…');
  try {
    const segmenter = await loadSegmenter();
    const raw = await segmentAt(segmenter, state.photo, pt.x / state.mw, pt.y / state.mh);

    // マスクの大きさが写真とちがう場合にそなえて座標を合わせる
    const px = Math.min(raw.width  - 1, Math.round(pt.x * raw.width  / state.mw));
    const py = Math.min(raw.height - 1, Math.round(pt.y * raw.height / state.mh));
    const res = maskFromLabels(raw, px, py);

    pushUndo();
    if (res.width === state.mw && res.height === state.mh) {
      state.mask = res.mask;
    } else {
      state.mask = resampleMask(res.mask, res.width, res.height, state.mw, state.mh);
    }
    drawOverlay();
    updateNextButton();

    if (res.coverage > 0.85) {
      $('cut-hint').textContent = 'うまく切り抜けませんでした。まん中あたりを もう一度タップするか、ふでで直してください。';
    } else {
      $('cut-hint').textContent = 'いいかんじ！ はみ出しは「けす」、足りないところは「たす」で直せます。';
    }
  } catch (err) {
    console.error(err);
    fallbackToBrush('自動の切り抜きができませんでした。「たす」の ふで で ぬってください。');
  } finally {
    spinner(false);
  }
}

function resampleMask(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, (y * sh / dh) | 0);
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, (x * sw / dw) | 0);
      out[y * dw + x] = src[sy * sw + sx];
    }
  }
  return out;
}

/* ---------- 切り抜き完了 → 顔だけ／ぜんしん をえらぶ ---------- */
$('btn-to-motion').addEventListener('click', () => {
  const cut = buildCutout(state.photo, state.mask, state.mw, state.mh);
  if (!cut) { alertBox('切り抜く場所がえらばれていません。'); return; }
  state.cutout = cut;
  state.face = null;
  drawInto(partCanvas, cut, 0.30);
  showScreen('screen-part');
});

$('btn-part-body').addEventListener('click', () => {
  state.part = 'body';
  state.playImage = state.cutout;
  state.spots = {};
  goMotion();
});

function goFaceCircle(part) {
  state.part = part;
  showScreen('screen-face');
  initFaceCircle();
  layoutFace();
  drawFace();
}
$('btn-part-face').addEventListener('click', () => goFaceCircle('face'));
$('btn-part-chara').addEventListener('click', () => goFaceCircle('chara'));

/* ---------- かおの丸あわせ ---------- */
function initFaceCircle() {
  const c = state.cutout;
  if (state.face) return;                       // もどってきたときは前のままにする
  // たてに長い写真なら上のほう、よこに長いなら やや上に顔があることが多い
  const r = Math.min(c.width, c.height) * 0.35;
  state.face = {
    cx: c.width / 2,
    cy: c.height > c.width ? c.height * 0.28 : c.height * 0.40,
    r,
  };
  $('face-size').value = String(radiusToSlider(r));
}

const faceMaxR = () => Math.max(state.cutout.width, state.cutout.height) * 0.60;
const sliderToRadius = (v) => (Number(v) / 100) * faceMaxR();
const radiusToSlider = (r) => Math.max(12, Math.min(100, Math.round(r / faceMaxR() * 100)));

function drawFace() {
  const c = state.cutout;
  if (!c || !state.face) return;
  const ctx = faceCanvas.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(c, 0, 0);

  const { cx, cy, r } = state.face;
  const g = faceOverlayCtx;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(20,10,20,.55)';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = '#fff';
  g.lineWidth = Math.max(2, c.width * 0.006);
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
}

function faceXY(e) {
  const rect = faceCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width  * state.cutout.width,
    y: (e.clientY - rect.top)  / rect.height * state.cutout.height,
  };
}

let faceDragging = false;
function moveFace(e) {
  const pt = faceXY(e);
  state.face.cx = Math.max(0, Math.min(state.cutout.width,  pt.x));
  state.face.cy = Math.max(0, Math.min(state.cutout.height, pt.y));
  drawFace();
}
faceOverlay.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  faceDragging = true;
  faceOverlay.setPointerCapture(e.pointerId);
  moveFace(e);
});
faceOverlay.addEventListener('pointermove', (e) => { if (faceDragging) { e.preventDefault(); moveFace(e); } });
faceOverlay.addEventListener('pointerup',     () => { faceDragging = false; });
faceOverlay.addEventListener('pointercancel', () => { faceDragging = false; });
faceOverlay.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
faceOverlay.addEventListener('touchmove',  (e) => e.preventDefault(), { passive: false });

$('face-size').addEventListener('input', (e) => {
  if (!state.face) return;
  state.face.r = sliderToRadius(e.target.value);
  drawFace();
});

$('btn-face-ok').addEventListener('click', () => {
  const { cx, cy, r } = state.face;
  state.playImage = buildFaceCrop(state.cutout, cx, cy, r);
  goMotion();
});

/* ---------- 動きをえらぶ ---------- */
const RANDOM = 'random';

function goMotion() {
  const chosen = fillMotionSelect(state.part);
  fillTravelSelect((MOTIONS[chosen] || {}).defaultTravel || 'none');
  syncRandomLock();
  drawInto(previewCanvas, state.playImage, 0.34);
  savePlay();
  showScreen('screen-motion');
}

/** えらんだ写真の種類で使える動きだけをならべる */
function fillMotionSelect(part, keep) {
  const sel = $('motion-select');
  sel.innerHTML = '';
  for (const name of motionsForPart(part)) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = MOTIONS[name].label;
    sel.appendChild(o);
  }
  const o = document.createElement('option');
  o.value = RANDOM;
  o.textContent = '🎲 おまかせ（つぎつぎ 変わる）';
  sel.appendChild(o);

  if (keep && [...sel.options].some((x) => x.value === keep)) sel.value = keep;
  showMotionDesc();
  return sel.value;
}

/** えらんでいる動きの説明を、ドロップダウンの下に出す */
function showMotionDesc() {
  const v = $('motion-select').value;
  if (v === RANDOM) {
    $('motion-desc').textContent =
      'あそんでいるあいだ、10秒ぐらいごとに 動き・動きまわりかた・はやさが ひとりでに 変わりつづけます。'
      + 'わたしっぱなしでも 飽きにくい、いちばんのおすすめです。';
    return;
  }
  const m = MOTIONS[v];
  $('motion-desc').textContent = m ? m.desc : '';
}

/** おまかせのときは、動きまわりかた と はやさ も じどうで決まる */
function syncRandomLock() {
  const isShuffle = $('motion-select').value === RANDOM;
  for (const id of ['travel-select', 'speed-select']) {
    $(id).disabled = isShuffle;
    $(id).closest('.field').classList.toggle('is-off', isShuffle);
  }
}

/* ---------- どこを動きまわるか ---------- */
function fillTravelSelect(keep) {
  const sel = $('travel-select');
  sel.innerHTML = '';
  for (const key of Object.keys(TRAVELS)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = TRAVELS[key].label;
    sel.appendChild(o);
  }
  const o = document.createElement('option');
  o.value = RANDOM;
  o.textContent = '🎲 おまかせ';
  sel.appendChild(o);
  if (keep && [...sel.options].some((x) => x.value === keep)) sel.value = keep;
  showTravelDesc();
}

/* ---------- さわったときの反応 ---------- */
const TAP_DESC = {
  dog:     'さわったところに おともだちが 出てきます。さわるほど どんどん ふえます。',
  sparkle: 'さわったところに キラキラが とびちります。',
  both:    'おともだちも キラキラも 出てきます。',
};
function showTapDesc() {
  $('tap-desc').textContent = TAP_DESC[$('tap-select').value] || '';
}
$('tap-select').addEventListener('change', showTapDesc);
showTapDesc();

function showTravelDesc() {
  const v = $('travel-select').value;
  $('travel-desc').textContent = v === RANDOM
    ? '［あそぶ］を押すたびに、動きまわりかたが変わります。'
    : (TRAVELS[v] || {}).desc || '';
}
$('travel-select').addEventListener('change', showTravelDesc);

/** 動きを変えたら、その動きに合う 動きまわりかた にそろえる */
$('motion-select').addEventListener('change', () => {
  showMotionDesc();
  const m = MOTIONS[$('motion-select').value];
  if (m) { $('travel-select').value = m.defaultTravel || 'none'; showTravelDesc(); }
  syncRandomLock();
});

/** canvas に絵をおさめて表示する（プレビュー用） */
function drawInto(canvas, img, maxHeightRatio) {
  const maxW = Math.min(420, window.innerWidth - 80);
  const maxH = window.innerHeight * maxHeightRatio;
  const s = Math.min(maxW / img.width, maxH / img.height, 1);
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.style.width  = Math.round(img.width  * s) + 'px';
  canvas.style.height = Math.round(img.height * s) + 'px';
  canvas.getContext('2d').drawImage(img, 0, 0);
}

/* ---------- ゆらす場所をえらぶ（しっぽふりふり・おてふり） ---------- */
function openSpot(motionName, playAfter) {
  const m = MOTIONS[motionName];
  state.spotKey = m.needsSpot;
  state.playAfterSpot = !!playAfter;
  $('spot-title').textContent = m.label;
  $('spot-hint').textContent = m.spotHint;

  const img = state.playImage;
  if (!state.spots[state.spotKey]) {
    state.spots[state.spotKey] = {
      x: img.width * 0.78,          // しっぽがあることの多い あたりを はじめの場所に
      y: img.height * 0.45,
      r: Math.max(img.width, img.height) * 0.26,
    };
  }
  $('spot-size').value = String(spotToSlider(state.spots[state.spotKey].r));
  showScreen('screen-spot');
  layoutSpot();
  drawSpot();
}

const spotMaxR = () => Math.max(state.playImage.width, state.playImage.height);
const sliderToSpot = (v) => (Number(v) / 100) * spotMaxR();
const spotToSlider = (r) => Math.max(8, Math.min(70, Math.round(r / spotMaxR() * 100)));

function drawSpot() {
  const img = state.playImage;
  const spot = state.spots[state.spotKey];
  if (!img || !spot) return;
  const sc = spotCanvas.getContext('2d');
  sc.clearRect(0, 0, img.width, img.height);
  sc.drawImage(img, 0, 0);

  const g = spotOverlayCtx;
  g.clearRect(0, 0, img.width, img.height);
  g.fillStyle = 'rgba(20,10,20,.55)';
  g.fillRect(0, 0, img.width, img.height);
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(spot.x, spot.y, spot.r, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = '#fff';
  g.lineWidth = Math.max(2, img.width * 0.006);
  g.beginPath(); g.arc(spot.x, spot.y, spot.r, 0, Math.PI * 2); g.stroke();
}

let spotDragging = false;
function moveSpot(e) {
  const img = state.playImage;
  const rect = spotCanvas.getBoundingClientRect();
  const spot = state.spots[state.spotKey];
  spot.x = Math.max(0, Math.min(img.width,  (e.clientX - rect.left) / rect.width  * img.width));
  spot.y = Math.max(0, Math.min(img.height, (e.clientY - rect.top)  / rect.height * img.height));
  drawSpot();
}
spotOverlay.addEventListener('pointerdown', (e) => {
  e.preventDefault(); spotDragging = true;
  spotOverlay.setPointerCapture(e.pointerId);
  moveSpot(e);
});
spotOverlay.addEventListener('pointermove', (e) => { if (spotDragging) { e.preventDefault(); moveSpot(e); } });
spotOverlay.addEventListener('pointerup',     () => { spotDragging = false; });
spotOverlay.addEventListener('pointercancel', () => { spotDragging = false; });
spotOverlay.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
spotOverlay.addEventListener('touchmove',  (e) => e.preventDefault(), { passive: false });

$('spot-size').addEventListener('input', (e) => {
  const spot = state.spots[state.spotKey];
  if (!spot) return;
  spot.r = sliderToSpot(e.target.value);
  drawSpot();
});

$('btn-spot-ok').addEventListener('click', () => {
  savePlay();
  if (state.playAfterSpot) { state.playAfterSpot = false; play(); }
  else showScreen('screen-motion');
});

$('btn-back-motion').addEventListener('click', () => {
  state.playAfterSpot = false;
  showScreen('screen-motion');
});

/* ---------- 再生 ---------- */
/** 「おまかせ」のときは、動き・はやさ・ゆらす場所をその場でくじ引きする */
const pickOne = (arr) => arr[(Math.random() * arr.length) | 0];
const SPEEDS = ['1.4', '2', '2.8', '4'];
let lastPicked = null;

/** えらんだとおりの 組み合わせ */
function fixedCombo() {
  const name = $('motion-select').value;
  const m = MOTIONS[name];
  const t = $('travel-select').value;
  return {
    name,
    speed: $('speed-select').value,
    spot: m.needsSpot ? state.spots[m.needsSpot] : null,
    travel: t === RANDOM ? pickOne(Object.keys(TRAVELS)) : t,
  };
}

/** おまかせ：動き・はやさ・動きまわりかた・ゆらす場所 を ぜんぶ引き直す。
 *  おなじ動きが 2回つづかないようにしている。 */
function randomCombo() {
  let pool = motionsForPart(state.part)
    .filter((k) => !MOTIONS[k].needsSpot || state.spots[MOTIONS[k].needsSpot]);
  if (pool.length > 1 && lastPicked) {
    const without = pool.filter((k) => k !== lastPicked);
    if (without.length) pool = without;
  }
  const name = pool.length ? pickOne(pool) : 'pyoko';
  lastPicked = name;
  const keys = Object.keys(state.spots);
  const spot = MOTIONS[name].needsSpot && keys.length ? state.spots[pickOne(keys)] : null;
  return { name, speed: pickOne(SPEEDS), spot, travel: pickOne(Object.keys(TRAVELS)) };
}

function play() {
  if (!state.playImage) return;
  const isShuffle = $('motion-select').value === RANDOM;
  lastPicked = null;
  const combo = isShuffle ? randomCombo() : fixedCombo();
  const m = MOTIONS[combo.name];
  if (m.needsSpot && !combo.spot) { openSpot(combo.name, true); return; }

  savePlay();
  player.start({
    cutout: state.playImage,
    motionName: combo.name,
    speed: combo.speed,
    part: state.part,
    spot: combo.spot,
    travel: combo.travel,
    tap: $('tap-select').value,
    // おまかせのときは、しばらくすると つぎの組み合わせに ひとりでに変わる
    shuffle: isShuffle ? randomCombo : null,
    onExit: () => showScreen('screen-motion'),
  });
}
$('btn-play').addEventListener('click', play);

/* ---------- もどる ---------- */
$('btn-back-start').addEventListener('click', () => showScreen('screen-start'));
$('btn-back-cut2').addEventListener('click', () => {
  if (state.photo) { showScreen('screen-cut'); layoutPhoto(); drawPhoto(); }
  else showScreen('screen-start');
});
$('btn-back-part').addEventListener('click', () => showScreen('screen-part'));
$('btn-back-part2').addEventListener('click', () => {
  if (!state.cutout) { showScreen('screen-start'); return; }
  if (state.part !== 'body') { showScreen('screen-face'); layoutFace(); drawFace(); }
  else showScreen('screen-part');
});

/* ---------- 前回のせっていを覚えておく（この端末の中だけ） ---------- */
/** 絵を小さくして dataURL にする（保存する量をおさえるため） */
function toDataURL(img, maxSide) {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const small = document.createElement('canvas');
  small.width  = Math.max(1, Math.round(img.width  * s));
  small.height = Math.max(1, Math.round(img.height * s));
  small.getContext('2d').drawImage(img, 0, 0, small.width, small.height);
  return { url: small.toDataURL('image/png'), scale: s };
}

/** ゆらす場所は絵の大きさに合わせて縮める必要があるので、割合で持ちかえる */
const spotsToRatio = (spots, img) => {
  const out = {};
  for (const k of Object.keys(spots)) {
    out[k] = { x: spots[k].x / img.width, y: spots[k].y / img.height,
               r: spots[k].r / Math.max(img.width, img.height) };
  }
  return out;
};
const spotsFromRatio = (ratios, img) => {
  const out = {};
  for (const k of Object.keys(ratios || {})) {
    // 前のばんの「しっぽ」「おて」は、いまは ひとつの「ふりふり」にまとめてある
    const key = (k === 'tail' || k === 'te') ? 'wave' : k;
    out[key] = { x: ratios[k].x * img.width, y: ratios[k].y * img.height,
                 r: ratios[k].r * Math.max(img.width, img.height) };
  }
  return out;
};

function currentRecord(maxSide = 512) {
  const img = state.playImage;
  if (!img) return null;
  return {
    img: toDataURL(img, maxSide).url,
    part: state.part,
    motion: $('motion-select').value,
    travel: $('travel-select').value,
    tap: $('tap-select').value,
    speed: $('speed-select').value,
    spots: spotsToRatio(state.spots, img),
  };
}

function savePlay() {
  try {
    const rec = currentRecord(512);
    if (rec) localStorage.setItem(STORE_KEY, JSON.stringify(rec));
    localStorage.removeItem(OLD_KEY);
  } catch { /* 保存できなくても動作には影響しない */ }
}

/** 保存しておいた1件を読みこんで、動きえらび画面をひらく */
function applyRecord(rec) {
  const img = new Image();
  img.onload = () => {
    state.playImage = img;
    state.part = ['face', 'chara'].includes(rec.part) ? rec.part : 'body';
    state.spots = spotsFromRatio(rec.spots, img);
    fillMotionSelect(state.part, rec.motion);
    fillTravelSelect(rec.travel || (MOTIONS[rec.motion] || {}).defaultTravel || 'none');
    if (rec.tap) { $('tap-select').value = rec.tap; showTapDesc(); }
    syncRandomLock();
    if (rec.speed && [...$('speed-select').options].some((o) => o.value === rec.speed)) {
      $('speed-select').value = rec.speed;
    }
    drawInto(previewCanvas, img, 0.34);
    showScreen('screen-motion');
  };
  img.src = rec.img;
}

(function restore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch {}
  if (!saved || !saved.img) return;
  $('btn-resume').hidden = false;
  $('btn-resume').addEventListener('click', () => applyRecord(saved));
})();

/* ---------- おきにいり ---------- */
function loadFavs() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
}

function storeFavs(favs) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    return true;
  } catch {
    // いっぱいのときは 古いものから消して もう一度ためす
    if (favs.length > 1) return storeFavs(favs.slice(1));
    return false;
  }
}

$('btn-fav').addEventListener('click', () => {
  const rec = currentRecord(360);
  if (!rec) return;
  const icon = (TRAVELS[rec.travel] || {}).icon || (rec.travel === RANDOM ? '🎲' : '');
  const base = rec.motion === RANDOM ? '🎲 おまかせ' : (MOTIONS[rec.motion] || {}).label || '';
  const label = (base + ' ' + icon).trim();
  const favs = loadFavs();
  favs.push({ ...rec, label, id: Date.now() });
  while (favs.length > FAV_MAX) favs.shift();
  if (storeFavs(favs)) {
    renderFavs();
    alertBox('おきにいりに入れました。つぎからは さいしょの画面から すぐあそべます。');
  } else {
    alertBox('この端末のあきがなくて、保存できませんでした。');
  }
});

function renderFavs() {
  const favs = loadFavs();
  const row = $('fav-row');
  row.innerHTML = '';
  $('fav-area').hidden = favs.length === 0;

  for (const fav of favs.slice().reverse()) {
    const btn = document.createElement('button');
    btn.className = 'fav';
    btn.type = 'button';
    btn.innerHTML = `<img alt=""><span></span>`;
    btn.querySelector('img').src = fav.img;
    btn.querySelector('span').textContent = fav.label || '';

    // ふつうに押す＝あそぶ、長おし＝けす（子どもが まちがえて消さないように）
    let timer = 0, held = false;
    const cancel = () => { clearTimeout(timer); };
    btn.addEventListener('pointerdown', () => {
      held = false;
      timer = setTimeout(() => {
        held = true;
        if (confirm('このおきにいりを けしますか？')) {
          storeFavs(loadFavs().filter((f) => f.id !== fav.id));
          renderFavs();
        }
      }, 800);
    });
    btn.addEventListener('pointerup', cancel);
    btn.addEventListener('pointercancel', cancel);
    btn.addEventListener('pointerleave', cancel);
    btn.addEventListener('click', () => { if (!held) applyRecord(fav); });
    row.appendChild(btn);
  }
}
renderFavs();

/* ---------- ページ全体のズーム・長押しメニューをおさえる ---------- */
document.addEventListener('gesturestart', (e) => e.preventDefault());
