// CMPAA-72：深色主题无障碍对比度验证。
// 仅使用 Node 内置模块，直接解析 src/dictionary.css 与相关 TSX 源码，覆盖以下维度：
// 1. 令牌绑定：来源链接、纠错触发/摘要 ghost 控件、correction dialog ghost 按钮
//    等实际选择器必须使用正确的 CSS 自定义属性（防止选择器写死颜色或引用错令牌）；
// 2. dark media 块必须显式覆盖所有在 #292927 surface 上出现的文本令牌
//    （尤其 --dictionary-accent-text，浅色回退值 #0c5799 对比度仅 1.97:1）；
// 3. 每个 dark 文本令牌对 dark surface 的计算对比度必须 >= 4.5:1（WCAG AA 正文级）；
// 4. light（:root）令牌必须保持原值（亮色视觉结构不变）；
// 5. dark surface 必须仍为 #292927（确认未改动其它视觉结构）；
// 6. public props 链路：DictionaryContent 只能 inline 写入 --dictionary-*-custom
//    输入令牌，不得 inline 覆盖语义令牌；.dictionary-content 与 body portal
//    .dictionary-correction 必须在亮色映射语义令牌 <- 输入令牌，
//    且 dark media 对两者显式切换安全深色（不引用输入令牌）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/dictionary.css'), 'utf8');

// --- WCAG 2.x 相对亮度与对比度 -------------------------------------------
const linearize = (channel) => {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const luminance = (hex) => {
  const value = parseInt(hex.slice(1), 16);
  const r = linearize((value >> 16) & 0xff);
  const g = linearize((value >> 8) & 0xff);
  const b = linearize(value & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (foreground, background) => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

// --- 从 CSS 中提取令牌值 ---------------------------------------------------
const escapeName = (name) => name.replace(/-/g, '\\-');
const tokenPattern = (name) => new RegExp(`${escapeName(name)}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`);

// 提取某个块内的令牌值（仅匹配十六进制字面量）
const extractToken = (block, name) => {
  const match = block.match(tokenPattern(name));
  return match ? match[1].toLowerCase() : null;
};

// light :root 块（文件开头、不在任何 @media 内）
const lightBlockMatch = css.match(/:root\s*\{[^}]*\}/);
if (!lightBlockMatch) {
  console.error('FAIL: 未找到 light :root 令牌块');
  process.exit(1);
}
const lightBlock = lightBlockMatch[0];

// dark media 块
const darkMediaMatch = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/);
if (!darkMediaMatch) {
  console.error('FAIL: 未找到 @media (prefers-color-scheme: dark) 块');
  process.exit(1);
}
const darkBlock = darkMediaMatch[1];

// 提取某个选择器（组）对应的全部声明块内容
const extractRuleBlocks = (source, selectorPattern) => {
  const re = new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`, 'g');
  return [...source.matchAll(re)].map((match) => match[1]);
};

// .dictionary-content + .dictionary-correction 共用选择器组（允许空白差异）
const COMPONENT_SELECTOR =
  '(?:\\.dictionary-content\\s*,\\s*\\.dictionary-correction|\\.dictionary-correction\\s*,\\s*\\.dictionary-content)';

// --- 令牌清单 ---------------------------------------------------------------
// 在 #292927 surface 上渲染为文字/图标颜色的全部令牌（含 hover 态）。
// usage 字段仅用于报告可读性。
const TEXT_TOKENS = [
  { name: '--dictionary-accent', usage: '纠错触发按钮 / details 摘要 / ghost 按钮 action 色' },
  { name: '--dictionary-accent-text', usage: '来源链接 / correction dialog ghost 按钮文字' },
  { name: '--dictionary-accent-strong', usage: '上述控件 hover 态文字色' },
  { name: '--dictionary-part-of-speech', usage: '词性标签' },
  { name: '--dictionary-text-primary', usage: '主要文字' },
  { name: '--dictionary-text-secondary', usage: '次要文字 / 图标按钮' },
  { name: '--dictionary-error', usage: '纠错错误提示文字' },
];

// 亮色令牌必须保持原值（亮色视觉结构不允许回归）
const LIGHT_EXPECTED = {
  '--dictionary-accent': '#146ebe',
  '--dictionary-accent-text': '#0c5799',
  '--dictionary-accent-strong': '#0c5799',
  '--dictionary-part-of-speech': '#0c5799',
  '--dictionary-text-primary': '#242320',
  '--dictionary-text-secondary': '#66635f',
  '--dictionary-error': '#b42318',
};

// --- 断言 -------------------------------------------------------------------
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// 1. 选择器 → 令牌绑定（防止选择器写死颜色或引用错令牌）
const selectorBindings = [
  {
    label: '来源链接使用 --dictionary-accent-text',
    pattern:
      /\.dictionary-popover__source-heading a\s*\{[^}]*color:\s*var\(--dictionary-accent-text\)/,
  },
  {
    label: '纠错触发/摘要 ghost 控件使用 --dictionary-accent',
    pattern:
      /\.dictionary-popover__correction-trigger,\s*\n\.dictionary-correction-details__summary\s*\{[^}]*color:\s*var\(--dictionary-accent\)/,
  },
  {
    label: '纠错触发/摘要 hover 使用 --dictionary-accent-strong',
    pattern:
      /\.dictionary-popover__correction-trigger:hover,\s*\n\.dictionary-correction-details__summary:hover\s*\{[^}]*color:\s*var\(--dictionary-accent-strong\)/,
  },
  {
    label: 'correction dialog ghost 按钮文字色映射 --dictionary-accent-text',
    pattern:
      /\.dictionary-correction \.hn-button\.hn-button--ghost\s*\{[^}]*--hn-button-ghost-color:\s*var\(--dictionary-accent-text\)/,
  },
  {
    label: 'correction dialog ghost 按钮 action 色映射 --dictionary-accent',
    pattern:
      /\.dictionary-correction \.hn-button\.hn-button--ghost\s*\{[^}]*--hn-button-action-color:\s*var\(--dictionary-accent\)/,
  },
  {
    label: 'correction dialog ghost 按钮 hover 映射 --dictionary-accent-strong',
    pattern:
      /\.dictionary-correction \.hn-button\.hn-button--ghost\s*\{[^}]*--hn-button-action-hover-color:\s*var\(--dictionary-accent-strong\)/,
  },
  {
    label: '词性标签使用 --dictionary-part-of-speech',
    pattern:
      /\.dictionary-popover__part-of-speech\s*\{[^}]*color:\s*var\(--dictionary-part-of-speech\)/,
  },
];

for (const { label, pattern } of selectorBindings) {
  check(label, pattern.test(css));
}

// 2. light 令牌保持原值
for (const [name, expected] of Object.entries(LIGHT_EXPECTED)) {
  const actual = extractToken(lightBlock, name);
  check(`light 令牌保持原值 ${name}`, actual === expected, `${name} (light) = ${actual}`);
}

// 3. dark surface 未被改动
const darkSurface = extractToken(darkBlock, '--dictionary-surface');
check(
  'dark surface 未被改动',
  darkSurface === '#292927',
  `--dictionary-surface (dark) = ${darkSurface}`,
);

// 4. dark 显式覆盖所有文本令牌，且对比度 >= 4.5:1
if (darkSurface !== null) {
  for (const { name, usage } of TEXT_TOKENS) {
    const darkValue = extractToken(darkBlock, name);
    check(
      `dark media 存在 ${name} 覆盖`,
      darkValue !== null,
      darkValue ? `${usage}：dark override = ${darkValue}` : `${usage}：dark 块内未找到该令牌`,
    );
    if (darkValue !== null) {
      const ratio = contrastRatio(darkValue, darkSurface);
      check(
        `dark 对比度 >= 4.5:1 ${name}`,
        ratio >= 4.5,
        `${darkValue} on ${darkSurface} = ${ratio.toFixed(3)}:1（${usage}）`,
      );
    }
  }
  // 顺带报告修复前的旧值对比度，便于审查留档
  console.log(
    `INFO  修复前 #0c5799 on ${darkSurface} = ${contrastRatio('#0c5799', darkSurface).toFixed(3)}:1`,
  );
}

// --- 5. public props 只写输入令牌，不 inline 覆盖语义令牌 --------------------
// public props（themeColor/textColor）派生的语义令牌集合：这些名字一旦被
// inline 写入就会压过 dark media 的 :root / 组件级覆盖，必须只能以
// --dictionary-*-custom 输入令牌形式出现在 inline style 中。
const SEMANTIC_CUSTOMIZABLE_TOKENS = [
  '--dictionary-accent',
  '--dictionary-accent-soft',
  '--dictionary-accent-strong',
  '--dictionary-accent-text',
  '--dictionary-focus',
  '--dictionary-text-primary',
  '--dictionary-text-secondary',
];

const contentSource = readFileSync(join(root, 'src/DictionaryContent.tsx'), 'utf8');

for (const name of SEMANTIC_CUSTOMIZABLE_TOKENS) {
  // 匹配 inline 对象字面量中的语义令牌键（'--dictionary-accent':），
  // --dictionary-accent-custom 因引号位置不同不会被误伤
  const inlineKey = new RegExp(`['"]${escapeName(name)}['"]\\s*:`);
  check(`DictionaryContent 不 inline 覆盖语义令牌 ${name}`, !inlineKey.test(contentSource));
}

// 亮色 prop 路径仍然绑定：props 必须写入输入令牌
check(
  'themeColor 仍绑定 --dictionary-accent-custom 输入令牌',
  /'--dictionary-accent-custom':\s*themeColor/.test(contentSource),
);
check(
  'textColor 仍绑定 --dictionary-text-primary-custom 输入令牌',
  /'--dictionary-text-primary-custom':\s*textColor/.test(contentSource),
);

// portal 不把危险语义 inline variables 传入：themeStyle 来源就是上面的
// contentStyle，因此再确认 portal 宿主仍把 themeStyle 应用到 .dictionary-correction
const dialogSource = readFileSync(join(root, 'src/DictionaryModalDialog.tsx'), 'utf8');
check(
  'portal .dictionary-correction 仍接收 themeStyle（输入令牌通道）',
  /<div className="dictionary-correction" style=\{themeStyle\}>/.test(dialogSource),
);

// --- 6. 组件级语义令牌：亮色映射输入令牌，深色显式安全覆盖 -------------------
// 组件级令牌 = public props 可定制的语义令牌（.dictionary-content 与
// body portal .dictionary-correction 都必须覆盖，兼容独立渲染与 portal）。
const COMPONENT_LIGHT_FALLBACKS = {
  '--dictionary-accent': '#146ebe',
  '--dictionary-accent-soft': '#e8f2fb',
  '--dictionary-accent-strong': '#0c5799',
  '--dictionary-accent-text': '#0c5799',
  '--dictionary-text-primary': '#242320',
  '--dictionary-text-secondary': '#66635f',
  '--dictionary-focus': '#097fe8',
};

const componentBlocks = extractRuleBlocks(css, COMPONENT_SELECTOR);
// 亮色映射块：语义令牌引用 --dictionary-*-custom 输入令牌并回退到 light 原值
const lightMappingBlocks = componentBlocks.filter((block) =>
  block.includes('--dictionary-accent-custom'),
);
check(
  '存在 .dictionary-content/.dictionary-correction 亮色输入令牌映射块',
  lightMappingBlocks.length > 0,
);
if (lightMappingBlocks.length > 0) {
  const mapping = lightMappingBlocks[0];
  for (const [name, fallback] of Object.entries(COMPONENT_LIGHT_FALLBACKS)) {
    const mappingPattern = new RegExp(
      `${escapeName(name)}\\s*:\\s*var\\(\\s*${escapeName(name)}-custom\\s*,\\s*${fallback}\\s*\\)`,
    );
    check(`亮色映射 ${name} <- ${name}-custom（回退 ${fallback}）`, mappingPattern.test(mapping));
  }
}

// 深色覆盖块：位于 dark media 内、对组件级语义令牌给出安全深色，
// 且不得引用 --dictionary-*-custom 输入令牌（否则 inline 输入仍会渗透进来）
const darkComponentBlocks = extractRuleBlocks(darkBlock, COMPONENT_SELECTOR);
check(
  'dark media 存在 .dictionary-content/.dictionary-correction 组件级覆盖块',
  darkComponentBlocks.length > 0,
);
if (darkComponentBlocks.length > 0) {
  const darkComponent = darkComponentBlocks[0];
  check('dark 组件级覆盖不引用 --dictionary-*-custom 输入令牌', !/-custom/.test(darkComponent));
  if (darkSurface !== null) {
    // accent-soft 是背景/焦点环底色，不作为文字色，不参与对比度断言
    const COMPONENT_CONTRAST_TOKENS = Object.keys(COMPONENT_LIGHT_FALLBACKS).filter(
      (name) => name !== '--dictionary-accent-soft',
    );
    for (const name of Object.keys(COMPONENT_LIGHT_FALLBACKS)) {
      const darkValue = extractToken(darkComponent, name);
      check(
        `dark 组件级覆盖存在 ${name}`,
        darkValue !== null,
        darkValue ? `dark override = ${darkValue}` : 'dark 组件级块内未找到该令牌',
      );
      if (darkValue !== null && COMPONENT_CONTRAST_TOKENS.includes(name)) {
        const ratio = contrastRatio(darkValue, darkSurface);
        check(
          `dark 组件级对比度 >= 4.5:1 ${name}`,
          ratio >= 4.5,
          `${darkValue} on ${darkSurface} = ${ratio.toFixed(3)}:1`,
        );
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} 项检查未通过`);
  process.exit(1);
}
console.log('\n全部检查通过');
