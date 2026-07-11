# Latch v2 使用场景

## 显式创建

用户明确说「走 Latch」「记录这个任务」或「创建 Latch task」后，先检查 open task，再使用完整 plan 创建新 task。没有明确提到 Latch 时，不自动创建。

## 继续任务

「继续 Latch」读取当前 actor 的 task；「继续 Latch <id>」只读取指定 task。开始前查看 `git status --short`、task context 和 artifact 指向的文档。

## 用户反馈

- 明确实现修正：review 回 dev，保留 plan approval；
- 改变目标、范围、验收或契约：更新 plan，回 plan 并重新批准；
- 只有评价、没有可执行目标：先诊断，再问一个具体问题；
- 无法分类：先询问，不修改状态。

## 归档

只有用户明确要求完成、结束或归档 task，AI 才执行 `done`。只有用户明确要求取消或放弃，AI 才执行 `abandon`。
