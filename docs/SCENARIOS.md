# Latch v2 使用场景

`.latch` 只表示项目支持 Latch。普通写入不单独创建 task。减少的是 task bookkeeping，不是必要验证。

## 直做

低风险局部修复或普通文档修改：读取相关事实，完成最小完整修改，运行最窄权威验证，检查 diff，不创建 Latch task。

## 显式创建

用户明确说「走 Latch」「记录这个任务」或「创建 Latch task」后，先检查 open task，再使用完整 plan 创建新 task。

## 继续任务

已知 Latch task 必须续接，不得改走直做。「继续 Latch」读取当前 actor 的 task；「继续 Latch <id>」只读取指定 task。开始前查看 `git status --short`、task context 和 artifact 指向的文档。跨会话恢复同一已知 task 时同样走 Latch。

## 高风险写入

公共契约变化或权限、认证、信任边界变化即使改动很小，也必须创建或续接 Latch task，再按 A/B/C 选择 Light 或 Standard。代码行数或文件数不能单独作为绕过依据。

## 用户反馈

- 明确实现修正：review 回 dev，保留 plan approval；
- 改变目标、范围、验收或契约：更新 plan，回 plan 并重新批准；
- 只有评价、没有可执行目标：先诊断，再问一个具体问题；
- 无法分类：先询问，不修改状态。

## 归档

只有用户明确要求完成、结束或归档 task，AI 才执行 `done`。只有用户明确要求取消或放弃，AI 才执行 `abandon`。
