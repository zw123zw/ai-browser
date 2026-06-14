/**
 * 文件解析器 — 将不同文件类型解析为统一的 Attachment 结构
 */
import { v4 as uuid } from 'uuid';
import type { Attachment } from '@/src/types';
import { detectFileType, getCodeLang, getExtension } from './file-type';
import { fileToDataURL } from './file';
import { Logger } from './logger';

const log = new Logger('FileParsers');

/** 文本内容最大 100KB（约 25000 中文字） */
export const MAX_TEXT_CONTENT_SIZE = 100 * 1024;
/** 文本文件最大 500KB（读取后截断到 100KB） */
const MAX_TEXT_FILE_SIZE = 500 * 1024;
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

  switch (type) {
    case 'image':
      return parseImage(file);
    case 'text':
    case 'code':
      return parseText(file, type);
    case 'pdf':
      return parsePdf(file);
    case 'word':
      return parseWord(file);
    case 'excel':
      return parseExcel(file);
    case 'binary':
    default:
      return parseBinary(file);
  }
}

/** 解析图片 → dataURL */
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
    // 设置 worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();

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

    const content = textParts.join('\n\n');
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
    const content = result.value;
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

/** 不支持的二进制文件 → 仅保留元信息 */
function parseBinary(file: File): Attachment {
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
