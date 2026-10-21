"""按词 Wiktionary 音标候选采集工具包（离线优先）。

本包只依赖 Python 3.12+ 标准库，不引入 requests / Kaikki / 新后端或新框架。
它是独立于旧 `generate_wiktionary_phonetics.py` dump 主线的按词流程实现。

模块边界（对应 tasks 5.1 + 6.x）：

- `scope_model`：内部 scope 表示，兼容 contracts lane 的三种格式
  （`known` / `explicit-all` / `unknown`）。真正的 TS/Python 合同由
  `scripts/wiktionary_per_word/contracts.py`（另一 lane 专有）给出；
  本包只做内部设计，待其返回后再机械 align。
- `http_adapter`：HTTP 适配层。流式读取、gzip 限额解压、请求分类计账、
  合规 User-Agent 校验、串行低速与 429/503 退避。可在测试中注入假 transport
  与假时钟，默认不联网。
- `html_extract`：基于 `html.parser.HTMLParser` 的结构栈提取器。从展开后的
  Wiki HTML 中提取多个 Etymology / Pronunciation / POS / form 的 IPA、
  父级 qualifiers、全部原 tags 与结构路径，不借用相邻音频标签。
- `evidence`：不可变来源证据与响应缓存。保存 page/history/revision、
  提取时间、提取器/规则版本、HTTP hash、IPA+qualifier+applicability 语义
  fingerprint，支持带来源许可的离线重解析。
- `ledger`：持久账本 / checkpoint / 逐词状态机。distinct head 预扣、首轮
  100 词与 20 MiB 解压上限、同批恢复不重置累计、版本校验与 fail closed。
- `offline_reparse`：离线重解析与候选生成纯函数，不联网。
- `action_api`：Action API `parse`/`tocdata` 动态定位 English hLevel=2 并取
  完整 English 展开文本；只负责请求编排，解析交给上面的模块。
- `collector`：把以上模块串起来的按词采集编排器。

真实联网只允许在第 10 组独立采集授权后发生；默认入口离线。
"""

from __future__ import annotations

__all__ = [
    "scope_model",
    "http_adapter",
    "html_extract",
    "evidence",
    "ledger",
    "offline_reparse",
    "action_api",
    "collector",
    "contract_adapter",
]

# 提取器 / 标签规则 / schema 版本。任何版本变化都会让旧 checkpoint 拒绝恢复，
# 也不能把升级重算成新批次并清零预算（见 tasks 6.3）。
SCHEMA_VERSION = "wiktionary-per-word/schema/1"
EXTRACTOR_VERSION = "wiktionary-per-word/extractor/5"
TAG_RULE_VERSION = "wiktionary-per-word/tags/2"
