# Lesson 2: Real Tooling Layer

这一课把 `lesson1` 的最小 agent 升级为一个更像真实 coding agent 的版本。

相比第 1 课，这一课新增了：

- 工具 `inputSchema`
- `grep_text` 工具
- `write_file` 工具
- `bash` 工具
- 工具失败写回 session
- 多步 mock planner：先搜，再读，再总结

## 推荐练习

```bash
cd agent-study/lesson2
npm start -- "查找 src 里和 tool 相关的内容"
```

```bash
cd agent-study/lesson2
npm start -- "请把 hello from lesson2 写入 notes.txt"
```

```bash
cd agent-study/lesson2
npm start -- "运行 `pwd`"
```

## 运行

```bash
cd agent-study/lesson2
npm start -- "请阅读 rust/README.md 并总结它的架构"
```

## 学习重点

这一课真正想让你建立的感觉是：

- tool 不只是函数集合，而是一层稳定协议
- agent loop 要能承受工具失败
- 搜索、读取、执行、写入，是 coding agent 最基础的四种动作
- 复杂 agent 往往不是一次推理完成，而是多步串起来
