/**
 * 火山引擎语音识别 WebSocket 引擎
 *
 * 国内用户引擎，免费额度大（50 万分钟）
 *
 * 文档：https://www.volcengine.com/docs/6561/97465
 * 协议：JSON over WebSocket（与讯飞类似）
 *  - 第一帧：JSON 配置（audio 为空字符串）
 *  - 后续帧：JSON + base64 音频数据
 *  - 最后一帧：sequence = -1
 */

import { Logger } from '@/src/utils/logger'
import type { VoiceEngine, VoiceEngineConfig, VoiceEngineStatus } from './types'

const log = new Logger('VolcengineEngine')

/** 火山引擎配置 */
export interface VolcengineConfig {
  /** 应用 ID */
  appId: string
  /** Access Token */
  accessToken: string
}

export class VolcengineEngine implements VoiceEngine {
  readonly name = 'volcengine'

  private _status: VoiceEngineStatus = 'idle'
  private _isActive = false
  private config: Required<VoiceEngineConfig>
  private volcConfig: VolcengineConfig
  private ws: WebSocket | null = null
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private scriptProcessor: ScriptProcessorNode | null = null
  private isFirstFrame = true
  private finalText = ''
  private sequence = 0
  /** 静音帧计数，用于自动发送最后一帧 */
  private silenceFrames = 0
  /** 连续多少帧静音后自动结束（每帧 256ms，10帧 ≈ 2.5秒） */
  private static readonly SILENCE_THRESHOLD = 10
  /** 静音能量阈值 */
  private static readonly SILENCE_ENERGY = 0.01

  onResult: ((text: string, isFinal: boolean, confidence: number) => void) | null = null
  onError: ((error: string) => void) | null = null
  onStatusChange: ((status: VoiceEngineStatus) => void) | null = null

  constructor(volcConfig: VolcengineConfig, engineConfig?: VoiceEngineConfig) {
    this.volcConfig = volcConfig
    this.config = {
      lang: engineConfig?.lang ?? 'zh-CN',
      continuous: engineConfig?.continuous ?? true,
      interimResults: engineConfig?.interimResults ?? true,
    }
  }

  get isActive(): boolean {
    return this._isActive
  }

  isAlive(): boolean {
    return this._isActive && this.ws !== null
  }

  get status(): VoiceEngineStatus {
    return this._status
  }

  async start(): Promise<void> {
    if (this._isActive) return

    try {
      // 1. 获取麦克风权限
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      // 2. 创建 WebSocket 连接
      await this.connectWebSocket()

      // 3. 创建音频处理管道
      this.audioContext = new AudioContext({ sampleRate: 16000 })
      await this.audioContext.resume()
      const source = this.audioContext.createMediaStreamSource(this.mediaStream)
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1)

      this.isFirstFrame = true
      this.finalText = ''
      this.sequence = 0

      this.scriptProcessor.onaudioprocess = (event) => {
        if (!this._isActive || !this.ws || this.ws.readyState !== WebSocket.OPEN) return

        const audioData = event.inputBuffer.getChannelData(0)
        const pcmData = this.float32ToInt16(audioData)

        // VAD：检测静音
        let energy = 0
        for (let i = 0; i < audioData.length; i++) {
          energy += audioData[i] * audioData[i]
        }
        energy /= audioData.length

        if (energy < VolcengineEngine.SILENCE_ENERGY) {
          this.silenceFrames++
          if (this.silenceFrames >= VolcengineEngine.SILENCE_THRESHOLD) {
            log.info('VAD 静音检测，发送最后一帧', { frames: this.silenceFrames, energy })
            this.silenceFrames = 0
            this.sendLastFrame()
            return
          }
        } else {
          this.silenceFrames = 0
        }

        if (this.isFirstFrame) {
          // 第一帧：发送配置（不含音频）
          this.sendFirstFrame()
          this.isFirstFrame = false
        }

        // 每帧都发音频数据
        this.sendAudioFrame(pcmData)
      }

      source.connect(this.scriptProcessor)
      this.scriptProcessor.connect(this.audioContext.destination)

      this._isActive = true
      this.updateStatus('listening')
      log.info('火山引擎已启动')

    } catch (error) {
      log.error('启动失败:', error)
      this.updateStatus('error')
      this.onError?.(`火山引擎启动失败: ${error}`)
      this.cleanup()
    }
  }

  stop(): void {
    log.info('停止火山引擎')
    this._isActive = false

    // 发送最后一帧
    this.sendLastFrame()
    this.cleanup()
    this.updateStatus('idle')
  }

  pause(): void {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect()
    }
    this.updateStatus('processing')
  }

  resume(): void {
    if (this.audioContext && this.scriptProcessor) {
      this.scriptProcessor.connect(this.audioContext.destination)
      this.updateStatus('listening')
    }
  }

  destroy(): void {
    this.stop()
  }

  /** 连接 WebSocket */
  private connectWebSocket(): Promise<void> {
    const url = `wss://openspeech.bytedance.com/api/v2/asr?appid=${this.volcConfig.appId}&token=${this.volcConfig.accessToken}`

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        log.info('WebSocket 连接成功')
        resolve()
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }

      this.ws.onerror = (error) => {
        log.error('WebSocket 错误:', error)
        reject(new Error('WebSocket 连接失败'))
      }

      this.ws.onclose = (event) => {
        log.info('WebSocket 连接关闭', { code: event.code, reason: event.reason })
      }
    })
  }

  /** 处理 WebSocket 消息 */
  private handleMessage(data: string): void {
    try {
      const result = JSON.parse(data)
      log.info('火山消息', { code: result.code, hasResult: !!result.result })

      if (result.code !== 0) {
        log.error('火山引擎错误:', result.code, result.message)
        this.onError?.(`火山引擎错误: ${result.message}`)
        return
      }

      if (!result.result) return

      const utterance = result.result.utterance as string | undefined
      const isFinal = result.result.definite === 1
      const text = utterance || ''

      if (!text && !isFinal) return

      if (text) {
        this.finalText = text
      }

      const confidence = result.result.confidence ?? 0
      log.info('识别结果:', { text: this.finalText, isFinal, confidence })
      this.onResult?.(this.finalText, isFinal, confidence)

      // 最终结果后重置，重新建立连接继续监听
      if (isFinal) {
        this.finalText = ''
        this.reconnect()
      }

    } catch (error) {
      log.error('解析消息失败:', error)
    }
  }

  /** 发送第一帧（仅配置，不含音频） */
  private sendFirstFrame(): void {
    const frame = {
      app: {
        appid: this.volcConfig.appId,
        token: this.volcConfig.accessToken,
        cluster: 'volcengine_streaming_asr',
      },
      user: {
        uid: 'aib-user',
      },
      audio: {
        format: 'pcm',
        codec: 'raw',
        rate: 16000,
        bits: 16,
        channel: 1,
      },
      request: {
        reqid: this.generateUUID(),
        sequence: 0,
        nbest: 1,
        text: '',
        show_utterances: true,
      },
    }

    this.ws?.send(JSON.stringify(frame))
  }

  /** 发送音频帧 */
  private sendAudioFrame(audioData: Int16Array): void {
    const frame = {
      request: {
        reqid: this.generateUUID(),
        sequence: this.sequence,
        text: '',
      },
      audio: this.arrayBufferToBase64(audioData.buffer),
    }

    this.sequence++
    this.ws?.send(JSON.stringify(frame))
  }

  /** 发送最后一帧（sequence = -1 表示结束） */
  private sendLastFrame(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const frame = {
        request: {
          reqid: this.generateUUID(),
          sequence: -1,
          text: '',
        },
      }

      this.ws.send(JSON.stringify(frame))
    }
  }

  /** 重新建立 WebSocket 连接（final 结果后继续监听） */
  private async reconnect(): Promise<void> {
    try {
      if (this.ws) {
        this.ws.onclose = null
        this.ws.onerror = null
        this.ws.close()
        this.ws = null
      }
      this.isFirstFrame = true
      this.silenceFrames = 0
      this.sequence = 0
      await this.connectWebSocket()
    } catch (error) {
      log.error('重新连接失败:', error)
    }
  }

  /** 生成 UUID */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  /** Float32 PCM 转 Int16 PCM */
  private float32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length)
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]))
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return int16Array
  }

  /** ArrayBuffer 转 Base64 */
  private arrayBufferToBase64(buffer: ArrayBufferLike): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
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

    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // 忽略
      }
      this.ws = null
    }
  }

  private updateStatus(status: VoiceEngineStatus): void {
    if (this._status === status) return
    this._status = status
    this.onStatusChange?.(status)
  }
}
