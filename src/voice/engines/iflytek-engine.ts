/**
 * 讯飞语音听写 WebSocket 引擎
 *
 * 国内用户引擎，识别质量顶级
 * 免费 5 万次/天
 *
 * 文档：https://www.xfyun.cn/doc/asr/voicedictation/API.html
 */

import { Logger } from '@/src/utils/logger'
import type { VoiceEngine, VoiceEngineConfig, VoiceEngineStatus } from './types'

const log = new Logger('IflytekEngine')

/** 讯飞配置 */
export interface IflytekConfig {
  /** 应用 ID */
  appId: string
  /** API Key */
  apiKey: string
  /** API Secret */
  apiSecret?: string
}

/** 讯飞 WebSocket 响应 */
interface IflytekResult {
  code: number
  message: string
  data?: {
    result?: {
      ws: Array<{
        cw: Array<{
          w: string
          sc?: number
        }>
      }>
      sn?: string
      pgs?: string
      rg?: number[]
      ls?: boolean
    }
    status: number
    sid?: string
  }
  sid?: string
}

export class IflytekEngine implements VoiceEngine {
  readonly name = 'iflytek'

  private _status: VoiceEngineStatus = 'idle'
  private _isActive = false
  private config: Required<VoiceEngineConfig>
  private iflytekConfig: IflytekConfig
  private ws: WebSocket | null = null
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private scriptProcessor: ScriptProcessorNode | null = null
  private isFirstFrame = true
  private finalText = ''

  onResult: ((text: string, isFinal: boolean, confidence: number) => void) | null = null
  onError: ((error: string) => void) | null = null
  onStatusChange: ((status: VoiceEngineStatus) => void) | null = null

  constructor(iflytekConfig: IflytekConfig, engineConfig?: VoiceEngineConfig) {
    this.iflytekConfig = iflytekConfig
    this.config = {
      lang: engineConfig?.lang ?? 'zh-CN',
      continuous: engineConfig?.continuous ?? true,
      interimResults: engineConfig?.interimResults ?? true,
    }
  }

  get isActive(): boolean {
    return this._isActive
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
      const source = this.audioContext.createMediaStreamSource(this.mediaStream)
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1)

      this.isFirstFrame = true
      this.finalText = ''

      this.scriptProcessor.onaudioprocess = (event) => {
        if (!this._isActive || !this.ws || this.ws.readyState !== WebSocket.OPEN) return

        const audioData = event.inputBuffer.getChannelData(0)
        const pcmData = this.float32ToInt16(audioData)

        if (this.isFirstFrame) {
          // 第一帧：发送 common + business 参数
          this.sendFirstFrame(pcmData)
          this.isFirstFrame = false
        } else {
          // 后续帧：发送音频数据
          this.sendAudioFrame(pcmData)
        }
      }

      source.connect(this.scriptProcessor)
      this.scriptProcessor.connect(this.audioContext.destination)

      this._isActive = true
      this.updateStatus('listening')
      log.info('讯飞引擎已启动')

    } catch (error) {
      log.error('启动失败:', error)
      this.updateStatus('error')
      this.onError?.(`讯飞引擎启动失败: ${error}`)
      this.cleanup()
    }
  }

  stop(): void {
    log.info('停止讯飞引擎')
    this._isActive = false

    // 发送最后一帧（status=2）
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

  /** 构建鉴权 URL */
  private buildAuthUrl(): string {
    const url = 'wss://iat-api.xfyun.cn/v2/iat'
    const { apiKey, apiSecret, appId } = this.iflytekConfig

    // 如果没有 apiSecret，使用简化鉴权（仅 apiKey + appId）
    if (!apiSecret) {
      return `${url}?appid=${appId}&apikey=${apiKey}`
    }

    // 完整鉴权：HMAC-SHA256 签名
    const date = new Date().toUTCString()
    const signatureOrigin = `host: iat-api.xfyun.cn\ndate: ${date}\nGET /v2/iat HTTP/1.1`
    const signature = this.hmacSha256(signatureOrigin, apiSecret)
    const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
    const authorization = btoa(authorizationOrigin)

    return `${url}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=iat-api.xfyun.cn`
  }

  /** HMAC-SHA256 签名 */
  private async hmacSha256(message: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const msgData = encoder.encode(message)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData)
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
  }

  /** 连接 WebSocket */
  private async connectWebSocket(): Promise<void> {
    const url = this.buildAuthUrl()

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

      this.ws.onclose = () => {
        log.info('WebSocket 连接关闭')
      }
    })
  }

  /** 处理 WebSocket 消息 */
  private handleMessage(data: string): void {
    try {
      const result: IflytekResult = JSON.parse(data)

      if (result.code !== 0) {
        log.error('讯飞错误:', result.code, result.message)
        this.onError?.(`讯飞错误: ${result.message}`)
        return
      }

      if (!result.data?.result) return

      const { ws, pgs, ls } = result.data.result
      let text = ''

      // 拼接识别结果
      for (const seg of ws) {
        for (const cw of seg.cw) {
          text += cw.w
        }
      }

      if (!text) return

      if (pgs === 'apd') {
        // 追加模式
        this.finalText += text
      } else {
        // 替换模式
        this.finalText = text
      }

      const isFinal = ls === true
      const confidence = ws[0]?.cw[0]?.sc ?? 0

      log.info('识别结果:', { text: this.finalText, isFinal, confidence })
      this.onResult?.(this.finalText, isFinal, confidence / 100)

      // 最终结果后重置
      if (isFinal) {
        this.finalText = ''
      }

    } catch (error) {
      log.error('解析消息失败:', error)
    }
  }

  /** 发送第一帧（含参数） */
  private sendFirstFrame(audioData: Int16Array): void {
    const frame = {
      common: {
        app_id: this.iflytekConfig.appId,
      },
      business: {
        language: this.config.lang === 'en-US' ? 'en_us' : 'zh_cn',
        domain: 'iat',
        accent: 'mandarin',
        vad_eos: 3000,
        dwa: 'wpgs',
        ptt: 0,
        nunum: 1,
      },
      data: {
        status: 0,
        format: 'audio/L16;rate=16000',
        encoding: 'raw',
        audio: this.arrayBufferToBase64(audioData.buffer),
      },
    }

    this.ws?.send(JSON.stringify(frame))
  }

  /** 发送音频帧 */
  private sendAudioFrame(audioData: Int16Array): void {
    const frame = {
      data: {
        status: 1,
        format: 'audio/L16;rate=16000',
        encoding: 'raw',
        audio: this.arrayBufferToBase64(audioData.buffer),
      },
    }

    this.ws?.send(JSON.stringify(frame))
  }

  /** 发送最后一帧 */
  private sendLastFrame(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const frame = {
        data: {
          status: 2,
          format: 'audio/L16;rate=16000',
          encoding: 'raw',
          audio: '',
        },
      }

      this.ws.send(JSON.stringify(frame))
    }
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
