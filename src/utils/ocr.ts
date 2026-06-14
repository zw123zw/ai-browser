/**
 * OCR 文字识别工具 — 基于 Tesseract.js
 *
 * 在前端对图片执行 OCR，提取文字内容。
 * 支持中文简体 + 英文混合识别。
 * 语言包从扩展本地加载，避免 CSP 阻止 CDN 请求。
 */

/** OCR 进度回调 */
export type OcrProgressCallback = (progress: number) => void;

/** 语言包标识 */
const OCR_LANG = 'chi_sim+eng';

/** OCR 超时时间（30秒） */
const OCR_TIMEOUT = 30_000;

/** 获取扩展内语言包路径 */
function getLangPath(): string | undefined {
  try {
    return (globalThis as any).chrome?.runtime?.getURL?.('/tesseract');
  } catch {
    return undefined;
  }
}

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
  try {
    const Tesseract = await import('tesseract.js');
    const langPath = getLangPath();

    const ocrPromise = Tesseract.recognize(dataUrl, OCR_LANG, {
      langPath,
      logger: (info: any) => {
        if (info.status === 'recognizing text' && onProgress) {
          onProgress(info.progress);
        }
      },
    });

    // 超时保护：防止语言包下载失败导致蒙层永久卡住
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT)
    );

    const result = await Promise.race([ocrPromise, timeoutPromise]);
    return result.data.text?.trim() || '';
  } catch {
    return '';
  }
}
