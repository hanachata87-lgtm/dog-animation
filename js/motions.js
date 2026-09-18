/* ============================================================
   motions.js
   「動きの種類」をまとめたところ。新しい動きはここに足すだけで増やせる。

   ひとつの動きがもてる項目：
     label / desc  … 画面に出す名前と説明
     parts         … 使える写真の種類 'body'（ぜんしん）/ 'face'（かおだけ）
                     / 'chara'（かおだけ＋イラストの体）。1つめが「得意な種類」
     anchor        … 'ground'（足を地面につける）/ 'center'（まん中に浮かぶ）
     pose(p)       … 絵の動き。p は 0〜1 のくり返し位置
                       lift : うき上がる高さの割合、sx/sy : つぶれ／のび
                       rot  : かたむき、dx : 横ゆれ（画面幅の割合）
     wholeBody     … true なら かたむき・大きさを 体ぜんたいに かける
                     （イラストの体をつけたとき、顔だけでなく体ごと動く）
     rig(p)        … イラストの体のかっこう（'chara' のときだけ）
     overlay(...)  … 絵の上に重ねて描くもの（省略可）
     needsSpot     … ゆらす場所をタップで決める必要があるとき、その名前
     wiggle(p)     … ゆらす角度（ラジアン）
     defaultTravel … おすすめの「動きまわりかた」
     hopHeight / defaultDuration
   ============================================================ */

import { drawPaw, drawBurst } from './paw.js';
import { PROP } from './body.js';

const TAU = Math.PI * 2;
const DOWN = Math.PI / 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const mix = (a, b, t) => a + (b - a) * t;
const mixPt = (a, b, t) => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) });
/** 0 →1→ 0 と なめらかに ゆきかえりする波 */
const wave01 = (p) => (1 - Math.cos(p * TAU)) / 2;

/* ============================================================
   ぴょこぴょこ
   ============================================================ */
function pyokoPose(p) {
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

/** 体つきのときは、とぶ前にひざを曲げ、空中でうでを広げる */
function pyokoRig(p) {
  const air = Math.sin(Math.PI * p);
  const ground = Math.pow(1 - air, 2.2);
  return {
    hipShift: 0,
    arms: [{ angles: [DOWN + 0.35 + 0.85 * air, DOWN + 0.32 + 0.70 * air] },
           { angles: [DOWN - 0.35 - 0.85 * air, DOWN - 0.32 - 0.70 * air] }],
    // 付け根は体についたまま、ひざから先が外へ開いて しゃがむ
    legs: [{ angles: [DOWN + 0.09 + 0.16 * ground, DOWN + 0.16 + 0.55 * ground] },
           { angles: [DOWN - 0.09 - 0.16 * ground, DOWN - 0.16 - 0.55 * ground] }],
  };
}

/* ============================================================
   いないいないばあ
   0.00〜0.14  手が入ってきて 顔をかくす（いないいない）
   0.14〜0.46  かくれたまま、ちょっとモゾモゾ
   0.46〜0.56  ぱっと開く（ばあ！）
   0.56〜1.00  顔が見えたまま、うれしそうにはずむ
   ============================================================ */
const HIDE_IN = 0.14, HIDE_OUT = 0.46, OPEN_END = 0.56;

/** 0 = 手がひらいている、1 = 顔を完全にかくしている */
function coverAmount(p) {
  if (p < HIDE_IN)  return easeInOut(p / HIDE_IN);
  if (p < HIDE_OUT) return 1;
  if (p < OPEN_END) return 1 - easeOut((p - HIDE_OUT) / (OPEN_END - HIDE_OUT));
  return 0;
}

/** かくれている間のモゾモゾ */
function hideWiggle(p) {
  if (p <= HIDE_IN || p >= HIDE_OUT) return 0;
  return Math.sin((p - HIDE_IN) / (HIDE_OUT - HIDE_IN) * TAU * 2);
}

function peekabooPose(p) {
  const cover = coverAmount(p);
  let sx = 1 - 0.03 * cover;
  let sy = 1 - 0.04 * cover;
  let lift = -0.012 * cover;
  let rot = hideWiggle(p) * 0.02;

  // 「ばあ！」のはずみ（だんだん小さくなるバネの動き）
  const t = p - HIDE_OUT;
  if (t > 0 && t < 0.42) {
    const k = t / 0.42;
    const damp = Math.exp(-k * 4.5);
    const w = Math.cos(k * 16);
    sx += 0.17 * damp * w;
    sy -= 0.17 * damp * w;
    lift += 0.06 * damp * Math.sin(k * 11);
    rot += 0.05 * damp * Math.sin(k * 13);
  }
  return { lift, sx, sy, rot, dx: 0 };
}

/** 「かおだけ」版：まるい手が ふわっと浮いて顔をかくす */
function peekabooOverlay(ctx, p, box) {
  const cover = coverAmount(p);
  const r = Math.max(box.w, box.h) * 0.60;
  // ひらいたときは 画面の外までしっかり出す（はしに指が残らないように 1.2倍の余裕）
  const openX = Math.max(box.w * 0.62 + r * 1.25, box.sw / 2 + r * 1.2 + 8);
  const closeX = r * 0.55;

  const x = closeX + (openX - closeX) * (1 - cover);
  const y = box.cy - box.h * 0.02;
  const tilt = 0.55 * (1 - cover);
  const wig = hideWiggle(p) * 0.06;

  drawPaw(ctx, box.cx - x, y, r, -tilt + wig);
  drawPaw(ctx, box.cx + x, y, r,  tilt + wig);
  drawBurst(ctx, box.cx, box.cy, Math.max(box.w, box.h) * 0.78,
            clamp01(1 - Math.abs(p - OPEN_END) / 0.14));
}

/* --- 「体つき」版：自分のうでを顔まで持ちあげて かくす --- */
const HAND_REST  = { x: 1.15, y: 0.55 };   // 体のよこ（s単位・首が原点）
const HAND_COVER = { x: 0.42, y: -0.95 };  // 顔をかくす
const HAND_CHEER = { x: 1.30, y: -1.60 };  // ばんざい

function peekabooBodyRig(p) {
  let hand, scale;
  if (p < HIDE_IN) {                       // 手をあげて かくす
    const k = easeInOut(p / HIDE_IN);
    hand = mixPt(HAND_REST, HAND_COVER, k);
    scale = mix(1, 2.2, k);
  } else if (p < HIDE_OUT) {               // かくれたまま
    hand = HAND_COVER; scale = 2.2;
  } else if (p < OPEN_END) {               // ぱっと ばんざい
    const k = easeOut((p - HIDE_OUT) / (OPEN_END - HIDE_OUT));
    hand = mixPt(HAND_COVER, HAND_CHEER, k);
    scale = mix(2.2, 1, k);
  } else if (p < 0.82) {                   // ばんざいのまま ゆらゆら
    hand = HAND_CHEER; scale = 1;
  } else {                                 // そっと おろす
    hand = mixPt(HAND_CHEER, HAND_REST, easeInOut((p - 0.82) / 0.18));
    scale = 1;
  }

  const wig = hideWiggle(p) * 0.06;
  const cheer = (p > OPEN_END && p < 0.82) ? Math.sin((p - OPEN_END) * 26) * 0.10 : 0;
  const bounce = (p > HIDE_OUT && p < 0.9) ? Math.exp(-(p - HIDE_OUT) * 8) : 0;
  return {
    hipShift: wig * 1.2,
    handScale: scale,
    arms: [{ to: { x: -hand.x + wig, y: hand.y + cheer } },
           { to: { x:  hand.x + wig, y: hand.y - cheer } }],
    legs: [{ angles: [DOWN + 0.08 + 0.12 * bounce, DOWN + 0.16 + 0.40 * bounce] },
           { angles: [DOWN - 0.08 - 0.12 * bounce, DOWN - 0.16 - 0.40 * bounce] }],
  };
}

function burstOnly(ctx, p, box) {
  drawBurst(ctx, box.cx, box.cy, Math.max(box.w, box.h) * 0.78,
            clamp01(1 - Math.abs(p - OPEN_END) / 0.14));
}

/* ============================================================
   ウェーイ！（へんてこダンス）
   1周で2回、左右のうでを 入れかえながら ななめ上へ つき上げる。
   ============================================================ */
const WAY_UP   = { x: 1.32, y: -1.62 };
const WAY_DOWN = { x: 1.18, y:  0.62 };

function wayTargets(leftUp) {
  return leftUp
    ? [{ x: -WAY_UP.x,   y: WAY_UP.y   }, { x: WAY_DOWN.x, y: WAY_DOWN.y }]
    : [{ x: -WAY_DOWN.x, y: WAY_DOWN.y }, { x: WAY_UP.x,   y: WAY_UP.y   }];
}

/** 拍のはじめだけ すばやく動いて、あとは止まって見せる（アニメらしいキレ） */
function waySnap(p) {
  const beat = p * 2;
  const k = beat % 1;
  return { leftUp: Math.floor(beat) % 2 === 0, snap: easeOut(Math.min(1, k * 2.6)), k };
}

function waywayPose(p) {
  const { snap, leftUp, k } = waySnap(p);
  const hit = 1 - snap;
  return {
    lift: 0.10 * Math.abs(Math.sin(p * TAU)),
    sx: 1 + 0.07 * hit,
    sy: 1 - 0.07 * hit,
    rot: (leftUp ? -1 : 1) * (0.14 - 0.05 * k),
    dx: 0,
  };
}

function waywayRig(p) {
  const { leftUp, snap } = waySnap(p);
  const from = wayTargets(!leftUp), to = wayTargets(leftUp);
  const sway = Math.sin(p * TAU);
  const hit = 1 - snap;
  // あしの付け根は体についたまま、足先だけ「ハの字」に 開く→とじる をくり返す
  const open = (1 - Math.cos(p * TAU * 2)) / 2;
  const bend = 0.20 * hit;
  return {
    hipShift: sway * 0.26,
    arms: [0, 1].map((i) => ({ to: mixPt(from[i], to[i], snap) })),
    legs: [{ angles: [DOWN + 0.05 + 0.08 * open + bend, DOWN + 0.14 + 0.60 * open - bend * 1.5] },
           { angles: [DOWN - 0.05 - 0.08 * open - bend, DOWN - 0.14 - 0.60 * open + bend * 1.5] }],
  };
}

/* ============================================================
   ばんざい（体つき）：両手を上へ つき上げて ジャンプ
   ============================================================ */
const BANZAI_UP = { x: 1.22, y: -1.72 };

function banzaiPose(p) {
  const up = Math.pow(Math.sin(Math.PI * p), 0.7);
  return { lift: up, sx: 1 + 0.06 * up, sy: 1 - 0.06 * up, rot: 0, dx: 0 };
}

function banzaiRig(p) {
  const up = Math.pow(Math.sin(Math.PI * p), 0.7);
  const hand = mixPt(HAND_REST, BANZAI_UP, up);
  const crouch = Math.pow(1 - up, 2);
  return {
    hipShift: 0,
    arms: [{ to: { x: -hand.x, y: hand.y } }, { to: hand }],
    legs: [{ angles: [DOWN + 0.08 + 0.14 * crouch, DOWN + 0.16 + 0.50 * crouch] },
           { angles: [DOWN - 0.08 - 0.14 * crouch, DOWN - 0.16 - 0.50 * crouch] }],
  };
}

/* ============================================================
   おいでおいで（体つき）：片手を ふりふり
   ============================================================ */
function helloPose(p) {
  return { lift: wave01(p) * 0.30, sx: 1, sy: 1, rot: Math.sin(p * TAU) * 0.07, dx: 0 };
}

function helloRig(p) {
  const w = Math.sin(p * TAU * 2);          // 1周で2回ふる
  return {
    hipShift: Math.sin(p * TAU) * 0.10,
    arms: [{ to: { x: -1.08, y: 0.55 } },
           { to: { x: 1.12 + 0.30 * w, y: -1.42 + 0.20 * w } }],
    legs: [{ angles: [DOWN + 0.06, DOWN + 0.16] },
           { angles: [DOWN - 0.06, DOWN - 0.16] }],
  };
}

/* ============================================================
   写真そのままで つかえる かんたんな動き
   ============================================================ */
/** くるくる：まわりながら ふわふわ うかぶ */
function spinPose(p) {
  return { lift: wave01(p) * 0.7, sx: 1, sy: 1, rot: p * TAU, dx: 0 };
}

/** ぷるぷる：こまかく ふるえる（水をはらう動物みたいに） */
function shakePose(p) {
  const w = Math.sin(p * TAU * 6);          // 1周で6回
  return {
    lift: wave01(p * 2) * 0.35,
    sx: 1 + 0.05 * Math.abs(w),
    sy: 1 - 0.05 * Math.abs(w),
    rot: w * 0.11,
    dx: w * 0.014,
  };
}

/** ゆらゆら：ゆっくり 左右にかたむく（おちつく動き） */
function swayPose(p) {
  const a = Math.sin(p * TAU);
  return { lift: wave01(p * 2) * 0.5, sx: 1, sy: 1, rot: a * 0.17, dx: a * 0.05 };
}

/** おおきくちいさく：ふくらんだり しぼんだり */
function pulsePose(p) {
  const e = Math.pow(wave01(p), 0.7);
  const s = 0.86 + 0.36 * e;
  return { lift: e * 0.35, sx: s, sy: s, rot: Math.sin(p * TAU * 2) * 0.04, dx: 0 };
}

/* ============================================================
   ふりふり：タップした場所だけを 付け根を軸にゆらす
   （しっぽ・手・耳 …… 場所がちがうだけで しくみは同じ）
   ============================================================ */
function wavePose(p) {
  return { lift: wave01(p * 2), sx: 1, sy: 1 + 0.012 * Math.sin(p * TAU * 2), rot: 0, dx: 0 };
}

/* ============================================================
   一覧
   ============================================================ */
export const MOTIONS = {
  pyoko: {
    label: 'ぴょこぴょこ',
    desc: 'のびちぢみしながら ぴょんぴょん はねます。',
    parts: ['body', 'face', 'chara'],
    anchor: 'ground', pose: pyokoPose, rig: pyokoRig,
    defaultTravel: 'bounce', hopHeight: 0.30, defaultDuration: 800,
  },
  wave: {
    label: 'ふりふり',
    desc: 'タップしたところ（しっぽ・手・耳など）だけが ふりふり ゆれます。',
    parts: ['body', 'face'],
    anchor: 'ground', pose: wavePose,
    needsSpot: 'wave',
    spotHint: 'ゆらしたいところ（しっぽ・手・耳など）を タップしてね',
    wiggle: (p) => Math.sin(p * TAU) * 0.38,
    defaultTravel: 'run', hopHeight: 0.035, defaultDuration: 620,
  },
  peekaboo: {
    label: 'いないいないばあ',
    desc: 'まるい手が 顔をかくして、ぱっと開いて「ばあ！」。',
    parts: ['face'],
    anchor: 'center', pose: peekabooPose, overlay: peekabooOverlay,
    defaultTravel: 'none', hopHeight: 0.10, defaultDuration: 2400,
  },
  wayway: {
    label: 'ウェーイ！',
    desc: 'イラストの体で、うでを ななめ上に つき上げながら へんてこダンス。',
    parts: ['chara'],
    anchor: 'ground', pose: waywayPose, rig: waywayRig,
    defaultTravel: 'run', hopHeight: 0.12, defaultDuration: 1000,
  },
  peekabooBody: {
    label: 'いないいないばあ（体つき）',
    desc: 'イラストの体が じぶんの手で顔をかくして、ばんざいで「ばあ！」。',
    parts: ['chara'],
    anchor: 'ground', pose: peekabooPose, rig: peekabooBodyRig, overlay: burstOnly,
    defaultTravel: 'none', hopHeight: 0.10, defaultDuration: 2400,
  },
  banzai: {
    label: 'ばんざい',
    desc: '両手を 上にあげて ジャンプ。うれしいときの かっこう。',
    parts: ['chara'],
    anchor: 'ground', pose: banzaiPose, rig: banzaiRig,
    defaultTravel: 'bounce', hopHeight: 0.24, defaultDuration: 1200,
  },
  hello: {
    label: 'おいでおいで',
    desc: '片手を ふりふりして、よんでいるみたいな かっこう。',
    parts: ['chara'],
    anchor: 'ground', pose: helloPose, rig: helloRig,
    defaultTravel: 'none', hopHeight: 0.08, defaultDuration: 1400,
  },
  spin: {
    label: 'くるくる',
    desc: 'ぐるっと まわりながら ふわふわ うかびます。',
    parts: ['body', 'face', 'chara'],
    anchor: 'ground', pose: spinPose, wholeBody: true,
    defaultTravel: 'bounce', hopHeight: 0.35, defaultDuration: 1800,
  },
  shake: {
    label: 'ぷるぷる',
    desc: 'こまかく ぶるぶる ふるえます。',
    parts: ['body', 'face', 'chara'],
    anchor: 'ground', pose: shakePose, wholeBody: true,
    defaultTravel: 'none', hopHeight: 0.08, defaultDuration: 900,
  },
  sway: {
    label: 'ゆらゆら',
    desc: 'ゆっくり 左右にかたむきます。おちつく動きです。',
    parts: ['body', 'face', 'chara'],
    anchor: 'ground', pose: swayPose, wholeBody: true,
    defaultTravel: 'none', hopHeight: 0.10, defaultDuration: 2200,
  },
  pulse: {
    label: 'おおきく ちいさく',
    desc: 'ふくらんだり しぼんだり、大きさが 変わります。',
    parts: ['body', 'face', 'chara'],
    anchor: 'ground', pose: pulsePose, wholeBody: true,
    defaultTravel: 'bounce', hopHeight: 0.18, defaultDuration: 1400,
  },
};

export function getMotion(name) {
  return MOTIONS[name] || MOTIONS.pyoko;
}

/**
 * その写真の種類（body / face / chara）で使える動きの名前を返す。
 * その種類のために作られた動き（parts の1つめが一致するもの）を先に並べる。
 */
export function motionsForPart(part) {
  return Object.keys(MOTIONS)
    .filter((k) => MOTIONS[k].parts.includes(part))
    .sort((a, b) => (MOTIONS[b].parts[0] === part) - (MOTIONS[a].parts[0] === part));
}

/** 体のつくりを player 側から参照するため */
export { PROP };
