# 增强 scroll 命令 — auto/stop/pause + 容器滚动

## Goal

增强现有的 `scroll` 命令，支持自动滚动（auto）、暂停（pause）、恢复（resume）、停止（stop），并支持页面内可滚动容器的检测和滚动。

## What I already know

- 当前 `executeScroll` 在 `action-executor.ts:375`，只支持 `up/down/top/bottom` 四个方向
- 使用 `window.scrollBy/scrollTo`，无法滚动页面内的可滚动容器（如 div overflow:auto）
- Phase 1/Phase 2 prompt 的 scroll 描述：`滚动页面（direction:up/down/top/bottom）`
- CAPABILITY_DOMAIN_LIST 中 scroll 的 desc：`滚动页面（direction:up/down/top/bottom）`

## Requirements

### 1. 新增 direction 值

| direction | 说明 |
|-----------|------|
| `auto` | 开始自动向下滚动（平滑，每帧 ~2px） |
| `stop` | 停止自动滚动 |
| `pause` | 暂停自动滚动 |
| `resume` | 恢复自动滚动 |
| 保留 `up/down/top/bottom` | 原有一次性滚动 |

### 2. 暂停/恢复机制

- **滚轮向上** → 自动暂停
- **滚轮向下** → 自动恢复（仅在已暂停状态下）
- **语音指令** `scroll:pause` / `scroll:resume` → 暂停/恢复

### 3. 容器滚动

- 当 `window.scrollBy` 无效时（页面 body 不可滚动），从目标元素向上查找最近的 `overflow: auto/scroll` 容器
- 使用 `element.scrollTop` 替代 `window.scrollBy`
- auto 滚动同样支持容器

### 4. auto 滚动实现

- `requestAnimationFrame` 循环，每帧滚动 ~2px（平滑自然）
- 全局状态：`isRunning` / `isPaused` / `animationId`
- auto 滚动到页面/容器底部时自动停止

## Acceptance Criteria

- [ ] 说"自动滚动页面" → `scroll:auto` 开始平滑向下滚动
- [ ] 滚轮向上 → 自动暂停
- [ ] 滚轮向下 → 自动恢复
- [ ] 说"暂停滚动" → `scroll:pause` 暂停
- [ ] 说"继续滚动" → `scroll:resume` 恢复
- [ ] 说"停止滚动" → `scroll:stop` 停止
- [ ] 在可滚动容器的页面（如掘金评论区）→ 能正确滚动容器
- [ ] auto 滚动到底部自动停止
- [ ] 原有 `scroll:up/down/top/bottom` 不受影响
- [ ] 类型检查通过

## Technical Approach

### 文件改动

1. **`action-executor.ts`** — 重写 `executeScroll()`，新增 auto-scroll 状态管理、容器检测、wheel 监听
2. **`prompts/common.ts`** — 更新 scroll desc
3. **`prompts/phase1.ts`** — 更新 scroll 示例和能力列表
4. **`prompts/phase2.ts`** — 更新 scroll 描述

### 容器检测逻辑

```
getScrollableContainer(el):
  while el && el !== document.body:
    if el.scrollHeight > el.clientHeight && overflow in (auto, scroll):
      return el
    el = el.parentElement
  return null  // 回退到 window
```

### auto-scroll 状态

```
let autoScrollState = {
  running: false,
  paused: false,
  animationId: 0,
  container: Window | Element | null,
}
```

### wheel 监听

```
on wheel event:
  if not autoScrollRunning → ignore
  if deltaY < 0 (up) → pause
  if deltaY > 0 (down) and paused → resume
```

## Out of Scope

- 水平滚动（left/right）
- 滚动速度配置
- 滚动到指定元素（click 可以做到）
- 滚动动画曲线配置

## Decision (ADR-lite)

**Context**: 需要增强 scroll 命令支持自动滚动和容器滚动
**Direction**: 在现有 `executeScroll` 中扩展，新增 direction 值 + 全局 auto-scroll 状态 + 容器检测
**Consequences**: action-executor.ts 会变大，但逻辑集中在一个方法中，可维护
