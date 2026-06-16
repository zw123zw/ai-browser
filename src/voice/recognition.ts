/**
 * Web Speech API 语音识别封装
 *
 * 支持：
 * - 连续对话模式（continuous mode）
 * - 自动重启（错误/结束时）
 * - 中间结果回调
 * - 手动启停控制
 */

import { Logger } from '@/src/utils/logger';

const log = new Logger('VoiceRecognition');

// Web Speech API 类型声明
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionConstructor;
    webkitSpeechRecognition: SpeechRecognitionConstructor;
  }
}

export type VoiceStatus =
  | 'idle'        // 未启动
  | 'listening'   // 正在聆听
  | 'processing'  // 处理中（AI 解析）
  | 'error';      // 出错

export interface VoiceRecognitionOptions {
  /** 语言，默认 zh-CN */
  lang?: string;
  /** 是否连续识别，默认 true */
  continuous?: boolean;
  /** 是否返回中间结果，默认 true */
  interimResults?: boolean;
  /** 识别结果回调（含置信度） */
  onResult: (text: string, isFinal: boolean, confidence: number) => void;
  /** 状态变化回调 */
  onStatusChange?: (status: VoiceStatus) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
}

export class VoiceRecognition {
  private recognition: SpeechRecognitionInstance | null = null;
  private status: VoiceStatus = 'idle';
  private options: VoiceRecognitionOptions;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private _isActive = false;
  private logPrefix = '[VoiceRecognition]';

  constructor(options: VoiceRecognitionOptions) {
    this.options = {
      lang: 'zh-CN',
      continuous: true,
      interimResults: true,
      ...options,
    };
  }

  /** 是否正在运行 */
  get isActive(): boolean {
    return this._isActive;
  }

  /** 当前状态 */
  get currentStatus(): VoiceStatus {
    return this.status;
  }

  /** 检查浏览器是否支持 Web Speech API */
  static isSupported(): boolean {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /** 启动语音识别 */
  start(): void {
    if (this._isActive) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.updateStatus('error');
      this.options.onError?.('当前浏览器不支持语音识别，请使用 Chrome 或 Edge');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = this.options.lang ?? 'zh-CN';
    this.recognition.continuous = this.options.continuous ?? true;
    this.recognition.interimResults = this.options.interimResults ?? true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        const isFinal = result.isFinal;
        const confidence = result[0].confidence ?? 0;

        if (text) {
          if (isFinal) {
            log.info(`识别完成: "${text}" (confidence=${confidence.toFixed(2)})`);
          }
          this.options.onResult(text, isFinal, confidence);
        }
      }
    };

    this.recognition.onerror = (event: any) => {
      log.warn('Error:', event.error);

      // 不是致命错误时自动重启
      if (event.error === 'no-speech' || event.error === 'audio-capture') {
        this.scheduleRestart(1000);
        return;
      }

      // 麦克风权限错误
      if (event.error === 'not-allowed') {
        this.updateStatus('error');
        this.options.onError?.('麦克风权限被拒绝，请在浏览器设置中允许');
        this._isActive = false;
        return;
      }

      // 网络错误 - 语音识别需要联网（Chrome 使用 Google 服务）
      if (event.error === 'network') {
        log.warn('网络错误，语音识别需要联网');
        this.scheduleRestart(3000);
        return;
      }

      // 其他错误
      log.warn('未知错误:', event.error);
      this.scheduleRestart(2000);
    };

    this.recognition.onend = () => {
      // 连续模式下，非主动停止时自动重启
      if (this._isActive && this.options.continuous) {
        this.scheduleRestart(300);
        return;
      }

      if (this._isActive) {
        this.scheduleRestart(1000);
      }
    };

    try {
      this.recognition.start();
      this._isActive = true;
      this.updateStatus('listening');
      log.info(`语音识别已启动, lang=${this.options.lang}`);
    } catch (e) {
      log.error('启动失败:', e);
      this.updateStatus('error');
      this.options.onError?.('语音识别启动失败');
    }
  }

  /** 停止语音识别 */
  stop(): void {
    log.info('停止语音识别');
    this._isActive = false;
    this.clearRestartTimer();

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // 忽略已停止的错误
      }
      this.recognition = null;
    }

    this.updateStatus('idle');
  }

  /** 暂停识别（处理 AI 请求时使用） */
  pause(): void {
    if (this.recognition && this._isActive) {
      try {
        this.recognition.stop();
      } catch {
        // 忽略
      }
      this.updateStatus('processing');
    }
  }

  /** 恢复识别 */
  resume(): void {
    if (this._isActive) {
      this.start();
    }
  }

  /** 切换启停 */
  toggle(): void {
    if (this._isActive) {
      this.stop();
    } else {
      this.start();
    }
  }

  /** 销毁实例 */
  destroy(): void {
    this.stop();
    this.recognition = null;
  }

  private updateStatus(status: VoiceStatus): void {
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  private scheduleRestart(delay: number): void {
    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      if (this._isActive) {
        try {
          this.recognition?.start();
          this.updateStatus('listening');
        } catch {
          // 如果启动失败，再次尝试
          this.scheduleRestart(2000);
        }
      }
    }, delay);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}
