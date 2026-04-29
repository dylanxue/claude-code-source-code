# DCLAW Claude Code Ink 迁移方案

## 1. 背景

`dclaw` 当前交互 TUI 仍建立在官方 `ink` 之上：

- `src/cli/interactiveTui.tsx` 直接从 `ink` 调用 `render()`
- `src/tui/App.tsx` 用 `Box + useApp + useInput + useStdin` 组织主界面
- `src/tui/views/TranscriptPane.tsx` 依赖 `<Static>` 把旧 transcript 刷到主屏 scrollback

这条架构的根问题不是“某个 chunk 合并错了”，而是：

- 只要动态输出区高度达到终端高度，官方 `ink` 就可能走整屏清空分支
- 一旦进入这条分支，主屏 scrollback 会被重写，滚动体验立即退化
- 当前对 `assistant_stream_chunk` 的修复只能降低触发概率，不能从架构上消灭这个问题

Claude Code 的做法不是继续优化 `<Static>`，而是先换掉官方 Ink renderer，再按环境选择两条路径：

- 使用自定义 `ink` renderer
- 外部正式版默认仍在主屏渲染，让终端原生 scrollback 和滚动条继续工作
- 显式启用 no-flicker/fullscreen 时，才进入 `AlternateScreen + ScrollBox`
- 非 fullscreen 路径通过“只渲染最近窗口 + 稳定锚点”避免 React 树无限增长

## 2. 目标

本次迁移的目标只有一个：把 `dclaw` 的交互 TUI 从“官方 Ink + `<Static>` 主路径”迁移到“Claude Code 风格 custom Ink 底座 + 双滚动路径”。

迁移后的默认行为必须对齐 Claude Code 外部正式版：

- 默认路径：主屏渲染，保留终端原生 scrollback 和可拖动滚动条
- 可选路径：`DCLAW_TUI_FULLSCREEN=1` 时进入 `AlternateScreen + ScrollBox`，使用应用内滚动
- 两条路径都不能再依赖官方 Ink 的 `<Static>` 主路径，也不能再触发官方 Ink 的整屏清空退化

迁移后必须保留的当前能力：

- welcome card
- transcript 主时间线
- assistant prose 流式更新
- activity group / structured card / task snapshot / time separator
- 底部输入框
- slash suggestions
- bottom sheet
- question dialog
- skills menu
- resume session overlay
- queued prompts / busy 状态 / runtime-permission-cwd 元信息

## 3. 非目标

这次迁移明确不做下面这些事情：

- 不搬 Claude Code 全部 REPL 功能
- 不搬 transcript search bar、sticky prompt、unseen pill、message actions、voice mode、hyperlink overlay 等增强功能
- 不追求首版就做 `VirtualMessageList` 的完全对齐
- 不把 fullscreen/no-flicker 设为外部用户默认行为
- 不顺手重写 `QueryEngine`、tool protocol、session model

这里要特别说明一个用户体验变化：

- 默认主屏路径下，终端原生滚动条仍然是 transcript 的主要历史滚动入口
- fullscreen/no-flicker 路径下，滚动才由应用内 `ScrollBox` 管理，终端原生滚动条不再代表 transcript 历史
- 因此默认体验优先“像正式 Claude Code 一样保留 native scrollbar”，fullscreen 只作为显式 opt-in 的稳定低闪烁模式

## 4. 现状盘点

### 4.1 `dclaw` 当前对 Ink 的依赖面

当前 `dclaw` 直接依赖的官方 `ink` API 很少：

- `render`
- `Box`
- `Text`
- `Static`
- `useApp`
- `useInput`
- `useStdin`

这说明迁移的 UI 面不大，但 `Static` 是关键断点：

- Claude Code 自定义 Ink 没有把 `<Static>` 作为主路径能力暴露
- 它自己的补救方式是 `renderToString()` 这类离线渲染工具，不是 interactive transcript 主路径
- 所以一旦迁移，全屏 interactive path 必须脱离 `<Static>`

### 4.2 当前 TUI 实际功能范围

从现有代码看，`dclaw` 真实需要保留的是一套比较克制的 TUI：

- 主界面：`TranscriptPane + BottomDock`
- 顶层替换式覆盖：`ResumeSessionOverlay`
- 底部区域内的局部模式：`SkillsMenu`、`QuestionDialog`、`BottomSheet`、`SlashSuggestionMenu`
- 输入主循环：基于 `useInput` 的键盘事件分发

这意味着我们不需要照抄 Claude Code 的整个 `REPL.tsx`。我们需要的是它的渲染底座，而不是它的全部上层交互。

## 5. 方案决策

### 5.1 不推荐的方案

方案 A：继续留在官方 `ink`，只修 transcript 拆分策略。

结论：

- 这是必要止血，不是最终解
- 不能保证后续新增 block 类型、流式路径或布局变化时不再触发清屏

方案 B：整套照搬 Claude Code 的 `REPL + FullscreenLayout + VirtualMessageList + ScrollKeybindingHandler`。

结论：

- 依赖面太大
- 会把很多当前 `dclaw` 根本没用到的状态和产品逻辑一起搬进来
- 编译、路径别名、功能 flag、上下文 provider 的适配成本过高

### 5.2 推荐方案

推荐采用“底座照搬，上层重写”的中间路线：

1. 搬 Claude Code 的自定义 Ink renderer 与 `ScrollBox` 能力
2. 默认继续使用主屏渲染，让终端 scrollback 和滚动条负责历史浏览
3. 非 fullscreen 路径只渲染最近 transcript 窗口，并用稳定锚点避免追加消息时窗口抖动
4. 在 `dclaw` 内实现一套更小的 fullscreen shell，作为显式 opt-in
5. 保留 `dclaw` 自己的 transcript 数据模型与 bottom dock 语义
6. 只为当前 TUI 功能实现最小滚动、跟随和 overlay 行为

这是本方案的核心决策。

## 6. 目标架构

### 6.1 渲染层

在 `dclaw` 内新增一套本地 custom Ink facade，例如：

- `src/ink/index.ts`
- `src/ink/root.ts`
- `src/ink/components/*`
- `src/ink/hooks/*`
- `src/ink/layout/*`
- `src/native-ts/yoga-layout/*`

注意这里不建议直接复用 Claude Code 顶层 `src/ink.ts`，原因有两个：

- 它带着 `ThemeProvider` 和设计系统包装，对 `dclaw` 当前并非必要
- 它会把 `src/components/design-system/*` 这一层也牵进来，扩大迁移面

更稳妥的做法是：

- 搬底层 renderer 实现
- 在 `dclaw/src/ink/index.ts` 自己导出 `render / Box / Text / useApp / useInput / useStdin`

### 6.2 默认主屏路径

默认路径不进入 `AlternateScreen`，也不把根布局限制成终端高度：

```text
Box(column)
  -> TranscriptPane(recent transcript window)
  -> BottomDock
```

这个路径的关键约束是：

- 不使用官方 Ink `<Static>`
- 不设置 `height="100%"` 这类会把主界面压成 viewport 的根布局
- transcript 只渲染最近窗口，避免长会话 React 树无限增长
- 最近窗口按 collapse 后的 transcript block 计数，连续 `assistant_stream_chunk` 必须只算一个 block
- 窗口起点用稳定锚点维护，避免每次追加消息都把已打印到 scrollback 的内容重新挤动
- welcome card 只在窗口从 transcript 开头渲染时显示，避免截断后重复出现在中段

### 6.3 Fullscreen Shell

新增一个 `dclaw` 自己的最小布局壳，而不是直接搬 Claude Code 的 `FullscreenLayout.tsx`：

- `src/tui/views/TuiFullscreenLayout.tsx`

它只做三件事：

1. 在 `AlternateScreen` 中运行
2. 用 `ScrollBox` 承载 transcript viewport
3. 用固定底部 slot 承载 `BottomDock`

目标结构如下：

```text
AlternateScreen
  -> Box(column, height=rows)
    -> ScrollBox(flexGrow=1, stickyScroll=true)
      -> TranscriptViewport
    -> Box(flexShrink=0)
      -> BottomDock
```

### 6.4 Transcript 渲染层

`TranscriptPane` 需要从“Static + Dynamic 混合渲染器”改成“纯内容渲染器”。

建议拆成两层：

- `TranscriptPane`
  - 只负责把 `TranscriptItem[]` 渲染成一串内容块
  - 支持由上层控制是否渲染 welcome card
- 默认主屏窗口控制
  - 负责计算最近窗口 slice
  - 负责维护稳定 anchor
- `TranscriptViewport`
  - 负责把 `TranscriptPane` 放进 `ScrollBox`
  - 负责 auto-follow、手动滚动打断、回到底部恢复跟随

这意味着下面这些现有逻辑会变成过渡态或可删除项：

- `staticTranscriptLength`
- `getStaticTranscriptPrefixLength()`
- 依赖“尾部 mutable / 前缀 static”的 transcript 切分逻辑

### 6.5 滚动控制层

建议不要整搬 Claude Code 的 `ScrollKeybindingHandler.tsx`，而是为 `dclaw` 写一个更小的控制器：

- `src/tui/hooks/useTranscriptScroll.ts`
- `src/tui/components/TranscriptScrollHandler.tsx`

首版只需要支持当前范围内最重要的输入：

- mouse wheel
- `PageUp` / `PageDown`
- `Home` / `End`
- `Ctrl+U` / `Ctrl+D`
- `Esc` 中断当前 turn 的现有语义继续保留

是否要加 `j/k/g/G`，可以作为增强项，不作为迁移阻塞条件。

### 6.6 Overlay / 局部模式

当前 `dclaw` 的 overlay 需求比 Claude Code 简单很多：

- `ResumeSessionOverlay` 仍然可以作为顶层替换式界面
- `QuestionDialog` / `SkillsMenu` / `BottomSheet` 仍留在 `BottomDock` 内部
- 首版不需要 Claude Code 那套 `modalScrollRef / PromptOverlayProvider / bottomFloat / unseenDivider`

这能明显减小需要搬运的上层组件数量。

## 7. 依赖与工程改造

### 7.1 建议直接 vendoring 的目录

建议整体 vendoring 下列底层目录：

- Claude Code `src/ink/**`
- Claude Code `src/native-ts/yoga-layout/**`

理由：

- `ScrollBox` 不是孤立组件，它依赖自定义 DOM、renderer、reconciler、layout 和 terminal IO
- 只拷一个 `ScrollBox.tsx` 没法工作

### 7.2 建议本地重写或做薄适配的部分

不要直接依赖 Claude Code 这些上层文件：

- `src/ink.ts`
- `src/components/FullscreenLayout.tsx`
- `src/components/VirtualMessageList.tsx`
- `src/components/ScrollKeybindingHandler.tsx`
- `src/screens/REPL.tsx`

建议在 `dclaw` 内自己提供：

- `src/ink/index.ts`
- `src/tui/views/TuiFullscreenLayout.tsx`
- `src/tui/views/TranscriptViewport.tsx`
- `src/tui/hooks/useTranscriptScroll.ts`

### 7.3 建议用 stub 缩小迁移面的依赖

Claude Code 的底层 Ink 里引用了一些仓库级工具模块。对 `dclaw` 来说，建议不要把这些上层模块一起搬进来，而是本地提供最小 stub：

- `flushInteractionTime()`
- `markScrollActivity()`
- `logForDebugging()`
- `logError()`

这些接口在 `dclaw` 里都可以先做成轻量实现或 no-op。

### 7.4 预期新增依赖

如果按照 Claude Code 的底层 Ink vendoring，`dclaw` 预计需要补充一批 direct dependency。范围大致包括：

- `auto-bind`
- `bidi-js`
- `chalk`
- `cli-boxes`
- `code-excerpt`
- `emoji-regex`
- `get-east-asian-width`
- `indent-string`
- `lodash-es`
- `semver`
- `signal-exit`
- `stack-utils`
- `strip-ansi`
- `supports-hyperlinks`
- `type-fest`
- `usehooks-ts`
- `wrap-ansi`

其中部分包可能已经作为间接依赖存在，但为了稳定构建，建议在 `dclaw/package.json` 明确声明 direct dependency。

### 7.5 可以避免的工程负担

如果按本方案实施，下面这些东西首版不需要一起迁进 `dclaw`：

- `bun:bundle` 路径别名
- Claude Code 设计系统主题层
- Claude Code 的 feature flag 分支
- `VirtualMessageList` 对 transcript search / sticky prompt / unseen divider 的整套依赖

## 8. 文件级改造范围

核心修改文件预计如下。

需要新增：

- `src/ink/index.ts`
- `src/ink/*` vendored runtime
- `src/native-ts/yoga-layout/*`
- `src/tui/views/TuiFullscreenLayout.tsx`
- `src/tui/views/TranscriptViewport.tsx`
- `src/tui/hooks/useTranscriptScroll.ts`
- `src/tui/components/TranscriptScrollHandler.tsx`
- `src/tui/runtime/fullscreen.ts`

需要修改：

- `src/cli/interactiveTui.tsx`
- `src/tui/App.tsx`
- `src/tui/views/TranscriptPane.tsx`
- `src/tui/views/BottomDock.tsx`
- `src/tui/state/reducer.ts`
- `package.json`
- `tsconfig.json`

需要删除或降级的旧逻辑：

- `Static` 主路径依赖
- `staticTranscriptLength` 状态
- `getStaticTranscriptPrefixLength()` 驱动的布局策略

## 9. 风险与注意事项

### 9.1 用户体验风险

- 默认路径必须继续保留 native terminal scrollbar，否则会和 Claude Code 外部正式版体验不一致
- fullscreen/no-flicker 路径启用后，native terminal scrollbar 不再是主要交互对象
- 需要明确告诉用户：只有 opt-in fullscreen 下滚动才发生在应用内 viewport，而不是主屏 scrollback

### 9.2 兼容性风险

- `tmux -CC` 与部分终端的 alt-screen / mouse tracking 兼容性需要单独兜底
- 建议照 Claude Code 一样将 fullscreen 作为外部用户 opt-in，并保留 escape hatch

### 9.3 性能风险

- 如果首版不做 virtualization，超长 transcript 的 React 树会持续增长
- 默认主屏路径需要用最近窗口 cap 控制 React 树大小
- fullscreen 路径不会再触发官方 Ink 的 `clearTerminal`，但会在超长会话下带来 CPU / memory 压力

建议：

- 先做主屏最近窗口 cap，把默认体验和性能底线守住
- fullscreen 先做非虚拟化版，把正确性跑通
- 再根据真实数据决定是否进入第二阶段 virtualization

### 9.4 维护风险

- Claude Code 这批 `src/ink/*` 文件本身已经过 React Compiler 处理，可读性一般
- 后续升级时，手工 merge 成本高

建议：

- vendored 目录单独隔离
- `dclaw` 自己的改动尽量放在 facade 和上层 shell，不直接散落到底层 runtime

## 10. 迁移阶段

### 阶段 0：落 feature flag 与适配边界

目标：

- 让 custom Ink 成为默认底座，但 fullscreen 成为可切换 opt-in 路径

产出：

- `DCLAW_TUI_FULLSCREEN=1` 显式启用 fullscreen
- 未设置 `DCLAW_TUI_FULLSCREEN` 时默认保留主屏 native scrollback
- `src/tui/runtime/fullscreen.ts`
- 旧路径与新路径可以并存

### 阶段 1：接入 custom Ink 底座

目标：

- 让 `dclaw` 可以在不改上层业务的前提下，跑在 Claude Code 风格 renderer 上

产出：

- vendored `src/ink/*`
- vendored `src/native-ts/yoga-layout/*`
- `src/ink/index.ts` facade
- `interactiveTui.tsx` 改用新 `render()`

### 阶段 2：对齐默认主屏路径

目标：

- 让默认交互体验保持 Claude Code 外部正式版的主屏滚动条语义
- 避免 custom Ink 的非 fullscreen fallback 又被根高度限制成伪全屏

产出：

- non-fullscreen layout 不设置 `height="100%"`
- transcript 最近窗口 cap
- 稳定 anchor slice 计算
- welcome card 截断策略

### 阶段 3：搭起 fullscreen shell

目标：

- 让 transcript 与 bottom dock 分离，底部输入区不再被消息挤走

产出：

- `TuiFullscreenLayout`
- `AlternateScreen`
- `ScrollBox`

### 阶段 4：移除 `Static` 主路径

目标：

- 彻底摆脱官方 Ink `<Static>` 主路径依赖

产出：

- `TranscriptPane` 纯内容化
- `TranscriptViewport` 接管 scrollable transcript
- 删除 `staticTranscriptLength` 相关布局状态

### 阶段 5：补最小 fullscreen 滚动交互

目标：

- 让 fullscreen/no-flicker 路径在 streaming 过程中仍可稳定手动滚动和回到底部

产出：

- wheel / page / home-end 支持
- sticky follow / break-follow / repin

### 阶段 6：补兼容性与回归护栏

目标：

- 让默认主屏路径安全，fullscreen opt-in 路径可诊断、可关闭

产出：

- tmux / alt-screen 兼容策略
- 单测与 smoke test
- 文档与 fallback 路径

### 阶段 7：按需评估 virtualization

目标：

- 只在真实性能数据需要时再引入更复杂的 viewport 优化

产出：

- 是否引入 `VirtualMessageList` 风格列表的决策
- 或者实现 `dclaw` 自己更小的 virtualization

## 11. 验收标准

迁移完成后，至少满足以下验收标准：

- 长流式回答不再触发官方 Ink 风格的整屏清空
- 默认主屏路径保留终端原生 scrollback 和可拖动滚动条
- 默认主屏路径不会因为根布局高度约束退化成伪 fullscreen
- 默认主屏路径只渲染最近 transcript 窗口，长会话不会无限增大 React 树
- fullscreen opt-in 路径中，transcript 可在 streaming 中稳定向上滚动
- fullscreen opt-in 路径中，`BottomDock` 在整个会话中固定在底部
- `ResumeSessionOverlay`、`SkillsMenu`、`QuestionDialog`、`BottomSheet` 仍可用
- `Esc` 中断、queued prompts、slash suggestions 行为不回归
- fullscreen 可以手动开启，也可以手动关闭

## 12. Task 清单

### P0 / 基础设施

- [x] 新增 `src/tui/runtime/fullscreen.ts`，定义 fullscreen enable/disable 与环境兜底策略
- [x] 在 `package.json` 中补齐 custom Ink 需要的 direct dependencies
- [x] 在 `tsconfig.json` 中补齐 vendored runtime 所需路径与类型配置
- [x] 新建 `src/ink/index.ts` 作为 `dclaw` 自己的 custom Ink facade
- [x] vendoring Claude Code `src/ink/**`
- [x] vendoring Claude Code `src/native-ts/yoga-layout/**`
- [x] 为 `flushInteractionTime / markScrollActivity / logForDebugging / logError` 提供本地 stub

### P0 / 渲染切换

- [x] 修改 `src/cli/interactiveTui.tsx`，从 `dclaw/src/ink` 调用 `render()`
- [x] 确认 `Box / Text / useApp / useInput / useStdin` 在 `dclaw` custom Ink facade 下全部可用
- [x] 增加最小 smoke test，验证 TUI 可以挂载和退出

### P0 / 默认主屏路径

- [x] 将 `DCLAW_TUI_FULLSCREEN` 改为显式 opt-in，未设置时默认不进 `AlternateScreen`
- [x] non-fullscreen layout 移除根 `height="100%"` 约束，保留主屏自然输出
- [x] 为主屏 transcript 增加最近窗口 cap，避免长会话 React 树无限增长
- [x] 最近窗口起点使用稳定 anchor，避免追加消息时反复重排已打印 scrollback
- [x] 截断 transcript 后隐藏 welcome card，避免 welcome card 出现在历史中段
- [x] fullscreen path 保持现有 `AlternateScreen + ScrollBox + BottomDock` 行为不回归

### P0 / Fullscreen 布局

- [x] 新建 `src/tui/views/TuiFullscreenLayout.tsx`
- [x] 在 layout 中接入 `AlternateScreen`
- [x] 在 layout 中接入 `ScrollBox`
- [x] 让 `BottomDock` 固定在 `ScrollBox` 之外的底部区域
- [x] 确保 resize 时 transcript viewport 与 bottom dock 不互相挤压

### P0 / Transcript 改造

- [x] 新建 `src/tui/views/TranscriptViewport.tsx`
- [x] 将 `TranscriptPane` 改造成纯内容渲染器
- [x] 删除 interactive path 中对 `<Static>` 的依赖
- [x] 从 `App.tsx` 删除 `staticTranscriptLength` 状态
- [x] 清理 `getStaticTranscriptPrefixLength()` 与对应测试
- [x] 保留现有 transcript item 视觉语义不变

### P0 / 滚动行为

- [x] 新建 `src/tui/hooks/useTranscriptScroll.ts`
- [x] 新建 `src/tui/components/TranscriptScrollHandler.tsx`
- [x] 支持 mouse wheel
- [x] 支持 `PageUp / PageDown`
- [x] 支持 `Home / End`
- [x] 支持 `Ctrl+U / Ctrl+D`
- [x] 实现 auto-follow、手动打断 follow、回到底部恢复 follow

### P1 / 兼容性与收口

- [x] 为 `tmux -CC` 或不兼容终端增加 fullscreen auto-disable
- [x] 保留一个 fallback path，便于故障时切回当前主路径
- [x] 核对 `ResumeSessionOverlay` 在 alternate screen 中的显示与输入行为
- [x] 核对 `SkillsMenu / QuestionDialog / BottomSheet / SlashSuggestionMenu` 的焦点与布局
- [x] 核对 streaming 中 `Esc` 中断与 queued prompt 的一致性

### P1 / 测试

- [x] 为 fullscreen enable/disable 规则增加单测
- [x] 为 fullscreen 默认关闭、显式开启增加单测
- [x] 为 non-fullscreen layout 不限制根高度增加单测
- [x] 为主屏 transcript 最近窗口与稳定 anchor 增加单测
- [x] 为 transcript auto-follow / break-follow / repin 增加单测
- [x] 为 `BottomDock` 固定布局增加 TUI 交互测试
- [x] 为流式输出下的滚动稳定性增加回归测试
- [x] 为 resume / skills / question dialog 在 fullscreen path 的可用性增加测试

### P2 / 可选优化

- [ ] 评估 transcript 长会话性能，决定是否进入 virtualization
- [ ] 如果需要，再设计 `dclaw` 自己的最小 `VirtualTranscriptList`
- [ ] 评估是否补 `j/k/g/G` 这类 transcript 模式快捷键

## 13. 结论

如果目标是“继续靠官方 Ink + `<Static>` 工作，但不再被 Ink 清屏打坏”，那条路基本已经走到头了。

如果目标是“像 Claude Code 外部正式版一样，默认保留主屏滚动条，又不再被官方 Ink clearTerminal 回退打坏”，那就必须接受三件事：

- 迁移到自定义 Ink renderer
- 默认路径继续主屏渲染，但不能再依赖 `<Static>`
- fullscreen/no-flicker 只作为显式 opt-in，把滚动语义转到应用自己的 viewport

在这个前提下，本方案给出的推荐落地方式是：

- 底层 Ink runtime 尽量照搬
- `dclaw` 上层 TUI 同时维护默认主屏路径和最小 fullscreen shell
- 首版先不追求搬完 Claude Code 全部 transcript 增强能力
