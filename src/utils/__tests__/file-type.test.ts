import { describe, it, expect } from 'vitest'
import { getExtension, detectFileType, getCodeLang, getFileTypeIcon, formatFileSize } from '../file-type'

describe('getExtension', () => {
  it('普通文件', () => {
    expect(getExtension('document.pdf')).toBe('pdf')
  })

  it('多个点的文件名', () => {
    expect(getExtension('archive.tar.gz')).toBe('gz')
  })

  it('无扩展名', () => {
    expect(getExtension('Makefile')).toBe('')
  })

  it('大写扩展名应转小写', () => {
    expect(getExtension('README.MD')).toBe('md')
  })
})

describe('detectFileType', () => {
  it('图片文件（MIME）', () => {
    const file = new File([''], 'photo.jpg', { type: 'image/jpeg' })
    expect(detectFileType(file)).toBe('image')
  })

  it('图片文件（扩展名）', () => {
    const file = new File([''], 'photo.png', { type: 'image/png' })
    expect(detectFileType(file)).toBe('image')
  })

  it('PDF 文件', () => {
    const file = new File([''], 'document.pdf', { type: 'application/pdf' })
    expect(detectFileType(file)).toBe('pdf')
  })

  it('Word 文件', () => {
    const file = new File([''], 'report.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    expect(detectFileType(file)).toBe('word')
  })

  it('Excel 文件', () => {
    const file = new File([''], 'data.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    expect(detectFileType(file)).toBe('excel')
  })

  it('JavaScript 代码文件', () => {
    const file = new File([''], 'app.js', { type: '' })
    expect(detectFileType(file)).toBe('code')
  })

  it('TypeScript 代码文件', () => {
    const file = new File([''], 'index.ts', { type: '' })
    expect(detectFileType(file)).toBe('code')
  })

  it('Python 代码文件', () => {
    const file = new File([''], 'script.py', { type: '' })
    expect(detectFileType(file)).toBe('code')
  })

  it('文本文件', () => {
    const file = new File([''], 'readme.txt', { type: 'text/plain' })
    expect(detectFileType(file)).toBe('text')
  })

  it('Markdown 文件', () => {
    const file = new File([''], 'README.md', { type: '' })
    expect(detectFileType(file)).toBe('code')
  })

  it('JSON 文件', () => {
    const file = new File([''], 'config.json', { type: '' })
    expect(detectFileType(file)).toBe('code')
  })

  it('CSV 文件', () => {
    const file = new File([''], 'data.csv', { type: 'text/csv' })
    expect(detectFileType(file)).toBe('text')
  })

  it('二进制文件', () => {
    const file = new File([''], 'data.bin', { type: 'application/octet-stream' })
    expect(detectFileType(file)).toBe('binary')
  })

  it('无扩展名无 MIME → 文本', () => {
    const file = new File([''], 'Makefile', { type: '' })
    expect(detectFileType(file)).toBe('text')
  })

  it('LICENSE 文件', () => {
    const file = new File([''], 'LICENSE', { type: '' })
    expect(detectFileType(file)).toBe('text')
  })
})

describe('getCodeLang', () => {
  it('JavaScript', () => {
    expect(getCodeLang('app.js')).toBe('javascript')
  })

  it('TypeScript', () => {
    expect(getCodeLang('index.ts')).toBe('typescript')
  })

  it('Python', () => {
    expect(getCodeLang('script.py')).toBe('python')
  })

  it('HTML', () => {
    expect(getCodeLang('index.html')).toBe('html')
  })

  it('CSS', () => {
    expect(getCodeLang('style.css')).toBe('css')
  })

  it('Vue', () => {
    expect(getCodeLang('App.vue')).toBe('vue')
  })

  it('Go', () => {
    expect(getCodeLang('main.go')).toBe('go')
  })

  it('Rust', () => {
    expect(getCodeLang('lib.rs')).toBe('rust')
  })

  it('Java', () => {
    expect(getCodeLang('App.java')).toBe('java')
  })

  it('未知扩展名应返回 undefined', () => {
    expect(getCodeLang('file.xyz')).toBeUndefined()
  })
})

describe('getFileTypeIcon', () => {
  it('image → 🖼️', () => {
    expect(getFileTypeIcon('image')).toBe('🖼️')
  })

  it('text → 📄', () => {
    expect(getFileTypeIcon('text')).toBe('📄')
  })

  it('code → 💻', () => {
    expect(getFileTypeIcon('code')).toBe('💻')
  })

  it('pdf → 📕', () => {
    expect(getFileTypeIcon('pdf')).toBe('📕')
  })

  it('word → 📘', () => {
    expect(getFileTypeIcon('word')).toBe('📘')
  })

  it('excel → 📊', () => {
    expect(getFileTypeIcon('excel')).toBe('📊')
  })

  it('binary → 📦', () => {
    expect(getFileTypeIcon('binary')).toBe('📦')
  })
})

describe('formatFileSize', () => {
  it('字节', () => {
    expect(formatFileSize(500)).toBe('500 B')
  })

  it('KB', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
  })

  it('MB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
  })

  it('0 字节', () => {
    expect(formatFileSize(0)).toBe('0 B')
  })

  it('刚好 1KB', () => {
    expect(formatFileSize(1023)).toBe('1023 B')
  })
})
