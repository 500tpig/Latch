# Latch 0.6.1 早期试用说明

状态：0.6.1 早期试用源码；公开入口为 [500tpig/Latch](https://github.com/500tpig/Latch)。

本次增加陌生使用者的安装与最小任务示例、MIT 许可和脱敏反馈模板。CLI 与 schema 未改变；试用目标是获得实际反馈，不承诺效率提升或没有缺陷。

## 试用交付

公开源码快照不携带 Git 历史，也不包含真实 `.latch/`、内部项目接入状态或历史任务评估。快照可由维护仓库的 `node scripts/verify-early-trial.mjs` 在系统临时目录重建；命令打印快照、清单及隔离验证结果的位置，不写入全局安装或 Skill 链接。

复制清单：`src/`、`skills/latch/`、`tsconfig.json`、`pnpm-lock.yaml`、`README.md`、`LICENSE`、本页和 `docs/FEEDBACK.md`。

生成文件：`package.json` 保留包名、版本、类型、bin、许可及依赖，只提供 build/typecheck；`docs/INDEX.md` 是试用文档入口；`docs/AGENT_FEEDBACK.md` 指向反馈模板，以保留 canonical Skill 中已有的引用。原始文件不删除。依赖通过安装获取，不将本机 `node_modules` 或 store 混入交付。

## 已知限制

- 本次环境覆盖只限 README 所列实际环境；未验证其他平台、其他宿主或另一个真实会话的接管恢复。
- 「验收标准与最终交付不一致」已有 `update-acceptance` 命令和反馈时同步 plan、submit/done 前核对的 Skill 规则；机器不判断任意自然语言行为是否一致。
- 「closeout 结论超出验证证据」已明确要求 resolved 覆盖原缺口和所需环境，模拟不能证明真实客户端集成；Core 只校验结构，结论覆盖仍由 Agent 与使用者判断。没有新的真实使用样本证明此类问题已消失。
- workspace proof 遗留问题的原始失败响应、稳定复现步骤和根因尚未取得；当前文档只有机制契约，不能据此认定误拦，也未放宽门禁。
- 长命令参数存在已复现的限制：在最小示例中，较长的 `node -e` 校验参数导致 `command_failed`，错误指出命令参数投影超过 64 UTF-8 bytes；改用 `node check.cjs`。本次未修改该限制。
- Scope 是 task 的写入及证据约束，不是工作区隔离；使用共享目录仍可能相互影响。
- 历史 schema 2–4 保持只读；本次不做迁移或自动 Git 操作。

## 公开状态

本公开仓库使用脱敏源码重新初始化 Git，不包含原仓库提交历史、内部设计材料和本地任务数据。原有历史保留在维护者本地备份中；重新发布不能收回此前已下载的副本。

安装或流程问题按[反馈模板](FEEDBACK.md)提交脱敏材料即可。
