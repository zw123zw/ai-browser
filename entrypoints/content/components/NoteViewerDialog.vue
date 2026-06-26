<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useNotesStore } from '@/src/stores/notes';
import { useToast } from '@/src/composables/useToast';
import { renderMarkdown } from '@/src/utils/markdown';
import ConfirmDialog from './ConfirmDialog.vue';
import type { NoteTitle, NoteEntry } from '@/src/types';

const emit = defineEmits<{ (e: 'close'): void }>();

const notesStore = useNotesStore();
const toast = useToast();
// 选中的标题
const selectedTitleId = ref<string | null>(null);
const selectedTitle = computed(() =>
  notesStore.titles.find((title) => title.id === selectedTitleId.value) || null,
);

// 编辑状态
const editingEntryId = ref<string | null>(null);
const editingContent = ref('');

// 删除确认
const showDeleteConfirm = ref(false);
const deleteTarget = ref<{ type: 'title' | 'entry'; titleId: string; entryId?: string } | null>(null);

// 默认选中第一个标题
watch(
  () => notesStore.titles,
  (titles) => {
    if (!selectedTitleId.value && titles.length > 0) {
      selectedTitleId.value = titles[0].id;
    }
    // 如果选中的标题被删除了
    if (selectedTitleId.value && !titles.find((t) => t.id === selectedTitleId.value)) {
      selectedTitleId.value = titles[0]?.id || null;
    }
  },
  { immediate: true },
);

/** 选择标题 */
function selectTitle(id: string) {
  selectedTitleId.value = id;
  editingEntryId.value = null;
}

/** 确认删除 */
function confirmDelete(type: 'title' | 'entry', titleId: string, entryId?: string) {
  deleteTarget.value = { type, titleId, entryId };
  showDeleteConfirm.value = true;
}

/** 执行删除 */
async function doDelete() {
  if (!deleteTarget.value) return;
  if (deleteTarget.value.type === 'title') {
    await notesStore.deleteTitle(deleteTarget.value.titleId);
    toast.success('笔记已删除');
  } else if (deleteTarget.value.entryId) {
    await notesStore.deleteEntry(deleteTarget.value.titleId, deleteTarget.value.entryId);
    toast.success('条目已删除');
  }
  showDeleteConfirm.value = false;
  deleteTarget.value = null;
}

/** 开始编辑 */
function startEdit(entry: NoteEntry) {
  editingEntryId.value = entry.id;
  editingContent.value = entry.content;
}

/** 保存编辑 */
async function saveEdit(titleId: string, entryId: string) {
  await notesStore.updateEntryContent(titleId, entryId, editingContent.value);
  editingEntryId.value = null;
  toast.success('已保存');
}

/** 取消编辑 */
function cancelEdit() {
  editingEntryId.value = null;
}

/** 编辑区域失焦时自动保存 */
function onEditBlur(titleId: string, entryId: string) {
  // 延迟检查，避免点击保存/取消按钮时也触发
  setTimeout(() => {
    if (editingEntryId.value === entryId) {
      saveEdit(titleId, entryId);
    }
  }, 150);
}

/** 格式化时间 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 截断 URL */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 20 ? u.pathname.slice(0, 20) + '...' : u.pathname);
  } catch {
    return url.slice(0, 30);
  }
}

/** 跳转到笔记来源（带滚动位置和高亮文本） */
function jumpToSource(entry: NoteEntry) {
  if (!entry.url) return;
  // 通过 URL hash 传递 scrollY 和 selectedText
  const params = new URLSearchParams();
  // scrollY >= 0 即保存（0 也是有效值）
  params.set('aib-scroll', String(entry.scrollY ?? 0));
  if (entry.selectedText) params.set('aib-highlight', entry.selectedText.slice(0, 100));
  const hash = params.toString() ? `#${params.toString()}` : '';
  const targetUrl = entry.url + hash;

  console.log('[笔记跳转] jumpToSource', { scrollY: entry.scrollY, url: entry.url, targetUrl, selectedText: entry.selectedText?.slice(0, 30) });

  // 先关闭笔记弹框
  emit('close');
  // 再关闭聊天抽屉
  window.dispatchEvent(new Event('aib-close-drawer'));

  // 延迟跳转，确保弹框和抽屉关闭动画完成
  setTimeout(() => {
    window.open(targetUrl, '_blank');
  }, 200);
}

/** 导出单个标题为 md */
function exportTitle(title: NoteTitle) {
  const lines: string[] = [];
  for (const entry of title.entries) {
    lines.push(entry.content);
    lines.push('');
    lines.push(`<!-- entry: ${JSON.stringify({ url: entry.url, scrollY: entry.scrollY, selectedText: entry.selectedText, source: entry.source, timestamp: entry.timestamp })} -->`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.title}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`已导出「${title.title}」`);
}

/** 导出全部为 zip */
async function exportAllZip() {
  // 动态加载 JSZip
  try {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const title of notesStore.titles) {
      const lines: string[] = [];
      for (const entry of title.entries) {
        lines.push(entry.content);
        lines.push('');
        lines.push(`<!-- entry: ${JSON.stringify({ url: entry.url, scrollY: entry.scrollY, selectedText: entry.selectedText, source: entry.source, timestamp: entry.timestamp })} -->`);
        lines.push('');
        lines.push('---');
        lines.push('');
      }
      zip.file(`${title.title}.md`, lines.join('\n'));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-browser-notes-${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('已导出全部笔记');
  } catch (err) {
    toast.error('导出失败，请安装 jszip 依赖');
  }
}

/** 导入笔记 */
function importNotes() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,.md';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      if (file.name.endsWith('.zip')) {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(file);
        const imported: NoteTitle[] = [];
        for (const [filename, zipEntry] of Object.entries(zip.files)) {
          if (!filename.endsWith('.md') || zipEntry.dir) continue;
          const content = await zipEntry.async('string');
          const titleName = filename.replace(/\.md$/, '');
          const entries = parseMarkdownEntries(content);
          if (entries.length > 0) {
            imported.push({
              id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
              title: titleName,
              entries,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        }
        await notesStore.importNotes({ titles: imported });
        toast.success(`已导入 ${imported.length} 个笔记`);
      } else if (file.name.endsWith('.md')) {
        const content = await file.text();
        const titleName = file.name.replace(/\.md$/, '');
        const entries = parseMarkdownEntries(content);
        if (entries.length > 0) {
          await notesStore.importNotes({
            titles: [{
              id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
              title: titleName,
              entries,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }],
          });
          toast.success(`已导入「${titleName}」`);
        }
      }
    } catch (err) {
      toast.error('导入失败');
    }
  };
  input.click();
}

/** 解析 md 文件中的条目 */
function parseMarkdownEntries(content: string): NoteEntry[] {
  const entries: NoteEntry[] = [];
  // 按 --- 分隔
  const sections = content.split(/\n---\n/);
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    // 提取元数据注释
    const metaMatch = trimmed.match(/<!-- entry: (\{.*?\}) -->/s);
    let meta: any = {};
    let noteContent = trimmed;

    if (metaMatch) {
      try {
        meta = JSON.parse(metaMatch[1]);
        noteContent = trimmed.replace(metaMatch[0], '').trim();
      } catch {}
    }

    if (!noteContent) continue;

    entries.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      content: noteContent,
      url: meta.url || '',
      scrollY: meta.scrollY || 0,
      selectedText: meta.selectedText,
      source: meta.source || 'chat',
      timestamp: meta.timestamp || Date.now(),
    });
  }
  return entries;
}

/** 点击外部关闭 */
function onBackdrop(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('aib-viewer-backdrop')) {
    emit('close');
  }
}
</script>

<template>
  <div class="aib-viewer-backdrop" @click="onBackdrop">
    <div class="aib-viewer-dialog">
      <!-- 头部 -->
      <div class="aib-viewer-header">
        <span class="aib-viewer-title">📒 我的笔记</span>
        <div class="aib-viewer-header-actions">
          <button class="aib-viewer-header-btn" @click="importNotes">📥 导入</button>
          <button class="aib-viewer-header-btn" @click="exportAllZip">📦 全部导出</button>
          <button class="aib-viewer-close" @click="emit('close')">✕</button>
        </div>
      </div>

      <!-- 三栏内容 -->
      <div class="aib-viewer-body">
        <!-- 左侧：标题列表 -->
        <div class="aib-viewer-sidebar">
          <div v-if="notesStore.titles.length === 0" class="aib-viewer-empty">
            暂无笔记
          </div>
          <div
            v-for="title in notesStore.titles"
            :key="title.id"
            :class="['aib-viewer-title-item', { 'aib-viewer-title-active': selectedTitleId === title.id }]"
            @click="selectTitle(title.id)"
          >
            <span class="aib-viewer-title-text">{{ title.title }}</span>
            <div class="aib-viewer-title-actions">
              <button
                class="aib-viewer-title-export"
                @click.stop="exportTitle(title)"
                title="导出"
              >📤</button>
              <button
                class="aib-viewer-title-delete"
                @click.stop="confirmDelete('title', title.id)"
                title="删除"
              >🗑</button>
            </div>
          </div>
        </div>

        <!-- 中间：笔记内容 -->
        <div class="aib-viewer-content">
          <div v-if="!selectedTitle" class="aib-viewer-empty">
            选择左侧标题查看笔记
          </div>
          <div v-else class="aib-viewer-entries">
            <div
              v-for="entry in selectedTitle.entries"
              :key="entry.id"
              class="aib-viewer-entry"
            >
              <!-- 编辑态 -->
              <div v-if="editingEntryId === entry.id" class="aib-viewer-edit">
                <textarea
                  v-model="editingContent"
                  class="aib-viewer-textarea"
                  @keydown.ctrl.enter="saveEdit(selectedTitle!.id, entry.id)"
                  @keydown.escape="cancelEdit"
                  @blur="onEditBlur(selectedTitle!.id, entry.id)"
                />
                <div class="aib-viewer-edit-actions">
                  <button class="aib-viewer-edit-btn" @click="cancelEdit">取消</button>
                  <button class="aib-viewer-edit-btn aib-viewer-edit-btn-primary" @click="saveEdit(selectedTitle!.id, entry.id)">
                    保存 (Ctrl+Enter)
                  </button>
                </div>
              </div>
              <!-- 展示态 -->
              <div
                v-else
                class="aib-viewer-entry-content aib-msg-text"
                @dblclick="startEdit(entry)"
                v-html="renderMarkdown(entry.content)"
              />
              <div class="aib-viewer-entry-footer">
                <span class="aib-viewer-entry-time">{{ formatTime(entry.timestamp) }}</span>
                <button
                  class="aib-viewer-entry-delete"
                  @click="confirmDelete('entry', selectedTitle!.id, entry.id)"
                >删除</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：时间线 -->
        <div class="aib-viewer-timeline">
          <div v-if="!selectedTitle" class="aib-viewer-empty-timeline" />
          <div v-else class="aib-viewer-timeline-list">
            <div
              v-for="(entry, idx) in selectedTitle.entries"
              :key="entry.id"
              class="aib-viewer-timeline-node"
            >
              <div class="aib-viewer-timeline-dot" />
              <div v-if="idx < selectedTitle.entries.length - 1" class="aib-viewer-timeline-line" />
              <div class="aib-viewer-timeline-info">
                <div class="aib-viewer-timeline-time">{{ formatTime(entry.timestamp) }}</div>
                <div
                  v-if="entry.url"
                  class="aib-viewer-timeline-url"
                  :title="entry.url"
                  @click="jumpToSource(entry)"
                >
                  {{ shortUrl(entry.url) }}
                </div>
                <div v-if="entry.scrollY" class="aib-viewer-timeline-scroll">
                  scrollY: {{ entry.scrollY }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹框 -->
    <ConfirmDialog
      :visible="showDeleteConfirm"
      :title="deleteTarget?.type === 'title' ? '删除笔记' : '删除条目'"
      :desc="deleteTarget?.type === 'title' ? '确认删除整个笔记标题及其所有条目？此操作不可撤销。' : '确认删除此条目？此操作不可撤销。'"
      :confirm-text="'确认删除'"
      @confirm="doDelete"
      @cancel="showDeleteConfirm = false"
    />
  </div>
</template>

<style scoped>
.aib-viewer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.aib-viewer-dialog {
  width: 80%;
  height: 80vh;
  background: var(--aib-bg-card, #1e1e2e);
  border: 1px solid var(--aib-border, rgba(255,255,255,0.08));
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 头部 */
.aib-viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--aib-border, rgba(255,255,255,0.08));
  flex-shrink: 0;
}
.aib-viewer-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--aib-text, #e0e0e0);
}
.aib-viewer-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.aib-viewer-header-btn {
  padding: 4px 12px;
  border: 1px solid var(--aib-border, rgba(255,255,255,0.12));
  border-radius: 6px;
  background: transparent;
  color: var(--aib-text-soft, #aaa);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}
.aib-viewer-header-btn:hover {
  background: var(--aib-bg-hover, rgba(255,255,255,0.08));
  color: var(--aib-text, #fff);
}
.aib-viewer-close {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--aib-text-soft, #888);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.aib-viewer-close:hover {
  background: rgba(255,255,255,0.1);
  color: var(--aib-text, #fff);
}

/* 三栏 */
.aib-viewer-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左侧标题栏 */
.aib-viewer-sidebar {
  width: 20%;
  min-width: 140px;
  border-right: 1px solid var(--aib-border, rgba(255,255,255,0.08));
  overflow-y: auto;
  padding: 8px 0;
}
.aib-viewer-title-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.1s ease;
  gap: 4px;
}
.aib-viewer-title-item:hover {
  background: var(--aib-bg-hover, rgba(255,255,255,0.04));
}
.aib-viewer-title-active {
  background: var(--aib-bg-hover, rgba(255,255,255,0.08));
  border-right: 2px solid var(--aib-primary, #8b5cf6);
}
.aib-viewer-title-text {
  flex: 1;
  font-size: 13px;
  color: var(--aib-text, #e0e0e0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aib-viewer-title-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.aib-viewer-title-item:hover .aib-viewer-title-actions {
  opacity: 1;
}
.aib-viewer-title-export,
.aib-viewer-title-delete {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
}
.aib-viewer-title-export:hover {
  background: rgba(255,255,255,0.1);
}
.aib-viewer-title-delete:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* 中间内容区 */
.aib-viewer-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
.aib-viewer-entries {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.aib-viewer-entry {
  border: 1px solid var(--aib-border, rgba(255,255,255,0.06));
  border-radius: 8px;
  overflow: hidden;
}
.aib-viewer-entry-content {
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--aib-text, #e0e0e0);
  cursor: default;
  user-select: text;
}
.aib-viewer-entry-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  border-top: 1px solid var(--aib-border, rgba(255,255,255,0.04));
  background: rgba(255,255,255,0.02);
}
.aib-viewer-entry-time {
  font-size: 11px;
  color: var(--aib-text-soft, #666);
}
.aib-viewer-entry-delete {
  border: none;
  background: transparent;
  color: var(--aib-text-soft, #888);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.1s ease;
}
.aib-viewer-entry-delete:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* 编辑态 */
.aib-viewer-edit {
  padding: 8px;
}
.aib-viewer-textarea {
  width: 100%;
  min-height: 120px;
  padding: 10px 12px;
  border: 1px solid var(--aib-primary, #8b5cf6);
  border-radius: 6px;
  background: rgba(0,0,0,0.2);
  color: var(--aib-text, #e0e0e0);
  font-size: 13px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}
.aib-viewer-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}
.aib-viewer-edit-btn {
  padding: 4px 12px;
  border: 1px solid var(--aib-border, rgba(255,255,255,0.12));
  border-radius: 6px;
  background: transparent;
  color: var(--aib-text-soft, #aaa);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}
.aib-viewer-edit-btn:hover {
  background: var(--aib-bg-hover, rgba(255,255,255,0.08));
  color: var(--aib-text, #fff);
}
.aib-viewer-edit-btn-primary {
  background: var(--aib-primary, #8b5cf6);
  border-color: var(--aib-primary, #8b5cf6);
  color: #fff;
}
.aib-viewer-edit-btn-primary:hover {
  opacity: 0.9;
  background: var(--aib-primary, #8b5cf6);
  color: #fff;
}

/* 右侧时间线 */
.aib-viewer-timeline {
  width: 20%;
  min-width: 120px;
  max-width: 180px;
  border-left: 1px solid var(--aib-border, rgba(255,255,255,0.08));
  overflow-y: auto;
  padding: 12px 8px;
}
.aib-viewer-timeline-list {
  display: flex;
  flex-direction: column;
  position: relative;
}
.aib-viewer-timeline-node {
  position: relative;
  padding-left: 16px;
  padding-bottom: 16px;
}
.aib-viewer-timeline-node:last-child {
  padding-bottom: 0;
}
.aib-viewer-timeline-dot {
  position: absolute;
  left: 0;
  top: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--aib-primary, #8b5cf6);
  box-shadow: 0 0 0 2px var(--aib-bg-card, #1e1e2e);
}
.aib-viewer-timeline-line {
  position: absolute;
  left: 3px;
  top: 14px;
  bottom: 0;
  width: 2px;
  background: var(--aib-border, rgba(255,255,255,0.1));
}
.aib-viewer-timeline-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.aib-viewer-timeline-time {
  font-size: 11px;
  color: var(--aib-text-soft, #888);
  font-weight: 500;
}
.aib-viewer-timeline-url {
  font-size: 10px;
  color: var(--aib-primary, #8b5cf6);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.1s ease;
}
.aib-viewer-timeline-url:hover {
  color: #a78bfa;
  text-decoration: underline;
}
.aib-viewer-timeline-scroll {
  font-size: 10px;
  color: var(--aib-text-soft, #666);
}

/* 空状态 */
.aib-viewer-empty {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--aib-text-soft, #666);
}
.aib-viewer-empty-timeline {
  padding: 12px;
}
</style>
