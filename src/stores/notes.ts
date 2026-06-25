import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { NoteEntry, NoteTitle, NotesData } from '@/src/types';
import { notesStorage } from '@/src/storage';
import { plain } from '@/src/utils/storage-sync';
import { Logger } from '@/src/utils/logger';

const log = new Logger('Store:Notes');

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useNotesStore = defineStore('aib-notes', () => {
  const titles = ref<NoteTitle[]>([]);
  const ready = ref(false);

  /** 初始化：从 storage 加载 */
  async function init() {
    log.info('初始化笔记');
    const data = await notesStorage.getValue();
    if (data && Array.isArray(data.titles)) {
      titles.value = data.titles;
      log.info('从 storage 加载笔记', { titleCount: titles.value.length });
    } else {
      titles.value = [];
      log.info('首次加载，笔记为空');
    }
    ready.value = true;
  }

  /** 持久化到 storage（剥离 Vue 代理） */
  async function persist() {
    await notesStorage.setValue({ titles: plain(titles.value) });
  }

  /**
   * 添加笔记条目
   * @param titleName - 标题名（匹配已有则追加，否则新建）
   * @param entry - 笔记条目（不含 id 和 timestamp，自动生成）
   */
  async function addEntry(
    titleName: string,
    entry: Omit<NoteEntry, 'id' | 'timestamp'>,
  ): Promise<{ titleId: string; entryId: string }> {
    const trimmed = titleName.trim();
    if (!trimmed) {
      throw new Error('笔记标题不能为空');
    }

    const now = Date.now();
    const existing = titles.value.find((t) => t.title === trimmed);

    if (existing) {
      const entryId = genId();
      existing.entries = [...existing.entries, { ...entry, id: entryId, timestamp: now }];
      existing.updatedAt = now;
      await persist();
      log.info('追加笔记条目', { titleId: existing.id, entryId });
      return { titleId: existing.id, entryId };
    }

    const titleId = genId();
    const entryId = genId();
    titles.value = [...titles.value, {
      id: titleId,
      title: trimmed,
      entries: [{ ...entry, id: entryId, timestamp: now }],
      createdAt: now,
      updatedAt: now,
    }];
    await persist();
    log.info('新建笔记标题+条目', { titleId, entryId });
    return { titleId, entryId };
  }

  /** 删除标题（整组笔记） */
  async function deleteTitle(titleId: string) {
    titles.value = titles.value.filter((t) => t.id !== titleId);
    await persist();
    log.info('删除笔记标题', { titleId });
  }

  /** 删除单条条目 */
  async function deleteEntry(titleId: string, entryId: string) {
    const title = titles.value.find((t) => t.id === titleId);
    if (!title) return;
    const newEntries = title.entries.filter((e) => e.id !== entryId);
    if (newEntries.length === 0) {
      // 标题下没有条目了，删除整个标题
      titles.value = titles.value.filter((t) => t.id !== titleId);
    } else {
      title.entries = newEntries;
      title.updatedAt = Date.now();
    }
    await persist();
    log.info('删除笔记条目', { titleId, entryId });
  }

  /** 更新条目内容（编辑用） */
  async function updateEntryContent(
    titleId: string,
    entryId: string,
    content: string,
  ) {
    const title = titles.value.find((t) => t.id === titleId);
    if (!title) return;
    const entry = title.entries.find((e) => e.id === entryId);
    if (!entry) return;
    entry.content = content;
    title.updatedAt = Date.now();
    await persist();
    log.info('更新笔记内容', { titleId, entryId });
  }

  /** 重命名标题 */
  async function renameTitle(titleId: string, newTitle: string) {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    // 检查重名
    const duplicate = titles.value.find((t) => t.title === trimmed && t.id !== titleId);
    if (duplicate) {
      throw new Error('已存在同名笔记');
    }
    const title = titles.value.find((t) => t.id === titleId);
    if (!title) return;
    title.title = trimmed;
    title.updatedAt = Date.now();
    await persist();
    log.info('重命名笔记标题', { titleId, newTitle: trimmed });
  }

  /** 获取所有标题名列表 */
  function getTitleNames(): string[] {
    return titles.value.map((t) => t.title);
  }

  /** 导入笔记数据（合并，深拷贝） */
  async function importNotes(data: NotesData) {
    if (!data || !Array.isArray(data.titles)) return;
    for (const incoming of data.titles) {
      if (!incoming.title || !Array.isArray(incoming.entries)) continue;

      const existing = titles.value.find((t) => t.title === incoming.title);
      if (existing) {
        // 合并条目（去重 by id，深拷贝）
        const existingIds = new Set(existing.entries.map((e) => e.id));
        const newEntries = incoming.entries
          .filter((e) => e.id && !existingIds.has(e.id))
          .map((e) => ({ ...e }));
        existing.entries = [...existing.entries, ...newEntries].sort((a, b) => a.timestamp - b.timestamp);
        existing.updatedAt = Date.now();
      } else {
        // 深拷贝，避免共享引用
        titles.value = [...titles.value, {
          ...incoming,
          entries: incoming.entries.map((e) => ({ ...e })),
        }];
      }
    }
    await persist();
    log.info('导入笔记', { imported: data.titles.length });
  }

  return {
    titles,
    ready,
    init,
    addEntry,
    deleteTitle,
    deleteEntry,
    updateEntryContent,
    renameTitle,
    getTitleNames,
    importNotes,
  };
});
