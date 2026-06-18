/**
 * 文件解析器 — 将不同文件类型解析为统一的 Attachment 结构
 */
import { v4 as uuid } from 'uuid';
import type { Attachment } from '@/src/types';
import { detectFileType, getCodeLang, getExtension } from './file-type';
import { fileToDataURL } from './file';
import { recognizeImage, type OcrProgressCallback } from './ocr';
import { Logger } from './logger';

const log = new Logger('FileParsers');

/** 内存缓存：attachment id → 原始 File（不持久化，页面刷新自动释放） */
const originalFileCache = new Map<string, File>();

/** 获取附件对应的原始 File 对象（仅当前会话有效） */
export function getOriginalFile(attachment: Attachment): File | null {
  return originalFileCache.get(attachment.id) ?? null;
}

/** 移除缓存条目（附件被删除时调用） */
export function removeFromFileCache(attachmentId: string): void {
  originalFileCache.delete(attachmentId);
}

/** 文本内容最大 100KB（约 25000 中文字） */
export const MAX_TEXT_CONTENT_SIZE = 100 * 1024;
/** 文本文件最大 2MB（读取后截断到 100KB） */
const MAX_TEXT_FILE_SIZE = 2 * 1024 * 1024;
/** 二进制文件（PDF/Office）最大 10MB */
export const MAX_BINARY_FILE_SIZE = 10 * 1024 * 1024;
/** 图片最大 20MB */
export const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024;

/**
 * 统一文件解析入口
 * @throws 文件过大或不支持时抛出错误，由调用方捕获处理
 */
export async function parseFile(file: File): Promise<Attachment> {
  const type = detectFileType(file);
  log.info('解析文件', { name: file.name, type, size: file.size });

  let attachment: Attachment;
  switch (type) {
    case 'image':
      log.info('→ parseImage', file.name);
      attachment = await parseImage(file);
      break;
    case 'text':
    case 'code':
      log.info('→ parseText', { name: file.name, type });
      attachment = await parseText(file, type);
      break;
    case 'pdf':
      attachment = await parsePdf(file);
      break;
    case 'word':
      attachment = await parseWord(file);
      break;
    case 'excel':
      attachment = await parseExcel(file);
      break;
    case 'binary':
    default:
      log.info('→ parseBinary', file.name);
      attachment = await parseBinary(file);
      break;
  }

  // 专用解析器失败或内容为空时，尝试按文本读取作为兜底（parseBinary 内部已处理，跳过；image 的 content 为空是正常的，也跳过）
  if (type !== 'binary' && type !== 'image' && (!attachment.content || attachment.content.startsWith('['))) {
    log.info('兜底 tryReadAsText', { name: file.name, type, contentEmpty: !attachment.content, contentStart: attachment.content?.slice(0, 30) });
    const textFallback = await tryReadAsText(file);
    if (textFallback) {
      log.info('兜底成功 → text', file.name);
      attachment = textFallback;
    }
  }

  log.info('最终结果', { name: attachment.name, type: attachment.type, contentLen: attachment.content?.length, contentPreview: attachment.content?.slice(0, 50) });

  // 缓存原始 File 引用，供预览 modal 下载使用
  originalFileCache.set(attachment.id, file);
  return attachment;
}

/** 解析图片 → dataURL（立即返回，OCR 由调用方异步触发） */
async function parseImage(file: File): Promise<Attachment> {
  if (file.size > MAX_IMAGE_FILE_SIZE) {
    throw new Error(`图片过大 (${formatMB(file.size)})，最大支持 ${formatMB(MAX_IMAGE_FILE_SIZE)}`);
  }
  const dataUrl = await fileToDataURL(file);
  return {
    id: uuid(),
    type: 'image',
    name: file.name,
    size: file.size,
    mimeType: file.type,
    dataUrl,
  };
}

/**
 * 对已解析的图片附件执行 OCR，就地更新 content 字段
 * @param attachment  图片附件（会被就地修改）
 * @param onProgress  进度回调 (0~1)
 */
export async function ocrAttachment(
  attachment: Attachment,
  onProgress?: OcrProgressCallback
): Promise<void> {
  if (attachment.type !== 'image' || !attachment.dataUrl) {
    log.info('ocrAttachment skip', { type: attachment.type, hasDataUrl: !!attachment.dataUrl });
    return;
  }
  log.info('ocrAttachment start', { name: attachment.name });
  const text = await recognizeImage(attachment.dataUrl, onProgress);
  log.info('ocrAttachment done', { name: attachment.name, textLen: text.length, preview: text.slice(0, 50) });
  if (text) attachment.content = text;
}

/** 解析文本/代码文件 → 文本内容 */
async function parseText(file: File, type: 'text' | 'code'): Promise<Attachment> {
  if (file.size > MAX_TEXT_FILE_SIZE) {
    throw new Error(`文件过大 (${formatMB(file.size)})，最大支持 ${formatMB(MAX_TEXT_FILE_SIZE)}`);
  }
  const content = await readTextFile(file);
  const lang = type === 'code' ? getCodeLang(file.name) : undefined;
  const truncated = content.length > MAX_TEXT_CONTENT_SIZE;
  return {
    id: uuid(),
    type,
    name: file.name,
    size: file.size,
    mimeType: file.type,
    content: truncated ? content.slice(0, MAX_TEXT_CONTENT_SIZE) : content,
    lang,
    truncated,
  };
}

/** 解析 PDF → 提取文本 */
async function parsePdf(file: File): Promise<Attachment> {
  if (file.size > MAX_BINARY_FILE_SIZE) {
    throw new Error(`PDF 过大 (${formatMB(file.size)})，最大支持 ${formatMB(MAX_BINARY_FILE_SIZE)}`);
  }
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = await import('pdfjs-dist');
    // 扩展 content script 中 Worker URL 解析会指向页面域名导致失败，
    // 预导入 worker 模块到全局变量，让 pdfjs 走主线程 fake worker 模式
    if (!(globalThis as any).pdfjsWorker) {
      try {
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs' as string);
        (globalThis as any).pdfjsWorker = { WorkerMessageHandler: (worker as any).WorkerMessageHandler };
      } catch {
        // worker 导入失败，设置空 src 让 pdfjs 跳过
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
      }
    }

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const textParts: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      textParts.push(pageText);
    }

    const content = textParts.join('\n\n').trim();
    if (!content) {
      return {
        id: uuid(),
        type: 'pdf',
        name: file.name,
        size: file.size,
        mimeType: file.type,
        content: '[PDF 无可提取文本（可能是扫描件/图片型 PDF）]',
      };
    }
    const truncated = content.length > MAX_TEXT_CONTENT_SIZE;
    return {
      id: uuid(),
      type: 'pdf',
      name: file.name,
      size: file.size,
      mimeType: file.type,
      content: truncated ? content.slice(0, MAX_TEXT_CONTENT_SIZE) : content,
      truncated,
    };
  } catch (e) {
    if ((e as Error).message?.includes('过大')) throw e;
    log.error('PDF 解析失败', { name: file.name, error: (e as Error).message });
    return {
      id: uuid(),
      type: 'pdf',
      name: file.name,
      size: file.size,
      mimeType: file.type,
      content: `[PDF 解析失败: ${(e as Error).message}]`,
    };
  }
}

/** 解析 Word 文档 → 提取文本 */
async function parseWord(file: File): Promise<Attachment> {
  if (file.size > MAX_BINARY_FILE_SIZE) {
    throw new Error(`Word 文档过大 (${formatMB(file.size)})，最大支持 ${formatMB(MAX_BINARY_FILE_SIZE)}`);
  }
  try {
    const arrayBuffer = await file.arrayBuffer();
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer });
    const content = result.value.trim();
    if (!content) {
      return {
        id: uuid(),
        type: 'word',
        name: file.name,
        size: file.size,
        mimeType: file.type,
        content: '[Word 文档无可提取文本]',
      };
    }
    const truncated = content.length > MAX_TEXT_CONTENT_SIZE;
    return {
      id: uuid(),
      type: 'word',
      name: file.name,
      size: file.size,
      mimeType: file.type,
      content: truncated ? content.slice(0, MAX_TEXT_CONTENT_SIZE) : content,
      truncated,
    };
  } catch (e) {
    if ((e as Error).message?.includes('过大')) throw e;
    log.error('Word 解析失败', { name: file.name, error: (e as Error).message });
    return {
      id: uuid(),
      type: 'word',
      name: file.name,
      size: file.size,
      mimeType: file.type,
      content: `[Word 解析失败: ${(e as Error).message}]`,
    };
  }
}

/** 解析 Excel/CSV → CSV 文本 */
async function parseExcel(file: File): Promise<Attachment> {
  if (file.size > MAX_BINARY_FILE_SIZE) {
    throw new Error(`Excel 文件过大 (${formatMB(file.size)})，最大支持 ${formatMB(MAX_BINARY_FILE_SIZE)}`);
  }
  try {
    const ext = getExtension(file.name);
    let content: string;

    // CSV/TSV 直接读文本
    if (['csv', 'tsv'].includes(ext)) {
      content = await readTextFile(file);
    } else {
      const arrayBuffer = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const parts: string[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        parts.push(`--- ${sheetName} ---\n${csv}`);
      }
      content = parts.join('\n\n');
    }

    if (!content.trim()) {
      return {
        id: uuid(),
        type: 'excel',
        name: file.name,
        size: file.size,
        mimeType: file.type,
        content: '[Excel 文件无数据]',
      };
    }
    const truncated = content.length > MAX_TEXT_CONTENT_SIZE;
    return {
      id: uuid(),
      type: 'excel',
      name: file.name,
      size: file.size,
      mimeType: file.type,
      content: truncated ? content.slice(0, MAX_TEXT_CONTENT_SIZE) : content,
      truncated,
    };
  } catch (e) {
    if ((e as Error).message?.includes('过大')) throw e;
    log.error('Excel 解析失败', { name: file.name, error: (e as Error).message });
    return {
      id: uuid(),
      type: 'excel',
      name: file.name,
      size: file.size,
      mimeType: file.type,
      content: `[Excel 解析失败: ${(e as Error).message}]`,
    };
  }
}

/** 尝试按文本读取文件，成功返回 Attachment，失败返回 null */
async function tryReadAsText(file: File): Promise<Attachment | null> {
  try {
    let content = await readTextFile(file);
    if (content.length === 0) return null;
    // 去除 null 字节（二进制文件读取为文本时可能出现）
    if (content.includes('\0')) {
      content = content.replace(/\0/g, '');
    }
    // 去除后仍有可读内容（至少有 10 个可打印字符）
    const printable = content.replace(/[\x00-\x08\x0e-\x1f]/g, '');
    if (printable.length < 10) return null;

    log.info('文件按文本读取成功', { name: file.name, length: content.length });
    const lang = getCodeLang(file.name);
    const truncated = content.length > MAX_TEXT_CONTENT_SIZE;
    return {
      id: uuid(),
      type: lang ? 'code' : 'text',
      name: file.name,
      size: file.size,
      mimeType: file.type,
      content: truncated ? content.slice(0, MAX_TEXT_CONTENT_SIZE) : content,
      lang,
      truncated,
    };
  } catch {
    // 读取失败
  }
  return null;
}

/** 不支持的二进制文件 → 尝试读取为文本，失败则仅保留元信息 */
async function parseBinary(file: File): Promise<Attachment> {
  const textResult = await tryReadAsText(file);
  if (textResult) return textResult;

  return {
    id: uuid(),
    type: 'binary',
    name: file.name,
    size: file.size,
    mimeType: file.type,
    content: `[不支持预览此文件类型: ${file.type || '未知'}]`,
  };
}

/**
 * 读取文本文件内容（UTF-8）
 */
async function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

/** 格式化 MB */
function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
