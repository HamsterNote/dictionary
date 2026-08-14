import type { DictionaryPackId } from './dictionaryPacks';
import { DICTIONARY_PACK_GROUPS, isDictionaryPackId } from './dictionaryPacks';

type DataSourceId =
  'chinese-dictionary' | 'chinese-xinhua' | 'ecdict' | 'oanc' | 'unimorph' | 'wordnet';

interface DataSourceNotice {
  readonly id: DataSourceId;
  readonly text: string;
}

const ECDICT_NOTICE = `## ECDICT 英汉词典数据

项目地址：https://github.com/skywind3000/ECDICT
固定快照：commit bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b
本项目用途：内置 5,000 词高频核心，并按需提供分级词包、词形变化数据及变形词反向查询索引。

审核提示：ECDICT 项目自身采用 MIT 许可证，但其文档说明数据曾参考或整合多个外部词典与网站。仓库级 MIT 声明不一定能消除每条数据的上游权利风险。BNC 派生排名的完整授权链亦未披露。闭源商业产品正式发布前，应审核数据来源说明及 BNC 条款，或替换为授权链清晰的数据。

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
SOFTWARE.`;

const OANC_NOTICE = `## Open American National Corpus（OANC）例句

项目与数据说明：https://anc.org/data/OANC/
下载说明：https://anc.org/data/oanc/download/
输入快照：https://www.anc.org/OANC/OANC_GrAF.zip（上游标注时间 2011-07-16）

OANC 官网声明该开放子语料在使用和再分发方面不受限制，可自由用于研究、开发及商业开发，并鼓励使用者回馈派生资源和修正。该声明针对 OANC，不应与许可条件不同的 ANC Second Release 混淆。

审核提示：OANC 下载 ZIP 内未发现独立的 LICENSE、COPYING 或逐篇许可清单。本项目依据其官方网站的开放使用与再分发声明进行分发。语料由多种体裁和来源组成；对许可链、人格权、敏感内容或特定司法辖区有更严格要求的商业产品，应保存官网声明快照，并在发布前进行法务及内容复核。`;

const WORDNET_NOTICE = `## Princeton WordNet 英文近义词数据

项目地址：https://wordnet.princeton.edu/
许可与商用说明：https://wordnet.princeton.edu/license-and-commercial-use
输入快照：https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz
输入快照 SHA-256：3f7d8be8ef6ecc7167d39b10d66954ec734280b5bdcd57f7d9eafe429d11c22a

WordNet 官网明确允许依照其许可用于商业应用，并建议由代表商业利益的律师结合预期用途审核许可。许可允许免费使用、复制、修改和分发软件、数据库及文档，但要求在所有副本及修改中保留版权声明、许可条件和免责声明；不得使用 Princeton University 或 Princeton 的名称为分发内容进行广告或宣传。

WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.

Permission to use, copy, modify and distribute this software and database and its documentation for any purpose and without fee or royalty is hereby granted, provided that you agree to comply with the following copyright notice and statements, including the disclaimer, and that the same appear on ALL copies of the software, database and documentation, including modifications that you make for internal use or for distribution.

WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.

THIS SOFTWARE AND DATABASE IS PROVIDED “AS IS” AND PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.

The name of Princeton University or Princeton may not be used in advertising or publicity pertaining to distribution of the software and/or database. Title to copyright in this software, database and any associated documentation shall at all times remain with Princeton University and LICENSEE agrees to preserve same.

审核提示：本项目从 WordNet 3.1 固定词典快照提取与内置核心及英文词包相交的同义词集合。商业分发前应保留 WordNet 许可要求的声明，并由法务根据实际产品与分发方式复核。`;

const UNIMORPH_NOTICE = `## UniMorph / MorphyNet 英语派生关系数据

项目地址：https://github.com/unimorph/eng
固定快照：commit 66e0e9e8e2dcd196da081a25a48e5c1fe3d8b49b
输入文件：eng.derivations.tsv
输入快照 SHA-256：743fff8ddb3ff26ae413af1fa859806106ffff69628be4cb7ed4d34f677deed2
许可证：Creative Commons Attribution-ShareAlike 3.0（CC BY-SA 3.0）

本项目提取 MorphyNet 派生关系中的基词、词缀及源/目标词性，并按英文词包生成独立懒加载数据。界面中的“派生基词”描述词形派生关系，不代表历史语言学或词源学词根。

分发要求：须给予适当署名、提供许可证链接、说明修改，并以相同许可证分发改编数据库。许可证全文：https://creativecommons.org/licenses/by-sa/3.0/ 。商业分发前应结合产品的数据组合方式审核署名与相同方式共享义务。`;

const CHINESE_XINHUA_NOTICE = `## chinese-xinhua 中文词典数据

项目地址：https://github.com/pwxcoo/chinese-xinhua
固定快照：commit fe6d6c2e8baa82187f4c96bbe042e43f96c05666
直接内容来源：固定快照中的 word.py、chengyu.py 与 ci.py 均指向 zd9999.com；ci.py 从 http://www.zd9999.com/ci/ 抓取本项目词语包使用的 data/ci.json。
本项目修改：对词头执行 NFKC 规范化，合并重复词头的完整拼音变体与释义，并转换为按需加载 TSV。

审核提示：上游仓库采用 MIT，并表示若内容侵权会删除，但这不能自动覆盖第三方网站对词典内容可能拥有的权利。商业发布前应取得数据权利确认、完成法务审核，或替换为授权链清晰的数据源。

Copyright (c) 2018 PWXCOO

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const CHINESE_DICTIONARY_NOTICE = `## chinese-dictionary 中文词典数据

项目地址：https://github.com/mapull/chinese-dictionary
固定快照：commit e804ada333b68afddfdccbe8dcc938a72da157a7
本项目修改：对词头执行 NFKC 规范化，合并重复词头的完整拼音变体与释义，并转换为按需加载 TSV。

审核提示：上游 README 将汇总结果标为 MIT，同时列出 chinese-xinhua、CC-CEDICT、汉典、字海等混合来源，并明确承认部分来源无法确认。CC-CEDICT 使用 CC BY-SA 4.0；本项目无法将每条释义可靠映射回具体来源，因此不能断言仓库级 MIT 覆盖全部词典内容，也不能确认当前数据是否触发署名、相同方式共享或其他上游义务。公开或商业分发前必须证明快照不含相关派生内容，或由负责人/法务确认实际许可版本、数据范围，并补齐作者、原始地址、许可证链接、修改说明及相同方式共享等义务；否则应改用来源可追溯的数据。

Copyright (c) 2021 码谱

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const DATA_SOURCE_NOTICES: readonly DataSourceNotice[] = [
  { id: 'ecdict', text: ECDICT_NOTICE },
  { id: 'oanc', text: OANC_NOTICE },
  { id: 'unimorph', text: UNIMORPH_NOTICE },
  { id: 'wordnet', text: WORDNET_NOTICE },
  { id: 'chinese-xinhua', text: CHINESE_XINHUA_NOTICE },
  { id: 'chinese-dictionary', text: CHINESE_DICTIONARY_NOTICE },
];

const PACK_DATA_SOURCES: Readonly<Record<DictionaryPackId, readonly DataSourceId[]>> = {
  bnc: [],
  cet4: [],
  cet6: [],
  'chinese-dictionary': ['chinese-dictionary'],
  'chinese-dictionary-words': ['chinese-dictionary'],
  'chinese-xinhua': ['chinese-xinhua'],
  'chinese-xinhua-words': ['chinese-xinhua'],
  gk: [],
  gre: [],
  ielts: [],
  ky: [],
  'supplements:examples': ['oanc'],
  'supplements:inflection-index': ['ecdict'],
  'supplements:inflections': ['ecdict'],
  'supplements:roots': ['unimorph'],
  'supplements:synonyms': ['wordnet'],
  toefl: [],
  zk: [],
};

export function getSelectedDataSourceIds(
  activeIds: ReadonlySet<string>,
): ReadonlySet<DataSourceId> {
  const sourceIds = new Set<DataSourceId>(['ecdict']);
  for (const id of activeIds) {
    if (!isDictionaryPackId(id)) continue;
    for (const sourceId of PACK_DATA_SOURCES[id]) sourceIds.add(sourceId);
  }
  return sourceIds;
}

export function buildCopyrightNotice(activeIds: ReadonlySet<string>): string {
  const selectedLabels = DICTIONARY_PACK_GROUPS.flatMap((group) =>
    group.options.filter((option) => activeIds.has(option.id)).map((option) => option.label),
  );
  const enabledResources = ['英汉高频核心（始终启用）', ...selectedLabels];
  const sourceIds = getSelectedDataSourceIds(activeIds);
  const notices = DATA_SOURCE_NOTICES.filter((notice) => sourceIds.has(notice.id)).map(
    (notice) => notice.text,
  );

  const heading = '# @hamster-note/dictionary 所选词库版权声明';

  return `${heading}

本文件由 Demo 根据当前启用的词库生成。现有数据源以允许商业使用的开源许可或开放使用声明提供，但不同来源的署名、许可文本保留、相同方式共享及审核义务并不相同。请在分发产品前核对适用条款，并将所需版权与许可声明随产品保留。本文件不是法律意见。

## 当前启用资源

${enabledResources.map((label) => `- ${label}`).join('\n')}

完整审计信息：https://github.com/HamsterNote/dictionary/blob/main/THIRD_PARTY_NOTICES.md

---

${notices.join('\n\n---\n\n')}
`;
}
