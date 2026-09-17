/* ============================================================
   main.js  … 画面のつなぎ役
   第1段階：写真をえらぶ → タップで切り抜く → ぴょこぴょこループ → さわっても止まらない
   ============================================================ */

import { loadSegmenter, segmentAt } from './segmenter.js';
import { loadPhotoToCanvas, maskFromLabels, paintCircle, buildCutout } from './cutout.js';
import { createPlayer } from './player.js';

const STORE_KEY = 'dogAnim.cutout.v1';
const $ = (id) => document.getElementById(id);

/* ---------- 状態 ---------- */
const state = {
  photo: null,      // 写真の canvas
  mask: null,       // Uint8Array（0 か 255）
  mw: 0, mh: 0,
  cutout: null,     // 切り抜き後の canvas / img
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
    $('cut-hint').textContent = '犬のからだの まん中あたりを タップしてください。';
    spinner(true, 'AIの準備中…（はじめは10〜30秒ほどかかります）');
    await loadSegmenter();
    spinner(false);
  } catch (err) {
    spinner(false);
    console.error(err);
    fallbackToBrush('じどう切り抜きの準備ができませんでした（通信がとどいていないかもしれません）。「たす」の ふで で 犬をぬって切り抜けます。');
  }
});

/** AIが使えないときは、ふで（手ぬり）モードに切りかえて そのまま遊べるようにする */
function fallbackToBrush(message) {
  state.noAI = true;
  setMode('add');
  $('cut-hint').textContent = '指で 犬を なぞって ぬってください。はみ出したら「けす」で直せます。';
  alertBox(message);
}

/* ---------- 写真の表示サイズ ---------- */
function layoutPhoto() {
  if (!state.photo) return;
  const stage = $('cut-stage');
  const availW = stage.clientWidth  - 20;
  const availH = stage.clientHeight - 20;
  const scale = Math.min(availW / state.photo.width, availH / state.photo.height);
  const w = Math.max(40, Math.round(state.photo.width  * scale));
  const h = Math.max(40, Math.round(state.photo.height * scale));

  photoCanvas.width  = state.photo.width;
  photoCanvas.height = state.photo.height;
  overlayCanvas.width  = state.photo.width;
  overlayCanvas.height = state.photo.height;
  for (const c of [photoCanvas, overlayCanvas]) {
    c.style.width  = w + 'px';
    c.style.height = h + 'px';
  }
  $('canvas-wrap').style.width  = w + 'px';
  $('canvas-wrap').style.height = h + 'px';
}
window.addEventListener('resize', () => { layoutPhoto(); drawPhoto(); });

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
    tap:   '犬のからだの まん中あたりを タップしてください。',
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
      $('cut-hint').textContent = 'うまく切り抜けませんでした。犬の からだの まん中を もう一度タップするか、ふでで直してください。';
    } else {
      $('cut-hint').textContent = 'いいかんじ！ はみ出しは「けす」、足りないところは「たす」で直せます。';
    }
  } catch (err) {
    console.error(err);
    fallbackToBrush('自動の切り抜きができませんでした。「たす」の ふで で 犬をぬってください。');
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

/* ---------- 切り抜き完了 → 動きえらび ---------- */
$('btn-to-motion').addEventListener('click', () => {
  const cut = buildCutout(state.photo, state.mask, state.mw, state.mh);
  if (!cut) { alertBox('切り抜く場所がえらばれていません。'); return; }
  state.cutout = cut;
  saveCutout(cut);
  showPreview(cut);
  showScreen('screen-motion');
});

function showPreview(cut) {
  const maxW = Math.min(420, window.innerWidth - 80);
  const maxH = window.innerHeight * 0.34;
  const s = Math.min(maxW / cut.width, maxH / cut.height, 1);
  previewCanvas.width = cut.width;
  previewCanvas.height = cut.height;
  previewCanvas.style.width  = Math.round(cut.width  * s) + 'px';
  previewCanvas.style.height = Math.round(cut.height * s) + 'px';
  previewCanvas.getContext('2d').drawImage(cut, 0, 0);
}

/* ---------- 再生 ---------- */
$('btn-play').addEventListener('click', () => {
  if (!state.cutout) return;
  player.start({
    cutout: state.cutout,
    motionName: $('motion-select').value,
    speed: $('speed-select').value,
    onExit: () => showScreen('screen-motion'),
  });
});

/* ---------- もどる ---------- */
$('btn-back-start').addEventListener('click', () => showScreen('screen-start'));
$('btn-back-cut').addEventListener('click', () => {
  if (state.photo) { showScreen('screen-cut'); layoutPhoto(); drawPhoto(); }
  else showScreen('screen-start');
});

/* ---------- 前回のわんちゃんを覚えておく（この端末の中だけ） ---------- */
function saveCutout(cut) {
  try {
    const s = Math.min(1, 512 / Math.max(cut.width, cut.height));
    const small = document.createElement('canvas');
    small.width  = Math.round(cut.width * s);
    small.height = Math.round(cut.height * s);
    small.getContext('2d').drawImage(cut, 0, 0, small.width, small.height);
    localStorage.setItem(STORE_KEY, small.toDataURL('image/png'));
  } catch { /* 保存できなくても動作には影響しない */ }
}

(function restore() {
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch {}
  if (!saved) return;
  const img = new Image();
  img.onload = () => {
    state.cutout = img;
    $('btn-resume').hidden = false;
    $('btn-resume').addEventListener('click', () => {
      showPreview(img);
      showScreen('screen-motion');
    });
  };
  img.src = saved;
})();

/* ---------- ページ全体のズーム・長押しメニューをおさえる ---------- */
document.addEventListener('gesturestart', (e) => e.preventDefault());
