# @hamster-note/dictionary

仓鼠笔记的 React 19 词典悬浮窗组件，使用 TypeScript 6 与 Vite 8 构建。

## 特性

- 可控的 `open` 状态，便于接入选词、搜索或编辑器交互。
- 支持多个释义、词性、例句、音标与来源。
- 内置浅色、深色、键盘焦点与减少动态效果适配。
- 组件源码与 Demo 分离，npm 构建输出到 `dist/`，Pages Demo 输出到 `demo-dist/`。

## 安装

```bash
yarn add @hamster-note/dictionary react react-dom
```

## 使用

```tsx
import { DictionaryPopover } from '@hamster-note/dictionary';
import '@hamster-note/dictionary/style.css';

export function Example() {
  return (
    <DictionaryPopover
      meanings={[
        {
          id: 'record',
          partOfSpeech: 'noun',
          definition: 'A short written record that helps you remember something.',
        },
      ]}
      onClose={() => undefined}
      open
      phonetic="/noʊt/"
      word="note"
    />
  );
}
```

`meanings` 是非空元组类型，每个释义需要稳定的 `id`，以保证列表更新时保留正确的 React
身份。

## 开发命令

| 命令              | 说明                                        |
| ----------------- | ------------------------------------------- |
| `yarn dev`        | 在 `0.0.0.0:9489` 启动 Demo，支持局域网访问 |
| `yarn build`      | 构建组件库、类型声明和 Pages Demo           |
| `yarn build:lib`  | 仅构建组件库到 `dist/`                      |
| `yarn build:demo` | 仅构建 Demo 到 `demo-dist/`                 |
| `yarn preview`    | 在 `0.0.0.0:9489` 预览生产版 Demo           |
| `yarn typecheck`  | 运行 TypeScript 项目引用检查                |
| `yarn lint`       | 运行 ESLint，警告也视为失败                 |
| `yarn format`     | 使用 Prettier 格式化项目                    |
| `yarn run check`  | 执行格式、Lint、类型与完整构建门禁          |

## GitHub Pages

推送 `main` 分支后，`.github/workflows/deploy-demo.yml` 会构建并发布 Demo：

<https://hamsternote.github.io/dictionary/>

## License

MIT，详见 [LICENSE](./LICENSE)。
