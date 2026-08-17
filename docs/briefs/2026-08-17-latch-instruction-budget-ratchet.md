# Latch Agent 指令预算 Ratchet 契约

Source-Task: `20260817082547603-改进-latch-输入与-gate-可发现性-cd1fd6`

Document-Status: `approved`

Date: 2026-08-17

## 地位与范围

本契约替代 2026-08-13 consolidation 契约中 always-loaded surface 的独立
10240-byte 冻结断言。status、review、brief 的机器输出预算和 instruction estimate-unit
预算保持不变。

原 10240-byte 上限在既有 `AGENTS.md` 与 canonical Skill 合计 10239 bytes 时只保留
1 byte 余量。本次新增的 Light scaffold、knowledge artifact 和 check-only gate 规则均属于
已批准的高频直接约束；依靠反复压缩通过门禁会降低可读性，也无法为后续合法变化保留稳定空间。

## 预算模型

`tests/fixtures/instruction-budget-v1.json` 继续使用
`policy: reviewed-aggregate-ratchet`。always-loaded surface 同时保存两组度量：

- estimate-unit：`reviewed_baseline`、`hard_cap`、`review_reason`；
- UTF-8 byte：`reviewed_baseline_bytes`、`hard_cap_bytes`、`min_headroom_bytes`、
  `byte_review_reason`。

byte hard cap 固定为 `12288`，即 12 KiB；`min_headroom_bytes` 固定为 `1024`，即 1 KiB。
最终完整 surface 必须不超过 `reviewed_baseline_bytes`，且
`hard_cap_bytes - reviewed_baseline_bytes >= min_headroom_bytes`。更新 baseline 时必须同步写入
包含新 baseline 数值的 review reason。

超过 reviewed baseline 进入 review-required；超过 hard cap 进入 hard-cap-exceeded。后者要求
重新设计或拆分指令面，不得只提高 `hard_cap_bytes`。estimate 与 byte 任一度量失败都阻止
project check。

## 快速预检

`pnpm check:instruction-budget` 只运行 instruction budget 测试。`pnpm check` 必须先运行该
预检，再执行 typecheck、build 和完整测试。always-loaded 文件变化后先执行预检，可以在完整
验证前发现 baseline 或 hard cap 问题。

## 保留边界

- 不删除 canonical Skill 中的 activation、A/B/C、scope、writer、revision、gate、submit、
  closeout 或 Git 安全规则；
- 不修改 adopter `AGENTS.md` 激活契约；
- 不改变 CLI、task、proof、submission 或 archive 门禁；
- 不引入模型 tokenizer、动态模型预算或 phase-specific Skill loader；
- 不把提高 hard cap 作为 baseline review 的替代。
