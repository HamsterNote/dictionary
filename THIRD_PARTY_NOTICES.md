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

## Open American National Corpus（OANC）例句

- 项目与数据说明：https://anc.org/data/OANC/
- 下载说明：https://anc.org/data/oanc/download/
- 输入快照：`https://www.anc.org/OANC/OANC_GrAF.zip`，上游标注时间为 2011-07-16。
- 输入快照 SHA-256：`5a26559a1becba41a527cb674fff4fb9c4fb70b276f60422c4f07a0ef23fd867`。
- 本项目用途：依据 OANC GrAF `-s.xml` 的句界字符偏移，从对应 UTF-8 原文提取句子，再按高频核心与九个英文词包分别生成可选例句补充包。生成器过滤 URL、邮箱、过短、过长及低英文字符比例内容，执行完整词形匹配和去重，每个词最多保留 2 条，不人工改写或伪造缺失例句。
- 可复现生成器与测试：`scripts/generate_oanc_examples.py`、`scripts/test_generate_oanc_examples.py`。原始约 625 MiB ZIP 不随 npm 包或源码仓库分发。
- OANC 官网声明该开放子语料在使用和再分发方面不受限制，可自由用于研究、开发及商业开发，并鼓励使用者回馈派生资源和修正。该声明针对 OANC，不应与许可条件不同的 ANC Second Release 混淆。

### OANC 审核提示

OANC 下载 ZIP 内未发现独立的 `LICENSE`、`COPYING` 或逐篇许可清单，本项目依据其官方网站的开放使用与再分发声明进行分发。语料由多种体裁和来源组成，例句仍可能包含原文中的专名、观点、转录噪声或自动句界错误；自动筛选不能替代逐条内容审核。对许可链、人格权、敏感内容或特定司法辖区有更严格要求的商业产品，应在发布前保存官网声明快照并进行法务及内容复核。

## chinese-xinhua 中文词典数据

- 项目地址：https://github.com/pwxcoo/chinese-xinhua
- 固定快照：commit `fe6d6c2e8baa82187f4c96bbe042e43f96c05666`。
- 本项目用途：使用 `data/word.json` 中有有效释义的汉字和 `data/idiom.json` 中有有效释义的成语，按词头去重后生成 45,705 条记录；另将 `data/ci.json` 生成为独立的 `chinese-xinhua-words` 词语包，规范化词头并合并重复释义后包含 264,346 条记录。未打包歇后语等其他文件。
- 输入 SHA-256：`word.json` 为 `8ae3453eacc5b0f3fdfba47eac8bb686cd73914d278e8b851ae6ef81082f80e7`；`idiom.json` 为 `1d4b4f454ce1c416d6a1ab2369d6e66c0ff99e04390172eef70790499e21ce19`；`ci.json` 为 `739e086d61dc9b95cd1df92095720e6391f952a41c476d3281ef95ebed869a09`。
- 可复现生成器：`scripts/generate_chinese_dictionaries.py`。生成器对词头执行 NFKC 规范化，合并重复词头的完整拼音变体和释义，保留出处、例句以及可用的笔画和部首信息，并压缩为独立按需加载 TSV。
- 仓库许可证：MIT。上游版权与完整许可文本附于本节末尾。

### chinese-xinhua 审核提示

固定快照中的 `word.py`、`chengyu.py` 与 `ci.py` 抓取脚本均指向 `zd9999.com`，其中 `ci.py` 从 `http://www.zd9999.com/ci/` 的索引和词语详情页采集本项目打包的 `data/ci.json` 内容；本项目没有证据把本次采用的汉字、成语或词语快照归因于 `5156edu.com`。上游仓库采用 MIT，并表示若内容侵权会删除，但这不能自动覆盖第三方网站对词典内容可能拥有的权利。基于这些可核验事实，本项目将授权链不完整视为分发风险，而不是转述上游作出的“不可商用”声明。商业发布前应取得数据权利确认、完成法务审核，或替换为授权链清晰的数据源。

Copyright (c) 2018 PWXCOO

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## chinese-dictionary 中文词典数据

- 项目地址：https://github.com/mapull/chinese-dictionary
- 固定快照：commit `e804ada333b68afddfdccbe8dcc938a72da157a7`。
- 本项目用途：使用 `character/common/char_common_base.json` 与 `character/common/char_common_detail.json` 生成 3,500 个常用汉字；另将 `word/word.json` 生成为独立的 `chinese-dictionary-words` 词语包，规范化词头并合并重复拼音与释义后包含 304,196 条记录。未打包上游 2 万余字全量或单独的成语文件。
- 输入 SHA-256：基础文件为 `88fa110d0c708af8ae43f19537ac453ebe1b40ae02c738a7578498505eb771ab`；详情文件为 `100f3d9557016be9fe3e893d3dad9d7756d852033b9514a85fa5d1d214a8004d`；`word/word.json` 为 `a85d96a3c6e55e831406b534b533ab4641176fdd80ac7dceaeb5af9bed333c58`。
- 可复现生成器：`scripts/generate_chinese_dictionaries.py`。生成器解析上游每行带尾逗号的非标准 NDJSON，合并基础信息、拼音与释义后生成独立按需加载 TSV。
- 仓库许可证：MIT。上游版权与完整许可文本附于本节末尾。

### chinese-dictionary 审核提示

上游 README 将汇总结果标为 MIT，同时列出 chinese-xinhua、CC-CEDICT、汉典、字海等混合来源，并明确承认部分来源无法确认。CC-CEDICT 使用 CC BY-SA 4.0；其他站点数据的逐条来源和许可链也未在本项目使用的快照中标注。本项目无法将每条释义可靠映射回具体来源，因此不能断言仓库级 MIT 许可覆盖全部词典内容，也不能确认当前紧凑 TSV 是否触发署名、相同方式共享或其他上游义务。这是本项目依据可核验材料作出的风险判断，不是对上游 README 的“仅供学习研究”转述。商业分发前应由法务逐项审核并补齐必要的署名与许可文本，或改用来源可追溯的数据。

Copyright (c) 2021 码谱

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Princeton WordNet 英文近义词数据

- 项目地址：https://wordnet.princeton.edu/
- 许可与商用说明：https://wordnet.princeton.edu/license-and-commercial-use
- 输入快照：`https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz`
- 输入快照 SHA-256：`3f7d8be8ef6ecc7167d39b10d66954ec734280b5bdcd57f7d9eafe429d11c22a`
- 本项目用途：从 WordNet 3.1 的名词、动词、形容词和副词 synset 中提取与内置核心及九个英文词包相交的同义词，生成按需加载的补充数据块。

WordNet 官网明确说明其可依照许可证用于商业应用，并建议由代表商业利益的律师结合预期用途审核许可。许可允许免费使用、复制、修改和分发软件、数据库及文档，但要求在所有副本及修改中保留版权声明、许可条件和免责声明；不得使用 Princeton University 或 Princeton 的名称为分发内容进行广告或宣传。

WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.

Permission to use, copy, modify and distribute this software and database and its documentation for any purpose and without fee or royalty is hereby granted, provided that you agree to comply with the following copyright notice and statements, including the disclaimer, and that the same appear on ALL copies of the software, database and documentation, including modifications that you make for internal use or for distribution.

WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.

THIS SOFTWARE AND DATABASE IS PROVIDED “AS IS” AND PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.

The name of Princeton University or Princeton may not be used in advertising or publicity pertaining to distribution of the software and/or database. Title to copyright in this software, database and any associated documentation shall at all times remain with Princeton University and LICENSEE agrees to preserve same.

商业分发前应保留以上 WordNet 许可声明，并由法务根据实际产品与分发方式复核。

## UniMorph / MorphyNet 英语派生关系数据

- 项目地址：https://github.com/unimorph/eng
- 固定快照：commit `66e0e9e8e2dcd196da081a25a48e5c1fe3d8b49b`。
- 输入文件：`eng.derivations.tsv`；SHA-256 为 `743fff8ddb3ff26ae413af1fa859806106ffff69628be4cb7ed4d34f677deed2`。
- 本项目用途：从 MorphyNet 派生关系提取派生词、基词、词缀和源/目标词性，与高频核心及九个英文词包求交后，生成十个独立懒加载包。界面称其为“派生基词”；它表达构词关系，不是历史语言学意义上的词源学词根。
- 可复现生成器与测试：`scripts/generate_unimorph_roots.py`、`scripts/test_generate_unimorph_roots.py`。
- 许可证：Creative Commons Attribution-ShareAlike 3.0（CC BY-SA 3.0），许可证全文：https://creativecommons.org/licenses/by-sa/3.0/ 。

分发该数据或改编数据库时，须给予适当署名、提供许可证链接、说明所作修改，并依 CC BY-SA 3.0 以相同方式共享改编内容。商业使用并不免除这些义务；正式发布前应结合产品的数据组合与数据库权利适用方式进行法务审核。

## Wiktionary 英语音标派生数据

- 原始资料与贡献者：https://en.wiktionary.org/ ，署名归 Wiktionary 贡献者。
- Kaikki 原始数据页：https://kaikki.org/dictionary/rawdata.html
- 输入快照：`https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz`，来自 2026-08-05 enwiktionary dump，于 2026-08-28 使用 `wiktextract@872fc7b` 抽取；输入 SHA-256 记录于生成器、TSV 头与清单。
- 本项目修改：只保留与十个 ECDICT 词包相交的词头，按 NFKC 与小写规则匹配，合并多词性记录，过滤地区、时代、语域及未知标签，并将明确英式、明确美式和通用 IPA 确定性映射为英音/美音列。
- 可复现生成器：`scripts/generate_wiktionary_phonetics.py`。
- 许可证：本项目派生的音标 TSV 数据与其打包 chunk 采用 Creative Commons Attribution-ShareAlike 3.0（CC BY-SA 3.0），许可证全文见 `LICENSES/CC-BY-SA-3.0.txt` 及 https://creativecommons.org/licenses/by-sa/3.0/ 。项目 MIT 许可证仅覆盖代码，不覆盖这些派生数据。

Kaikki 当前说明其数据从 Wiktionary 抽取，并按 Wiktionary 的 CC-BY-SA 与 GFDL 许可提供。本项目选择以 CC BY-SA 3.0 分发上述派生数据；再分发或改编时须保留对 Wiktionary 贡献者的适当署名、许可证链接和修改说明，并按相同方式共享适用的改编内容。npm 包中数据 chunk 与其他代码的组合可能涉及数据库权利及 share-alike 边界；本声明不代表已免除全部许可义务，正式商业发布前仍须由法务结合具体产品与分发方式复核。

### CityLex 使用边界

- 项目地址：https://github.com/CUNY-CL/citylex
- CityLex 代码采用 Apache License 2.0，但它是聚合词汇资源的生成工具，不是许可统一的派生词根数据集。
- CityLex 可聚合的来源包含 CC BY-NC、GPL 及专有授权内容。为避免把非商业、传染性或专有数据混入 npm 发布物，本项目只允许在生成时把用户提供的本地 CityLex 词表用于覆盖率统计；CityLex 不参与筛选或生成任何发布记录，其词表内容不会写入源码、构建产物或 npm 包。

## @system-ui-js/multi-drag

- 项目地址：https://github.com/SystemUI-js/multi-drag
- npm：https://www.npmjs.com/package/@system-ui-js/multi-drag
- 使用版本：`0.4.0`
- 许可证：MIT

该 npm 包声明为 MIT，但 `0.4.0` 发布包和仓库目前未提供可核验的独立 LICENSE 文本；商用发布前建议向上游确认完整版权与许可文本。当前组件库构建会将该包及其运行依赖实现内联进发布产物，因此分发组件库时也应一并处理这些声明：

- `@system-ui-js/multi-drag-core@0.4.0`：项目地址 https://github.com/SystemUI-js/multi-drag-core ，npm 元数据声明 MIT；发布包同样未提供可核验的独立 LICENSE 文本。
- `loglevel@1.9.2`：项目地址 https://github.com/pimterry/loglevel ，MIT，Copyright (c) 2013 Tim Perry。完整许可文本见其仓库 `LICENSE-MIT`。

## Kokoro 浏览器语音合成

- 项目地址：https://github.com/hexgrad/kokoro
- npm：https://www.npmjs.com/package/kokoro-js
- 使用版本：`kokoro-js@1.2.1`
- 许可证：Apache License 2.0
- 本项目用途：仅在消费者显式启用并首次点击英文朗读按钮后，于 module Worker 中加载浏览器版 Kokoro，使用 WASM 和 q8 权重生成英文单词语音。

`kokoro-js` 的直接运行依赖包括 `@huggingface/transformers` 与 `phonemizer`，二者均声明为 Apache License 2.0。完整版权声明和许可文本随各 npm 发布包提供；分发本组件及其依赖时应保留相应 NOTICE 与 LICENSE 条款。

## Kokoro-82M-v1.0-ONNX 模型

- 模型地址：https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
- 上游模型：https://huggingface.co/hexgrad/Kokoro-82M
- 许可证：Apache License 2.0
- 本项目用途：运行时按需下载 q8 ONNX 权重，不把模型文件打包进 npm 产物。

模型卡说明该模型仅支持英文，并列出其训练数据、使用限制和潜在偏差。宿主产品在公开或商业部署前应复核模型卡和 Apache License 2.0 条款；本项目不对生成语音的准确性、口音或特定用途适用性作保证。
