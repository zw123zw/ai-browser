/**
 * 百度智能云实时语音识别引擎
 *
 * 免费额度：3000 分钟/月 + 5 万次短语音
 *
 * 协议流程（基于官方文档）：
 * 1. WebSocket 连接 wss://vop.baidu.com/realtime_asr?sn=UUID
 * 2. 发送 JSON 开始帧（含 appid + appkey + dev_pid）
 * 3. 发送二进制音频帧（PCM 16kHz 16bit）
 * 4. 接收 JSON 识别结果（MID_TEXT 临时 / FIN_TEXT 最终）
 * 5. 发送 JSON 结束帧
 *
 * 文档：https://ai.baidu.com/ai-doc/SPEECH/qlc0h61h7
 */

import { Logger } from '@/src/utils/logger'
import type { VoiceEngine, VoiceEngineConfig, VoiceEngineStatus } from './types'

const log = new Logger('BaiduEngine')

/** 百度配置 */
export interface BaiduConfig {
  /** 应用 ID (App ID) */
  appId: string
  /** API Key */
  apiKey: string
  /** Secret Key（实时 ASR 不需要，保留用于其他 API） */
  apiSecret: string
}

export class BaiduEngine implements VoiceEngine {
  readonly name = 'baidu'

  private _status: VoiceEngineStatus = 'idle'
  private _isActive = false
  private config: Required<VoiceEngineConfig>
  private baiduConfig: BaiduConfig
  private ws: WebSocket | null = null
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private scriptProcessor: ScriptProcessorNode | null = null
  private silenceFrames = 0
  private static readonly SILENCE_THRESHOLD = 10
  private static readonly SILENCE_ENERGY = 0.01

  onResult: ((text: string, isFinal: boolean, confidence: number) => void) | null = null
  onError: ((error: string) => void) | null = null
  onStatusChange: ((status: VoiceEngineStatus) => void) | null = null

  constructor(baiduConfig: BaiduConfig, engineConfig?: VoiceEngineConfig) {
    this.baiduConfig = baiduConfig
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

      // 2. 连接 WebSocket
      await this.connectWebSocket()

      // 3. 发送开始参数帧
      this.sendStartFrame()

      // 4. 创建音频管道
      this.audioContext = new AudioContext({ sampleRate: 16000 })
      await this.audioContext.resume()
      const source = this.audioContext.createMediaStreamSource(this.mediaStream)
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1)

      this.scriptProcessor.onaudioprocess = (event) => {
        if (!this._isActive || !this.ws || this.ws.readyState !== WebSocket.OPEN) return

        const audioData = event.inputBuffer.getChannelData(0)
        const pcmData = this.float32ToInt16(audioData)

        // VAD 静音检测
        let energy = 0
        for (let i = 0; i < audioData.length; i++) energy += audioData[i] * audioData[i]
        energy /= audioData.length

        if (energy < BaiduEngine.SILENCE_ENERGY) {
          this.silenceFrames++
          if (this.silenceFrames >= BaiduEngine.SILENCE_THRESHOLD) {
            this.silenceFrames = 0
            this.sendFinishFrame()
            return
          }
        } else {
          this.silenceFrames = 0
        }

        // 发送二进制音频帧（Binary opcode）
        this.ws.send(pcmData.buffer)
      }

      source.connect(this.scriptProcessor)
      this.scriptProcessor.connect(this.audioContext.destination)

      this._isActive = true
      this.updateStatus('listening')
      log.info('百度引擎已启动', { appId: this.baiduConfig.appId })

    } catch (error) {
      log.error('启动失败:', error)
      this.updateStatus('error')
      this.onError?.(`百度引擎启动失败: ${error}`)
      this.cleanup()
    }
  }

  stop(): void {
    log.info('停止百度引擎')
    this._isActive = false
    this.sendFinishFrame()
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

  /** 连接 WebSocket */
  private connectWebSocket(): Promise<void> {
    const sn = crypto.randomUUID()
    const url = `wss://vop.baidu.com/realtime_asr?sn=${sn}`
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        log.info('百度 WebSocket 连接成功', { sn })
        resolve()
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }

      this.ws.onerror = (error) => {
        log.error('百度 WebSocket 错误:', error)
        reject(new Error('百度 WebSocket 连接失败'))
      }

      this.ws.onclose = (event) => {
        log.info('百度 WebSocket 关闭', { code: event.code, reason: event.reason })
      }
    })
  }

  /** 发送开始参数帧（JSON Text opcode） */
  private sendStartFrame(): void {
    const appkey = this.baiduConfig.apiKey
    log.info('百度配置', {
      appId: this.baiduConfig.appId,
      appkey: appkey ? appkey.slice(0, 8) + '...' : '(空)',
      apiSecret: this.baiduConfig.apiSecret ? this.baiduConfig.apiSecret.slice(0, 8) + '...' : '(空)',
    })
    const frame = {
      type: 'START',
      data: {
        appid: parseInt(this.baiduConfig.appId) || 0,
        appkey,
        dev_pid: this.config.lang === 'en-US' ? 17372 : 15372,
        cuid: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
        format: 'pcm',
        sample: 16000,
      },
    }
    this.ws?.send(JSON.stringify(frame))
    log.info('百度开始帧已发送', { appid: frame.data.appid, appkey: appkey?.slice(0, 8) + '...', dev_pid: frame.data.dev_pid })
  }

  /** 发送结束帧（JSON Text opcode） */
  private sendFinishFrame(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'FINISH' }))
      log.info('百度结束帧已发送')
    }
  }

  /** 处理服务端消息 */
  private handleMessage(data: string): void {
    try {
      const result = JSON.parse(data)

      // 心跳帧，忽略
      if (result.type === 'HEARTBEAT') return

      // 错误
      if (result.err_no !== 0) {
        log.error('百度错误:', result.err_no, result.err_msg)
        this.onError?.(`百度错误(${result.err_no}): ${result.err_msg}`)
        return
      }

      // 临时识别结果
      if (result.type === 'MID_TEXT') {
        const text = result.result || ''
        if (!text) return
        log.debug('百度临时结果', { text })
        this.onResult?.(text, false, 0)
        return
      }

      // 最终识别结果
      if (result.type === 'FIN_TEXT') {
        const text = result.result || ''
        if (!text) {
          // 空的 FIN_TEXT 可能是错误句，重连继续
          this.reconnect()
          return
        }
        log.info('百度最终结果', { text, start_time: result.start_time, end_time: result.end_time })
        this.onResult?.(text, true, 1)
        // 重连继续监听
        this.reconnect()
        return
      }

    } catch (error) {
      log.error('解析百度消息失败:', error)
    }
  }

  /** 重连（final 结果后继续监听） */
  private async reconnect(): Promise<void> {
    try {
      if (this.ws) {
        this.ws.onclose = null
        this.ws.onerror = null
        this.ws.close()
        this.ws = null
      }
      this.silenceFrames = 0
      await this.connectWebSocket()
      this.sendStartFrame()
    } catch (error) {
      log.error('百度重连失败:', error)
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
