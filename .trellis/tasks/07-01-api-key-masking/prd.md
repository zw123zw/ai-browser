# brainstorm: API key 隐藏与安全输入

## Goal

在设置弹框中，将所有 API key / secret 类字段从明文显示改为「显示态+编辑态」分离模式，前端永远看不到真实值。

## What I already know

### 需要隐藏的字段（共 5 个）

| Tab | 字段 | 当前状态 |
|-----|------|----------|
| AI | `form.apiKey`（单模型） | 已有 password + 眼睛切换（需统一改造） |
| Voice | `voiceForm.appId` | 明文显示 |
| Voice | `voiceForm.apiKey` | 明文显示 |
| Voice | `voiceForm.apiSecret` | 明文显示 |

注：`AppSettings.apiKey`（全局）在 UI 中不可直接编辑，是模型 apiKey 的 fallback。

### 设计方案：显示态 + 编辑态分离

**默认（显示态）**：
```
API Key    [••••••••••]  [修改]
```
- 显示掩码文字（`••••••••` 或 `已设置` / `未设置`）
- 不是输入框，是纯 `<span>` 或 `<div>`
- 旁边有「修改」按钮

**点击「修改」（编辑态）**：
```
API Key    [                 ]  [保存] [取消]
```
- 切换为空白 `<input>` 输入框
- 用户输入新值
- 「保存」：有值 → 保存，回到显示态；空值 → 不保存，回到显示态
- 「取消」：不保存，回到显示态

**安全特性**：
- 前端永远看不到已保存的真实值
- 没有眼睛切换按钮
- 没有 password 类型输入框的浏览器自动填充风险

### `/` 命令提示

已存在于 `InputBar.vue`（第 44-57 行、573-585 行），无需额外开发。

## Requirements

1. AI tab 的 `form.apiKey` 改为「显示态+编辑态」，移除现有眼睛切换
2. Voice tab 的 `appId`、`apiKey`、`apiSecret` 改为「显示态+编辑态」
3. 显示态显示掩码文字 + 「修改」按钮
4. 编辑态显示空白输入框 + 「保存」「取消」按钮
5. 保存时：空值不保存（保留旧值），有值保存新值
6. 取消时：不保存，回到显示态

## Decision (ADR-lite)

**Context**: 需要隐藏设置弹框中的 API key / secret 字段，防止旁观者窥视。
**Decision**: 采用「显示态+编辑态」分离方案。默认显示掩码文字 `••••••••`，点击「修改」切换为空白输入框，保存/取消后回到显示态。同一时刻只允许编辑一个字段。
**Consequences**: 前端永远看不到真实值，比 password+眼睛切换更安全。需要新建通用 SecretField 组件封装逻辑。

## Acceptance Criteria

- [ ] AI tab 模型 apiKey 显示掩码，无眼睛按钮
- [ ] Voice tab 三个字段均显示掩码
- [ ] 点击「修改」出现空白输入框
- [ ] 保存空值 → 旧值不变
- [ ] 保存有值 → 新值生效
- [ ] 取消 → 旧值不变
- [ ] 前端任何状态下看不到真实密钥值

## Definition of Done

- `npm run compile` 类型检查通过
- 无 console.log，日志走 Logger
- CSS 类名 `aib-` 前缀
- 不引入新依赖

## Out of Scope

- `local-config.json` / `voice-config.json` 打包加密
- 密钥导出时的脱敏
- 全局 `AppSettings.apiKey` 的 UI 编辑（当前不在 UI 中）

## Technical Notes

- 主要修改文件：`SettingsModal.vue`
- 参考现有 `showApiKey` ref 模式，但改为 `editingField: ref<string | null>(null)`
- 用一个 ref 追踪当前正在编辑的字段，其他字段保持显示态
- `EngineConf[]` 数组中的引擎密钥暂不在本次范围
