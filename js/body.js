/* ============================================================
   body.js
   「かおだけ」の写真に、イラストの体をつけて キャラクターにする。
   画像ファイルは使わず、すべて図形で描いている。

   すべての長さは s（＝顔の半径）を単位にして書いてあるので、
   顔の大きさが変わっても かたちの比率はくずれない。
   位置の基準（原点）は 首 のところ。
   ============================================================ */

import { drawPaw } from './paw.js';

const TAU = Math.PI * 2;

/** 体の比率（s＝顔の半径 を1とした長さ） */
export const PROP = {
  shoulder: 0.68,   // 首から肩までの横はば
  torso:    1.25,   // 首から腰まで
  hip:      0.48,   // 腰の横はば
  upperArm: 0.72,
  foreArm:  0.68,
  thigh:    0.78,
  shin:     0.72,
  limbW:    0.26,   // うで・あしの太さ
  hand:     0.30,   // 手の大きさ
};

/** 首からつま先までの高さ（s単位）。画面に収めるときに使う。 */
export const BODY_HEIGHT = PROP.torso + PROP.thigh + PROP.shin;

const FUR        = '#fff3e6';
const FUR_EDGE   = '#e9d4c0';
const SHIRT      = '#79d3e8';
const SHIRT_DARK = '#57bdd6';
const SHORTS     = '#ffc94d';
const SHORTS_DARK= '#efb52e';

/** なにもしていない、まっすぐ立ったかっこう */
export function restRig() {
  const down = Math.PI / 2;
  return {
    hipShift: 0,
    arms: [{ angles: [down + 0.30, down + 0.22] },      // 左（画面では左がわ）
           { angles: [down - 0.30, down - 0.22] }],     // 右
    legs: [{ angles: [down + 0.10, down + 0.04] },
           { angles: [down - 0.10, down - 0.04] }],
  };
}

/* ---------- かんたんな計算 ---------- */
const pt = (x, y) => ({ x, y });
const move = (p, angle, len) => pt(p.x + Math.cos(angle) * len, p.y + Math.sin(angle) * len);

/**
 * 2本の骨（うで・あし）で、手先を ねらった場所へ とどける角度を求める。
 * bend は ひじ・ひざ の曲がる向き（+1 / -1）。
 */
export function ik(from, target, a1, a2, bend) {
  const dx = target.x - from.x, dy = target.y - from.y;
  const far = (a1 + a2) * 0.999;
  const near = Math.abs(a1 - a2) * 1.001 + 1e-6;
  const d = Math.min(far, Math.max(near, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx);
  const acos = (v) => Math.acos(Math.min(1, Math.max(-1, v)));
  const A = acos((d * d + a1 * a1 - a2 * a2) / (2 * d * a1));
  const B = acos((a1 * a1 + a2 * a2 - d * d) / (2 * a1 * a2));
  const first = base - bend * A;
  return [first, first + bend * (Math.PI - B)];
}

/**
 * うで／あし の角度を、指定（angles）か とどけ先（to）から決める。
 * to は s を単位にした 首からの位置なので、ここで画素にそろえる。
 */
function limbAngles(spec, from, a1, a2, bend, s) {
  if (spec && spec.to) {
    return ik(from, { x: spec.to.x * s, y: spec.to.y * s }, a1, a2, bend);
  }
  return (spec && spec.angles) || [Math.PI / 2, Math.PI / 2];
}

function stroke3(ctx, p0, p1, p2, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}

/* ---------- 体のうしろがわ（あし・どう体・ズボン） ---------- */
export function drawBodyBack(ctx, s, rig) {
  const hipY = PROP.torso * s;
  const hipC = pt((rig.hipShift || 0) * s, hipY);

  // あし
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const from = pt(hipC.x + side * PROP.hip * s, hipC.y);
    const [a, b] = limbAngles(rig.legs && rig.legs[i], from, PROP.thigh * s, PROP.shin * s, side, s);
    const knee = move(from, a, PROP.thigh * s);
    const foot = move(knee, b, PROP.shin * s);

    stroke3(ctx, from, knee, foot, PROP.limbW * s * 1.05 + s * 0.04, FUR_EDGE);
    stroke3(ctx, from, knee, foot, PROP.limbW * s, FUR);

    // 足
    ctx.save();
    ctx.translate(foot.x, foot.y);
    ctx.rotate(b - Math.PI / 2);
    ctx.fillStyle = FUR;
    ctx.strokeStyle = FUR_EDGE;
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.ellipse(side * s * 0.06, s * 0.05, s * 0.30, s * 0.19, 0, 0, TAU);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // どう体（シャツ）
  const sh = PROP.shoulder * s;
  const hw = PROP.hip * s;
  ctx.fillStyle = SHIRT;
  ctx.beginPath();
  ctx.moveTo(-sh * 0.70, 0);
  ctx.quadraticCurveTo(-sh * 1.05, s * 0.06, -sh * 0.98, s * 0.34);
  ctx.quadraticCurveTo(-hw * 1.35, hipY * 0.72, -hw * 1.12, hipY);
  ctx.quadraticCurveTo(0, hipY + s * 0.16, hw * 1.12, hipY);
  ctx.quadraticCurveTo(hw * 1.35, hipY * 0.72, sh * 0.98, s * 0.34);
  ctx.quadraticCurveTo(sh * 1.05, s * 0.06, sh * 0.70, 0);
  ctx.quadraticCurveTo(0, s * 0.22, -sh * 0.70, 0);   // えりもと
  ctx.closePath();
  ctx.fill();

  // シャツのすそのかげ
  ctx.fillStyle = SHIRT_DARK;
  ctx.beginPath();
  ctx.moveTo(-hw * 1.12, hipY - s * 0.10);
  ctx.quadraticCurveTo(0, hipY + s * 0.06, hw * 1.12, hipY - s * 0.10);
  ctx.quadraticCurveTo(0, hipY + s * 0.20, -hw * 1.12, hipY - s * 0.10);
  ctx.fill();

  // ズボン
  ctx.fillStyle = SHORTS;
  ctx.beginPath();
  ctx.moveTo(-hw * 1.16, hipY - s * 0.06);
  ctx.quadraticCurveTo(0, hipY + s * 0.14, hw * 1.16, hipY - s * 0.06);
  ctx.lineTo(hw * 1.26, hipY + s * 0.44);
  ctx.quadraticCurveTo(hw * 0.5, hipY + s * 0.30, 0, hipY + s * 0.40);
  ctx.quadraticCurveTo(-hw * 0.5, hipY + s * 0.30, -hw * 1.26, hipY + s * 0.44);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = SHORTS_DARK;
  ctx.beginPath();
  ctx.ellipse(0, hipY + s * 0.36, hw * 0.22, s * 0.07, 0, 0, TAU);
  ctx.fill();
}

/* ---------- 体の手前がわ（うで・そで・手） ---------- */
export function drawBodyFront(ctx, s, rig) {
  const shoulders = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const from = pt(side * PROP.shoulder * s, s * 0.12);
    shoulders.push(from);
    const [a, b] = limbAngles(rig.arms && rig.arms[i], from, PROP.upperArm * s, PROP.foreArm * s, side, s);
    const elbow = move(from, a, PROP.upperArm * s);
    const hand  = move(elbow, b, PROP.foreArm * s);

    stroke3(ctx, from, elbow, hand, PROP.limbW * s * 1.05 + s * 0.04, FUR_EDGE);
    stroke3(ctx, from, elbow, hand, PROP.limbW * s, FUR);

    // 手（肉球の手）
    const handR = (rig.handScale || 1) * PROP.hand * s;
    drawPaw(ctx, hand.x, hand.y, handR, b - Math.PI / 2);
  }

  // そで（シャツの肩）
  ctx.fillStyle = SHIRT;
  for (const p of shoulders) {
    ctx.beginPath();
    ctx.ellipse(p.x * 0.96, p.y + s * 0.06, s * 0.30, s * 0.26, 0, 0, TAU);
    ctx.fill();
  }
}
