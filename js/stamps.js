// スタンプのデザイン（すべてこのアプリ用のオリジナル SVG）。
// Raz-Kids の「読む・聞く・クイズ」などの学習の流れをモチーフにしている。
// 公式キャラクターやアニメ画像は著作権があるため、配布するアプリには入れない。

/** 花丸の外側の花びら（波形の輪）を作る */
function hanamaruPetals(cx, cy, r, n) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    d += `${i === 0 ? `M${x0.toFixed(1)} ${y0.toFixed(1)}` : ''} A${(r * 0.32).toFixed(1)} ${(r * 0.32).toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} `;
  }
  return `${d}Z`;
}

const ICONS = {
  // 開いた本
  read: `
    <path d="M50 30 C42 24 31 24 25 26 V53 C31 51 42 51 50 57 C58 51 69 51 75 53 V26 C69 24 58 24 50 30 Z"
      fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
    <path d="M50 30 V57" stroke="currentColor" stroke-width="3"/>
    <path d="M31 33 H44 M31 39 H44 M31 45 H41 M56 33 H69 M56 39 H69 M56 45 H66"
      stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,

  // ヘッドホンと音符
  listen: `
    <path d="M29 50 V43 a21 21 0 0 1 42 0 V50" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
    <rect x="24" y="44" width="11" height="16" rx="4" fill="currentColor"/>
    <rect x="65" y="44" width="11" height="16" rx="4" fill="currentColor"/>
    <path d="M47 51 V36 L57 33 V47" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
    <ellipse cx="44.5" cy="51.5" rx="3.5" ry="2.8" fill="currentColor"/>
    <ellipse cx="54.5" cy="47.5" rx="3.5" ry="2.8" fill="currentColor"/>`,

  // 花丸（クイズ満点）
  perfect: `
    <path d="${hanamaruPetals(50, 41, 18, 9)}" fill="currentColor" fill-opacity=".12"
      stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M50 41 m-2 0 a2 2 0 1 1 4 0 a5 5 0 1 1 -10 0 a8.5 8.5 0 1 1 17 0 a12 12 0 0 1 -12 12"
      fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>`,

  // ロケット（レベルアップへ発射！）
  rocket: `
    <path d="M50 20 C61 28 63 42 59 54 H41 C37 42 39 28 50 20 Z" fill="currentColor" fill-opacity=".14"
      stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="50" cy="36" r="5.5" fill="none" stroke="currentColor" stroke-width="2.8"/>
    <path d="M41.5 44 L33 55 L41 54 Z M58.5 44 L67 55 L59 54 Z" fill="currentColor" stroke="currentColor"
      stroke-width="2" stroke-linejoin="round"/>
    <path d="M45 56 Q50 68 55 56 Z" fill="currentColor"/>
    <path d="M28 28 l1.5 3 3 1.5 -3 1.5 -1.5 3 -1.5 -3 -3 -1.5 3 -1.5 Z M72 30 l1 2 2 1 -2 1 -1 2 -1 -2 -2 -1 2 -1 Z"
      fill="currentColor"/>`,

  // オリジナルのネコキャラ（アニメ風の大きな目）
  cat: `
    <path d="M32 38 L33 21 L45 30 M68 38 L67 21 L55 30" fill="currentColor" fill-opacity=".14"
      stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="50" cy="42" rx="20" ry="16" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="3"/>
    <ellipse cx="42.5" cy="41" rx="3.6" ry="5" fill="currentColor"/>
    <ellipse cx="57.5" cy="41" rx="3.6" ry="5" fill="currentColor"/>
    <circle cx="43.6" cy="39" r="1.4" fill="#fff"/>
    <circle cx="58.6" cy="39" r="1.4" fill="#fff"/>
    <path d="M46.5 48 q1.75 2.2 3.5 0 q1.75 2.2 3.5 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <ellipse cx="37" cy="47" rx="3" ry="1.8" fill="currentColor" fill-opacity=".35"/>
    <ellipse cx="63" cy="47" rx="3" ry="1.8" fill="currentColor" fill-opacity=".35"/>
    <path d="M24 42 H32 M24 47 L32 45.5 M76 42 H68 M76 47 L68 45.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
};

export const STAMP_DESIGNS = [
  { id: 'read', name: 'よんだ！', label: 'READ!', color: '#e4572e' },
  { id: 'listen', name: 'きいた！', label: 'LISTEN', color: '#2b6cb0' },
  { id: 'perfect', name: 'クイズ満点', label: 'PERFECT', color: '#d53f8c' },
  { id: 'rocket', name: 'レベルアップ', label: 'BLAST OFF', color: '#805ad5' },
  { id: 'cat', name: 'ネコ先生', label: 'GOOD JOB', color: '#c27c0e' },
];

export const DEFAULT_STAMP = STAMP_DESIGNS[0].id;

export function getDesign(id) {
  return STAMP_DESIGNS.find((d) => d.id === id) ?? null;
}

/** スタンプの SVG 要素を作る（中身は上の固定データだけで、ユーザー入力は含まない） */
export function stampSvg(id) {
  const design = getDesign(id);
  if (!design) return null;
  const fontSize = design.label.length > 7 ? 9.5 : 11;
  const tpl = document.createElement('template');
  tpl.innerHTML = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${design.name}">
      <circle cx="50" cy="50" r="46" fill="#fff" fill-opacity=".85"/>
      <circle cx="50" cy="50" r="46" fill="currentColor" fill-opacity=".06" stroke="currentColor" stroke-width="4"/>
      <circle cx="50" cy="50" r="40.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
      ${ICONS[design.id]}
      <rect x="15" y="64" width="70" height="16" rx="4" fill="currentColor"/>
      <text x="50" y="75.8" text-anchor="middle" font-size="${fontSize}" font-weight="900" fill="#fff"
        font-family="system-ui, -apple-system, 'Arial Rounded MT Bold', sans-serif" letter-spacing=".4">${design.label}</text>
    </svg>`;
  return tpl.content.firstElementChild;
}

// ---- おくすり（連続記録の救済アイテム）----

/** カプセルの絵（中心 32,32・64 四方）。左右2色＋ハイライト */
const CAPSULE = `
  <g transform="rotate(-40 32 32)">
    <path d="M18 22 H32 V42 H18 a10 10 0 0 1 0 -20 Z" fill="#ec5f8a"/>
    <path d="M32 22 H46 a10 10 0 0 1 0 20 H32 Z" fill="#ffffff"/>
    <rect x="8" y="22" width="48" height="20" rx="10" fill="none" stroke="#8a2448" stroke-width="2.6"/>
    <path d="M32 22 V42" stroke="#8a2448" stroke-width="2.2"/>
    <path d="M14 27.5 H27" stroke="#fff" stroke-opacity=".75" stroke-width="3" stroke-linecap="round"/>
    <path d="M37 27.5 H50" stroke="#f3c6d5" stroke-width="3" stroke-linecap="round"/>
  </g>`;

export const RESCUE_COLOR = '#2c9a6a';

function svgFrom(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild;
}

/** もちもの欄などで使うカプセル単体のアイコン */
export function capsuleSvg(label = 'おくすり') {
  return svgFrom(`<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">${CAPSULE}</svg>`);
}

/** カレンダーなどに表示する「おくすりで救済した日」のスタンプ */
export function rescueStampSvg() {
  return svgFrom(`
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="おくすりで救済">
      <circle cx="50" cy="50" r="46" fill="#fff" fill-opacity=".85"/>
      <circle cx="50" cy="50" r="46" fill="currentColor" fill-opacity=".06" stroke="currentColor" stroke-width="4" stroke-dasharray="7 4"/>
      <g transform="translate(22 12) scale(.875)">${CAPSULE}</g>
      <rect x="15" y="64" width="70" height="16" rx="4" fill="currentColor"/>
      <text x="50" y="75.8" text-anchor="middle" font-size="11" font-weight="900" fill="#fff"
        font-family="system-ui, -apple-system, sans-serif" letter-spacing=".4">SAFE!</text>
    </svg>`);
}
