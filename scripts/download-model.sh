#!/bin/bash

# 下载 Sherpa-onnx 中文语音识别模型
# 模型大小：约 200MB
# 支持中英双语识别

set -e

MODEL_DIR="public/models"
MODEL_NAME="sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20"
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2"

echo "=========================================="
echo "  Sherpa-onnx 中文语音识别模型下载"
echo "=========================================="
echo ""
echo "模型信息："
echo "  - 名称：${MODEL_NAME}"
echo "  - 大小：约 200MB"
echo "  - 语言：中文 + 英文"
echo "  - 准确率：90-95%"
echo ""

# 创建模型目录
mkdir -p "${MODEL_DIR}"

# 检查是否已存在
if [ -d "${MODEL_DIR}/${MODEL_NAME}" ]; then
    echo "✅ 模型已存在：${MODEL_DIR}/${MODEL_NAME}"
    echo "如需重新下载，请先删除该目录"
    exit 0
fi

echo "📥 开始下载模型..."
echo "下载地址：${MODEL_URL}"
echo ""

# 下载模型
if command -v wget &> /dev/null; then
    wget -O "${MODEL_NAME}.tar.bz2" "${MODEL_URL}"
elif command -v curl &> /dev/null; then
    curl -L -o "${MODEL_NAME}.tar.bz2" "${MODEL_URL}"
else
    echo "❌ 错误：需要 wget 或 curl"
    echo "请手动下载：${MODEL_URL}"
    exit 1
fi

echo ""
echo "📦 解压模型..."
tar -xjf "${MODEL_NAME}.tar.bz2" -C "${MODEL_DIR}"

echo ""
echo "🗑️  清理临时文件..."
rm -f "${MODEL_NAME}.tar.bz2"

echo ""
echo "✅ 模型下载完成！"
echo "位置：${MODEL_DIR}/${MODEL_NAME}"
echo ""
echo "文件列表："
ls -lh "${MODEL_DIR}/${MODEL_NAME}/"
