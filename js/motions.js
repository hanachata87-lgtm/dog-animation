/* ============================================================
   motions.js
   「動きの種類」をまとめたところ。
   新しい動きは、このファイルに1つ足すだけで増やせる。

   ひとつの動きは次の項目をもつ：
     label     … 画面に出す名前
     parts     … 使える写真の種類 ['body'] / ['face'] / 両方
     anchor    … 'ground'（足を地面につけて立つ）/ 'center'（まん中に浮かぶ）
     pose(p)   … 絵をどう動かすか。p は 0〜1 のくり返し位置
                   lift : ジャンプの高さの割合（0〜1）
                   sx,sy: つぶれ／のび（1が等倍）
                   rot  : かたむき（ラジアン）
                   dx   : 横ゆれ（画面幅に対する割合）
     overlay(ctx,p,box) … 絵の上に重ねて描くもの（肉球の手など。省略可）
     hopHeight … 画面の高さに対するジャンプの高さ
     defaultDuration … 1周のミリ秒
   ============================================================ */

import { drawPaw, drawBurst } from './paw.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/* ---------- ぴょこぴょこ ---------- */
function pyoko(p) {
  const air    = Math.sin(Math.PI * p);        // 0 →1→ 0
  const lift   = Math.pow(air, 0.8);           // 空中でふわっと
  const ground = Math.pow(1 - air, 2.2);       // 着地のしゅんかんだけ強い
  return {
    lift,
    sx: 1 + 0.18 * ground - 0.07 * lift,
    sy: 1 - 0.20 * ground + 0.09 * lift,
    rot: Math.sin(p * TAU) * 0.05,
    dx: Math.sin(p * TAU) * 0.015,
  };
}

/* ---------- いないいないばあ ----------
   0.00〜0.14  手が左右から入ってきて 顔をかくす（いないいない）
   0.14〜0.46  かくれたまま、ちょっとモゾモゾ
   0.46〜0.56  ぱっと手を開く（ばあ！）
   0.56〜1.00  顔が見えたまま、うれしそうにはずむ
------------------------------------------ */
const HIDE_IN = 0.14, HIDE_OUT = 0.46, OPEN_END = 0.56;

/** 0 = 手がひらいている、1 = 顔を完全にかくしている */
function coverAmount(p) {
  if (p < HIDE_IN)  return easeInOut(p / HIDE_IN);
  if (p < HIDE_OUT) return 1;
  if (p < OPEN_END) return 1 - easeOut((p - HIDE_OUT) / (OPEN_END - HIDE_OUT));
  return 0;
}

function peekaboo(p) {
  const cover = coverAmount(p);

  // かくれている間は、すこし小さくちぢこまる
  let sx = 1 - 0.03 * cover;
  let sy = 1 - 0.04 * cover;
  let lift = -0.012 * cover;
  let rot = 0;

  // かくれている間のモゾモゾ
  if (p > HIDE_IN && p < HIDE_OUT) {
    const k = (p - HIDE_IN) / (HIDE_OUT - HIDE_IN);
    rot += Math.sin(k * TAU * 2) * 0.02;
  }

  // 「ばあ！」のはずみ（だんだん小さくなるバネの動き）
  const t = p - HIDE_OUT;
  if (t > 0 && t < 0.42) {
    const k = t / 0.42;
    const damp = Math.exp(-k * 4.5);
    const wave = Math.cos(k * 16);
    sx += 0.17 * damp * wave;
    sy -= 0.17 * damp * wave;
    lift += 0.06 * damp * Math.sin(k * 11);
    rot += 0.05 * damp * Math.sin(k * 13);
  }
  return { lift, sx, sy, rot, dx: 0 };
}

/** 顔の上に、肉球の手を2つ描く */
function peekabooOverlay(ctx, p, box) {
  const cover = coverAmount(p);
  const r = Math.max(box.w, box.h) * 0.60;      // 手のひらの半径
  // ひらいたときは 画面の外までしっかり出す（はしに指が残らないように 1.2倍の余裕）
  const openX = Math.max(box.w * 0.62 + r * 1.25, box.sw / 2 + r * 1.2 + 8);
  const closeX = r * 0.55;                      // とじたときの左右の位置（顔をすきまなくおおう）

  const x = closeX + (openX - closeX) * (1 - cover);
  const y = box.cy - box.h * 0.02;

  // ひらくほど 外向きにかたむく
  const tilt = 0.55 * (1 - cover);
  // かくれている間のモゾモゾ
  const wiggle = (p > HIDE_IN && p < HIDE_OUT)
    ? Math.sin((p - HIDE_IN) / (HIDE_OUT - HIDE_IN) * TAU * 2) * 0.06 : 0;

  drawPaw(ctx, box.cx - x, y, r, -tilt + wiggle);
  drawPaw(ctx, box.cx + x, y, r,  tilt + wiggle);

  // 「ばあ！」のしゅんかんの光
  const burst = clamp01(1 - Math.abs(p - OPEN_END) / 0.14);
  drawBurst(ctx, box.cx, box.cy, Math.max(box.w, box.h) * 0.78, burst);
}

/* ---------- 一覧 ---------- */
export const MOTIONS = {
  pyoko: {
    label: 'ぴょこぴょこ',
    desc: '全身が のびちぢみしながら ぴょんぴょん はねます。',
    parts: ['body', 'face'],
    anchor: 'ground',
    pose: pyoko,
    hopHeight: 0.30,
    defaultDuration: 800,
  },
  peekaboo: {
    label: 'いないいないばあ',
    desc: '肉球の手が 顔をかくして、ぱっと開いて「ばあ！」。',
    parts: ['face'],
    anchor: 'center',
    pose: peekaboo,
    overlay: peekabooOverlay,
    hopHeight: 0.10,
    defaultDuration: 2400,
  },
};

export function getMotion(name) {
  return MOTIONS[name] || MOTIONS.pyoko;
}

/**
 * その写真の種類（body / face）で使える動きの名前を返す。
 * その種類のために作られた動き（parts の1つめが一致するもの）を先に並べる。
 */
export function motionsForPart(part) {
  return Object.keys(MOTIONS)
    .filter((k) => MOTIONS[k].parts.includes(part))
    .sort((a, b) => (MOTIONS[b].parts[0] === part) - (MOTIONS[a].parts[0] === part));
}
