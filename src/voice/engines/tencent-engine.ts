/**
 * 腾讯云实时语音识别引擎
 *
 * 免费额度：1000 分钟/月
 *
 * 协议流程：
 * 1. 构建带鉴权参数的 WebSocket URL（HMAC-SHA256 签名）
 * 2. WebSocket 连接，发送 JSON 配置帧
 * 3. 发送二进制音频帧 → 结束帧
 *
 * 文档：https://cloud.tencent.com/document/product/1093/48982
 */

import { Logger } from '@/src/utils/logger'
import type { VoiceEngine, VoiceEngineConfig, VoiceEngineStatus } from './types'

const log = new Logger('TencentEngine')

/** 腾讯配置 */
export interface TencentConfig {
  /** 应用 ID (AppId) */
  appId: string
  /** Secret ID (API Key) */
  apiKey: string
  /** Secret Key (API Secret) */
  apiSecret: string
}

export class TencentEngine implements VoiceEngine {
  readonly name = 'tencent'

  private _status: VoiceEngineStatus = 'idle'
  private _isActive = false
  private config: Required<VoiceEngineConfig>
  private tencentConfig: TencentConfig
  private ws: WebSocket | null = null
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private scriptProcessor: ScriptProcessorNode | null = null
  private finalText = ''
  private voiceId = ''
  private silenceFrames = 0
  private static readonly SILENCE_THRESHOLD = 10
  private static readonly SILENCE_ENERGY = 0.01

  onResult: ((text: string, isFinal: boolean, confidence: number) => void) | null = null
  onError: ((error: string) => void) | null = null
  onStatusChange: ((status: VoiceEngineStatus) => void) | null = null

  constructor(tencentConfig: TencentConfig, engineConfig?: VoiceEngineConfig) {
    this.tencentConfig = tencentConfig
    this.config = {
      lang: engineConfig?.lang ?? 'zh-CN',
      continuous: engineConfig?.continuous ?? true,
      interimResults: engineConfig?.interimResults ?? true,
    }
  }

  get isActive(): boolean { return this._isActive }
  get status(): VoiceEngineStatus { return this._status }
  isAlive(): boolean { return this._isActive && this.ws !== null }

  async start(): Promise<void> {
    if (this._isActive) return

    try {
      // 1. 获取麦克风
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })

      // 2. 构建鉴权 URL 并连接
      const url = await this.buildAuthUrl()
      await this.connectWebSocket(url)

      // 3. 发送配置帧
      this.sendStartFrame()

      // 4. 创建音频管道
      this.audioContext = new AudioContext({ sampleRate: 16000 })
      await this.audioContext.resume()
      const source = this.audioContext.createMediaStreamSource(this.mediaStream)
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1)

      this.finalText = ''

      this.scriptProcessor.onaudioprocess = (event) => {
        if (!this._isActive || !this.ws || this.ws.readyState !== WebSocket.OPEN) return

        const audioData = event.inputBuffer.getChannelData(0)
        const pcmData = this.float32ToInt16(audioData)

        // VAD 静音检测
        let energy = 0
        for (let i = 0; i < audioData.length; i++) energy += audioData[i] * audioData[i]
        energy /= audioData.length

        if (energy < TencentEngine.SILENCE_ENERGY) {
          this.silenceFrames++
          if (this.silenceFrames >= TencentEngine.SILENCE_THRESHOLD) {
            this.silenceFrames = 0
            this.sendEndFrame()
            return
          }
        } else {
          this.silenceFrames = 0
        }

        // 发送二进制音频帧
        this.ws.send(pcmData.buffer)
      }

      source.connect(this.scriptProcessor)
      this.scriptProcessor.connect(this.audioContext.destination)

      this._isActive = true
      this.updateStatus('listening')
      log.info('腾讯引擎已启动')

    } catch (error) {
      log.error('启动失败:', error)
      this.updateStatus('error')
      this.onError?.(`腾讯引擎启动失败: ${error}`)
      this.cleanup()
    }
  }

  stop(): void {
    log.info('停止腾讯引擎')
    this._isActive = false
    this.sendEndFrame()
    this.cleanup()
    this.updateStatus('idle')
  }

  pause(): void {
    if (this.scriptProcessor) this.scriptProcessor.disconnect()
    this.updateStatus('processing')
  }

  resume(): void {
    if (this.audioContext && this.scriptProcessor) {
      this.scriptProcessor.connect(this.audioContext.destination)
      this.updateStatus('listening')
    }
  }

  destroy(): void { this.stop() }

  /** 构建带鉴权的 WebSocket URL */
  private async buildAuthUrl(): Promise<string> {
    const { appId, apiKey, apiSecret } = this.tencentConfig
    const timestamp = Math.floor(Date.now() / 1000)
    const expired = timestamp + 86400 // 24小时过期
    const nonce = Math.floor(Math.random() * 100000)
    const voiceId = crypto.randomUUID().replace(/-/g, '')
    this.voiceId = voiceId

    // 构建签名原文
    const signUrl = `asr.cloud.tencent.com/asr/v2/${appId}`
    const signString = `app_id=${appId}&expired=${expired}&nonce=${nonce}&secret_id=${apiKey}&timestamp=${timestamp}&voice_id=${voiceId}`

    // HMAC-SHA256 签名
    const signature = await this.hmacSha256(signString, apiSecret)

    const url = `wss://${signUrl}?app_id=${appId}&expired=${expired}&nonce=${nonce}&secret_id=${apiKey}&timestamp=${timestamp}&voice_id=${voiceId}&signature=${encodeURIComponent(signature)}`
    return url
  }

  /** HMAC-SHA256 签名 */
  private async hmacSha256(message: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const msgData = encoder.encode(message)
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData)
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
  }

  /** 连接 WebSocket */
  private connectWebSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        log.info('腾讯 WebSocket 连接成功')
        resolve()
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }

      this.ws.onerror = (error) => {
        log.error('腾讯 WebSocket 错误:', error)
        reject(new Error('腾讯 WebSocket 连接失败'))
      }

      this.ws.onclose = (event) => {
        log.info('腾讯 WebSocket 关闭', { code: event.code })
      }
    })
  }

  /** 发送配置帧 */
  private sendStartFrame(): void {
    const frame = {
      type: 'start',
      data: {
        appid: parseInt(this.tencentConfig.appId) || 0,
        voice_id: this.voiceId,
        voice_format: 1,
        engine_model_type: this.config.lang === 'en-US' ? '16k_en' : '16k_zh',
        needvad: 1,
      },
    }
    this.ws?.send(JSON.stringify(frame))
    log.info('腾讯配置帧已发送')
  }

  /** 发送结束帧 */
  private sendEndFrame(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'end', data: {} }))
    }
  }

  /** 处理服务端消息 */
  private handleMessage(data: string): void {
    try {
      const result = JSON.parse(data)

      if (result.code !== 0) {
        log.error('腾讯错误:', result.code, result.message)
        this.onError?.(`腾讯错误: ${result.message}`)
        return
      }

      const message = result.message || result.type

      if (message === 'result') {
        const text = result.result?.voice_text_str || ''
        const isFinal = result.result?.slice_type === 2
        const confidence = result.result?.confidence ?? 0

        if (!text) return

        this.finalText = text
        log.info('腾讯识别结果', { text, isFinal, confidence })
        this.onResult?.(this.finalText, isFinal, confidence / 100)

        if (isFinal) {
          this.finalText = ''
          this.reconnect()
        }
      }
    } catch (error) {
      log.error('解析腾讯消息失败:', error)
    }
  }

  /** 重连 */
  private async reconnect(): Promise<void> {
    try {
      if (this.ws) {
        this.ws.onclose = null
        this.ws.onerror = null
        this.ws.close()
        this.ws = null
      }
      this.silenceFrames = 0
      const url = await this.buildAuthUrl()
      await this.connectWebSocket(url)
      this.sendStartFrame()
    } catch (error) {
      log.error('腾讯重连失败:', error)
    }
  }

  /** Float32 → Int16 */
  private float32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length)
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]))
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return int16Array
  }

  /** 清理资源 */
  private cleanup(): void {
    if (this.scriptProcessor) { this.scriptProcessor.disconnect(); this.scriptProcessor = null }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null }
    if (this.audioContext) { this.audioContext.close(); this.audioContext = null }
    if (this.ws) { try { this.ws.close() } catch {} ; this.ws = null }
  }

  private updateStatus(status: VoiceEngineStatus): void {
    if (this._status === status) return
    this._status = status
    this.onStatusChange?.(status)
  }
}
