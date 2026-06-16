/**
 * Sherpa-onnx 本地语音识别
 *
 * 完全离线运行，不需要网络连接
 * 使用 WebAssembly 技术在浏览器中运行
 */

import { Logger } from '@/src/utils/logger';

const log = new Logger('SherpaRecognition');

export type VoiceStatus =
  | 'idle'        // 未启动
  | 'listening'   // 正在聆听
  | 'processing'  // 处理中
  | 'error'       // 出错

export interface SherpaRecognitionOptions {
  /** 语言，默认 zh-CN */
  lang?: string
  /** 是否连续识别，默认 true */
  continuous?: boolean
  /** 识别结果回调 */
  onResult: (text: string, isFinal: boolean, confidence: number) => void
  /** 状态变化回调 */
  onStatusChange?: (status: VoiceStatus) => void
  /** 错误回调 */
  onError?: (error: string) => void
}

/**
 * Sherpa-onnx 语音识别类
 *
 * 使用方式：
 * 1. 下载中文模型到 public/models/ 目录
 * 2. 创建实例并启动
 */
export class SherpaRecognition {
  private status: VoiceStatus = 'idle'
  private options: SherpaRecognitionOptions
  private _isActive = false
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private scriptProcessor: ScriptProcessorNode | null = null
  private recognizer: any = null
  private isModelLoaded = false

  constructor(options: SherpaRecognitionOptions) {
    this.options = {
      lang: 'zh-CN',
      continuous: true,
      ...options,
    }
  }

  /** 是否正在运行 */
  get isActive(): boolean {
    return this._isActive
  }

  /** 当前状态 */
  get currentStatus(): VoiceStatus {
    return this.status
  }

  /** 启动语音识别 */
  async start(): Promise<void> {
    if (this._isActive) {
      log.warn('已在运行中')
      return
    }

    log.info('启动 Sherpa-onnx 语音识别')

    try {
      // 1. 加载模型（如果还没加载）
      if (!this.isModelLoaded) {
        await this.loadModel()
      }

      // 2. 获取麦克风权限
      log.info('请求麦克风权限...')
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      log.info('麦克风权限已获取')

      // 3. 创建音频处理管道
      this.audioContext = new AudioContext({ sampleRate: 16000 })
      const source = this.audioContext.createMediaStreamSource(this.mediaStream)

      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1)

      let lastText = ''

      this.scriptProcessor.onaudioprocess = (event) => {
        if (!this._isActive || !this.recognizer) return

        const audioData = event.inputBuffer.getChannelData(0)
        const samples = new Float32Array(audioData)

        // 喂入识别器
        this.recognizer.acceptWaveform(16000, samples)

        // 获取结果
        const result = this.recognizer.getResult()
        if (result && result.text && result.text.trim()) {
          const text = result.text.trim()
          // 避免重复回调
          if (text !== lastText) {
            lastText = text
            log.info('识别结果:', text)
            this.options.onResult(text, true, 0.9)
          }
        }
      }

      source.connect(this.scriptProcessor)
      this.scriptProcessor.connect(this.audioContext.destination)

      this._isActive = true
      this.updateStatus('listening')
      log.info('语音识别已启动')

    } catch (error) {
      log.error('启动失败:', error)
      this.updateStatus('error')
      this.options.onError?.(`启动失败: ${error}`)
      this.cleanup()
    }
  }

  /** 停止语音识别 */
  stop(): void {
    log.info('停止语音识别')
    this._isActive = false
    this.cleanup()
    this.updateStatus('idle')
  }

  /** 暂停识别 */
  pause(): void {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect()
    }
    this.updateStatus('processing')
  }

  /** 恢复识别 */
  resume(): void {
    if (this.audioContext && this.scriptProcessor) {
      this.scriptProcessor.connect(this.audioContext.destination)
      this.updateStatus('listening')
    }
  }

  /** 切换启停 */
  toggle(): void {
    if (this._isActive) {
      this.stop()
    } else {
      this.start()
    }
  }

  /** 销毁实例 */
  destroy(): void {
    this.stop()
  }

  /** 加载 Sherpa-onnx 模型 */
  private async loadModel(): Promise<void> {
    log.info('加载模型...')

    try {
      // 动态导入 sherpa-onnx WASM 版本
      const sherpa = await import('sherpa-onnx/sherpa-onnx-asr.js')
      log.info('sherpa-onnx ASR 模块加载成功')

      // 模型配置 - 使用流式中文模型
      const modelPath = '/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20'

      const config = {
        modelDir: modelPath,
        tokens: `${modelPath}/tokens.txt`,
        encoder: `${modelPath}/encoder-epoch-99-avg-1.int8.onnx`,
        decoder: `${modelPath}/decoder-epoch-99-avg-1.onnx`,
        joiner: `${modelPath}/joiner-epoch-99-avg-1.int8.onnx`,
        numThreads: 4,
        provider: 'wasm',
        sampleRate: 16000,
        featureDim: 80,
      }

      log.info('创建识别器...')
      this.recognizer = new sherpa.OnlineRecognizer(config)
      this.isModelLoaded = true
      log.info('模型加载完成')

    } catch (error) {
      log.error('模型加载失败:', error)
      throw new Error(`模型加载失败: ${error}`)
    }
  }

  /** 清理资源 */
  private cleanup(): void {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect()
      this.scriptProcessor = null
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
  }

  /** 更新状态 */
  private updateStatus(status: VoiceStatus): void {
    this.status = status
    this.options.onStatusChange?.(status)
  }
}
