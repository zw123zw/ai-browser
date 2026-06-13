@echo off
chcp 65001 >nul

echo ==========================================
echo   Sherpa-onnx 中文语音识别模型下载
echo ==========================================
echo.
echo 模型信息：
echo   - 名称：sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20
echo   - 大小：约 200MB
echo   - 语言：中文 + 英文
echo   - 准确率：90-95%
echo.

set MODEL_DIR=public\models
set MODEL_NAME=sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20
set MODEL_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/%MODEL_NAME%.tar.bz2

REM 创建模型目录
if not exist "%MODEL_DIR%" mkdir "%MODEL_DIR%"

REM 检查是否已存在
if exist "%MODEL_DIR%\%MODEL_NAME%" (
    echo ✅ 模型已存在：%MODEL_DIR%\%MODEL_NAME%
    echo 如需重新下载，请先删除该目录
    pause
    exit /b 0
)

echo 📥 开始下载模型...
echo 下载地址：%MODEL_URL%
echo.
echo 请使用浏览器打开以下链接下载：
echo.
echo %MODEL_URL%
echo.
echo 下载完成后，请将 .tar.bz2 文件解压到 %MODEL_DIR%\ 目录
echo.
echo 或者使用 PowerShell 命令：
echo.
echo # 下载
echo Invoke-WebRequest -Uri "%MODEL_URL%" -OutFile "%MODEL_NAME%.tar.bz2"
echo.
echo # 解压（需要安装 7-Zip 或 tar）
echo tar -xjf "%MODEL_NAME%.tar.bz2" -C "%MODEL_DIR%"
echo.
pause
