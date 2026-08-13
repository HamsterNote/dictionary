# 第三方数据与软件声明

## ECDICT 英汉词典数据

- 项目地址：https://github.com/skywind3000/ECDICT
- 本项目用途：从 ECDICT commit `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b` 的 `ecdict.csv` 中生成 5,000 词高频核心，中考（`zk`）、高考（`gk`）、CET-4（`cet4`）、CET-6（`cet6`）、考研（`ky`）、IELTS（`ielts`）、TOEFL（`toefl`）、GRE（`gre`）八个可选标签词包，以及 `bnc > 0` 的 BNC 排名词包。所有可选包均剔除核心重复项，未打包 ECDICT 全库。
- 输入快照 SHA-256：`1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf`。
- 可复现生成器：`scripts/generate_ecdict.py`。生成器保留 ECDICT 的中文释义、音标和考试标签，未进行人工改写；ECDICT 不含 TEM-4/TEM-8 标签，本项目因此不提供专四、专八包。
- BNC 字段表示 British National Corpus 词频排名，数值越小越常用。ECDICT 未披露该派生排名的完整授权链；BNC 语料本身受其权利方条款约束，商业分发前需单独审核。
- ECDICT 曾声明收录《屌丝字典》英汉部分，但当前 CSV 不保留逐条来源，无法从 ECDICT 可靠反向提取；原始 `fxsjy/diaosi` 仓库又未声明许可证，因此本项目暂不提供屌丝字典包。
- ECDICT 仓库许可证：MIT，详见其仓库中的 `LICENSE`。
- ECDICT 作者关于商用的说明：https://github.com/skywind3000/ECDICT/issues/43

### 审核提示

ECDICT 项目自身采用 MIT 许可证，但其文档说明数据曾参考或整合多个外部词典与网站。仓库级 MIT 声明不一定能消除每条数据的上游权利风险。本项目目前无法逐条追溯这部分高频数据的最初来源，因此不应将该数据集描述为“商用零风险”。在闭源商业产品正式发布前，建议由法务审核 ECDICT 的数据来源说明，或替换为具备逐条来源与清晰授权链的数据。

### ECDICT MIT 许可原文

```text
MIT License

Copyright (c) 2025 Linwei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## @system-ui-js/multi-drag

- 项目地址：https://github.com/SystemUI-js/multi-drag
- npm：https://www.npmjs.com/package/@system-ui-js/multi-drag
- 使用版本：`0.4.0`
- 许可证：MIT

该 npm 包声明为 MIT，但 `0.4.0` 发布包和仓库目前未提供可核验的独立 LICENSE 文本；商用发布前建议向上游确认完整版权与许可文本。本项目将该包作为运行依赖交由包管理器安装，不把其实现代码内联进本组件库产物。其运行依赖如下：

- `@system-ui-js/multi-drag-core@0.4.0`：项目地址 https://github.com/SystemUI-js/multi-drag-core ，npm 元数据声明 MIT；发布包同样未提供可核验的独立 LICENSE 文本。
- `loglevel@1.9.2`：项目地址 https://github.com/pimterry/loglevel ，MIT，Copyright (c) 2013 Tim Perry。完整许可文本见其仓库 `LICENSE-MIT`。
