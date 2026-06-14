/**
 * OCR 文字识别工具 — 基于 Tesseract.js
 *
 * 在前端对图片执行 OCR，提取文字内容。
 * 支持中文简体 + 英文混合识别。
 */
import { Logger } from './logger';

const log = new Logger('OCR');

/** OCR 进度回调 */
export type OcrProgressCallback = (progress: number) => void;

/** 语言包标识 */
const OCR_LANG = 'chi_sim+eng';

/**
 * 对图片 dataURL 执行 OCR 文字识别
 * @param dataUrl  图片的 base64 dataURL
 * @param onProgress  进度回调 (0~1)
 * @returns  识别出的文字内容
 */
export async function recognizeImage(
  dataUrl: string,
  onProgress?: OcrProgressCallback
): Promise<string> {
  log.info('开始 OCR 识别');

  try {
    const Tesseract = await import('tesseract.js');

    const result = await Tesseract.recognize(dataUrl, OCR_LANG, {
      logger: (info: any) => {
        if (info.status === 'recognizing text' && onProgress) {
          onProgress(info.progress);
        }
      },
    });

    const text = result.data.text?.trim() || '';
    log.info('OCR 完成', { textLength: text.length });
    return text;
  } catch (err) {
    log.error('OCR 识别失败', { error: (err as Error).message });
    return '';
  }
}
