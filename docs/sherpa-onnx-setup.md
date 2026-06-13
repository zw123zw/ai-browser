# Sherpa-onnx 本地语音识别配置

## 下载中文模型

### 方式 1：手动下载（推荐）

1. 访问模型下载页面：
   ```
   https://github.com/k2-fsa/sherpa-onnx/releases
   ```

2. 下载中文流式模型：
   ```
   sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2
   ```

3. 解压到项目的 `public/models/` 目录：
   ```
   E:\note\ai-browser\public\models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\
   ```

### 方式 2：使用 wget 下载

```bash
# 创建模型目录
mkdir -p public/models

# 下载模型（约 200MB）
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2

# 解压
tar -xvf sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2 -C public/models/

# 删除压缩包
rm sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2
```

## 模型文件结构

下载完成后，目录结构应该是：

```
public/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/
├── encoder-epoch-99-avg-1.int8.onnx    # 编码器模型
├── decoder-epoch-99-avg-1.onnx          # 解码器模型
├── joiner-epoch-99-avg-1.int8.onnx      # 连接器模型
├── tokens.txt                           # 词表文件
└── ...
```

## 其他可用模型

| 模型 | 大小 | 准确率 | 说明 |
|------|------|--------|------|
| sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20 | ~200MB | ⭐⭐⭐⭐ | 中英双语，推荐 |
| sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16 | ~80MB | ⭐⭐⭐ | 轻量版 |
| sherpa-onnx-streaming-paraformer-bilingual-zh-en | ~300MB | ⭐⭐⭐⭐⭐ | 最高准确率 |

## 验证模型

下载后运行开发服务器测试：

```bash
npm run dev
```

打开浏览器控制台，查看是否有模型加载成功的日志。

## 常见问题

### Q: 模型文件太大，无法打包到扩展中？

A: 模型文件不需要打包到扩展中。用户首次使用时会自动下载，或者可以配置为从 CDN 加载。

### Q: 支持哪些浏览器？

A: 支持所有现代浏览器（Chrome 90+, Edge 90+, Firefox 90+, Safari 15+）。

### Q: 识别准确率如何？

A: 中文识别准确率约 90-95%，接近 Google 语音识别水平。
