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
     rig(p)        … イラストの体のかっこう（'chara' のときだけ）
     overlay(...)  … 絵の上に重ねて描くもの（省略可）
     needsSpot     … ゆらす場所をタップで決める必要があるとき、その名前
     wiggle(p)     … ゆらす角度（ラジアン）
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
    legs: [{ angles: [DOWN + 0.12 + 0.45 * ground, DOWN + 0.06 - 0.60 * ground] },
           { angles: [DOWN - 0.12 - 0.45 * ground, DOWN - 0.06 + 0.60 * ground] }],
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
    const wave = Math.cos(k * 16);
    sx += 0.17 * damp * wave;
    sy -= 0.17 * damp * wave;
    lift += 0.06 * damp * Math.sin(k * 11);
    rot += 0.05 * damp * Math.sin(k * 13);
  }
  return { lift, sx, sy, rot, dx: 0 };
}

/** 「かおだけ」版：肉球の手が ふわっと浮いて顔をかくす */
function peekabooOverlay(ctx, p, box) {
  const cover = coverAmount(p);
  const r = Math.max(box.w, box.h) * 0.60;
  // ひらいたときは 画面の外までしっかり出す（はしに指が残らないように 1.2倍の余裕）
  const openX = Math.max(box.w * 0.62 + r * 1.25, box.sw / 2 + r * 1.2 + 8);
  const closeX = r * 0.55;

  const x = closeX + (openX - closeX) * (1 - cover);
  const y = box.cy - box.h * 0.02;
  const tilt = 0.55 * (1 - cover);
  const wiggle = hideWiggle(p) * 0.06;

  drawPaw(ctx, box.cx - x, y, r, -tilt + wiggle);
  drawPaw(ctx, box.cx + x, y, r,  tilt + wiggle);

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
    const k = easeInOut((p - 0.82) / 0.18);
    hand = mixPt(HAND_CHEER, HAND_REST, k);
    scale = 1;
  }

  const wig = hideWiggle(p) * 0.06;
  const cheer = (p > OPEN_END && p < 0.82) ? Math.sin((p - OPEN_END) * 26) * 0.10 : 0;
  const left  = { x: -hand.x + wig, y: hand.y + cheer };
  const right = { x:  hand.x + wig, y: hand.y - cheer };

  const bounce = (p > HIDE_OUT && p < 0.9) ? Math.exp(-(p - HIDE_OUT) * 8) : 0;
  return {
    hipShift: wig * 1.2,
    handScale: scale,
    arms: [{ to: left }, { to: right }],
    legs: [{ angles: [DOWN + 0.12 + 0.30 * bounce, DOWN + 0.06 - 0.40 * bounce] },
           { angles: [DOWN - 0.12 - 0.30 * bounce, DOWN - 0.06 + 0.40 * bounce] }],
  };
}

function peekabooBodyOverlay(ctx, p, box) {
  drawBurst(ctx, box.cx, box.cy, Math.max(box.w, box.h) * 0.78,
            clamp01(1 - Math.abs(p - OPEN_END) / 0.14));
}

/* ============================================================
   ウェーイ！（へんてこダンス）
   1周で2回、左右のうでを 入れかえながら ななめ上へ つき上げる。
   腰は左右にふり、ひざはリズムに合わせて はずむ。
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
  const hit = 1 - snap;                       // 拍の直後がいちばん強い
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
  const from = wayTargets(!leftUp);
  const to   = wayTargets(leftUp);
  const arms = [0, 1].map((i) => ({ to: mixPt(from[i], to[i], snap) }));

  const sway = Math.sin(p * TAU);
  const hit = 1 - snap;
  const kick = leftUp ? 1 : -1;
  return {
    hipShift: sway * 0.30,
    arms,
    // 片あしずつ 交互に ちょっと外へ けり出す
    legs: [{ angles: [DOWN + 0.14 + 0.30 * hit + (kick > 0 ? 0.28 : 0),
                      DOWN + 0.08 - 0.34 * hit] },
           { angles: [DOWN - 0.14 - 0.30 * hit - (kick < 0 ? 0.28 : 0),
                      DOWN - 0.08 + 0.34 * hit] }],
  };
}

/* ============================================================
   しっぽふりふり／おてふり（タップした場所だけをゆらす）
   ============================================================ */
function bobPose(strength) {
  return (p) => ({
    lift: (1 + Math.sin(p * TAU * 2)) / 2,
    sx: 1, sy: 1 + strength * Math.sin(p * TAU * 2),
    rot: 0, dx: 0,
  });
}

/* ============================================================
   一覧
   ============================================================ */
export const MOTIONS = {
  pyoko: {
    label: 'ぴょこぴょこ',
    desc: '全身が のびちぢみしながら ぴょんぴょん はねます。',
    parts: ['body', 'face', 'chara'],
    anchor: 'ground',
    pose: pyokoPose,
    rig: pyokoRig,
    hopHeight: 0.30,
    defaultDuration: 800,
  },
  peekaboo: {
    label: 'いないいないばあ',
    desc: '肉球の手が 顔をかくして、ぱっと開いて「ばあ！」。',
    parts: ['face'],
    anchor: 'center',
    pose: peekabooPose,
    overlay: peekabooOverlay,
    hopHeight: 0.10,
    defaultDuration: 2400,
  },
  wayway: {
    label: 'ウェーイ！',
    desc: 'イラストの体で、うでを ななめ上に つき上げながら へんてこダンス。',
    parts: ['chara'],
    anchor: 'ground',
    pose: waywayPose,
    rig: waywayRig,
    hopHeight: 0.12,
    defaultDuration: 1000,
  },
  peekabooBody: {
    label: 'いないいないばあ（体つき）',
    desc: 'イラストの体が じぶんの手で顔をかくして、ばんざいで「ばあ！」。',
    parts: ['chara'],
    anchor: 'ground',
    pose: peekabooPose,
    rig: peekabooBodyRig,
    overlay: peekabooBodyOverlay,
    hopHeight: 0.10,
    defaultDuration: 2400,
  },
  tail: {
    label: 'しっぽふりふり',
    desc: 'タップした しっぽのあたりだけが、ぱたぱた ゆれます。',
    parts: ['body'],
    anchor: 'ground',
    pose: bobPose(0.012),
    needsSpot: 'tail',
    spotHint: 'しっぽの まん中あたりを タップしてね',
    wiggle: (p) => Math.sin(p * TAU) * 0.34,
    hopHeight: 0.035,
    defaultDuration: 520,
  },
  te: {
    label: 'おてふり',
    desc: 'タップした 前足のあたりだけが、ふりふり 動きます。',
    parts: ['body'],
    anchor: 'ground',
    pose: bobPose(0.010),
    needsSpot: 'te',
    spotHint: '前足（おてする手）を タップしてね',
    wiggle: (p) => Math.sin(p * TAU) * 0.42,
    hopHeight: 0.03,
    defaultDuration: 700,
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
