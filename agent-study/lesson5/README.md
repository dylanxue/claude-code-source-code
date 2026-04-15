# Lesson 5: Session Compaction And Summarization

这一课在 `lesson4` 的基础上，继续朝 Claude Code / Claw Code 靠近，重点补上：

- session compaction
- 自动 summary continuation
- compact metadata

相比第 4 课，这一课新增了：

- `src/core/session-compaction.js`
- `src/model/model-token-limits.js`
- session 会记录 `compaction.count / removedMessageCount / summary`
- runtime 在每轮决策前会检查是否需要 auto compact
- compact 后会注入 synthetic system summary message
- stdout 会显示当前 auto compaction 配置
- model adapter 会按模型默认值设置 `max output tokens`
- 支持 `LLM_MAX_OUTPUT_TOKENS` 覆盖默认值

## 推荐练习

```bash
cd agent-study/lesson5
npm start -- "请阅读 src/index.js 并解释入口流程"
```

```bash
cd agent-study/lesson5
npm start -- --resume latest "继续总结当前 session 的上下文"
```

```bash
cd agent-study/lesson5
SESSION_AUTO_COMPACT_MAX_TOKENS=120 SESSION_COMPACT_PRESERVE_RECENT_MESSAGES=4 npm start -- --resume latest "继续刚才的任务，并观察是否触发 compact"
```

Anthropic 模式示例：

```bash
cd agent-study/lesson5
MODEL_PROVIDER=anthropic npm start -- "请阅读 src/index.js 并解释入口流程"
```

## 学习重点

- session 不只是可恢复状态，还需要能主动压缩上下文
- compact 后不应该丢掉会话延续性，而应该保留最近消息继续工作
- synthetic summary message 是 Claude Code / Claw Code 很关键的思路
- compact metadata 也属于 session 生命周期的一部分

## 当前验证状态

- OpenAI-compatible 路径已经在本地实跑通过
- Anthropic-compatible adapter 已延续 lesson4 的真实联调能力
- auto compaction 已通过本地 synthetic session 验证，并接入 runtime
