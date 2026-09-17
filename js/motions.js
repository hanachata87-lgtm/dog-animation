/* ============================================================
   motions.js
   「動きの種類」を1つの関数にまとめたもの。
   pose(p) の p は 0〜1 のくり返し位置（0が始まり、1で1周）。
   戻り値:
     lift : 0〜1 …… ジャンプの高さの割合
     sx,sy: 1が等倍 …… つぶれ／のび（足もとを軸にする）
     rot  : ラジアン …… かたむき
     dx   : 0〜1 …… 横ゆれ（画面幅に対する割合）
   新しい動きは、ここに追加していけば他を触らずに増やせる。
   ============================================================ */

const TAU = Math.PI * 2;

/** ぴょこぴょこ：着地でつぶれ、空中でのびながらはねる */
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

export const MOTIONS = {
  pyoko: {
    label: 'ぴょこぴょこ',
    pose: pyoko,
    hopHeight: 0.30,      // 画面の高さに対するジャンプの高さ
    defaultDuration: 800, // 1周にかかるミリ秒
  },
};

export function getMotion(name) {
  return MOTIONS[name] || MOTIONS.pyoko;
}
