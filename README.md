# Mac Video Compressor & Converter

一個強大的 Mac 影片壓縮轉檔工具，使用 FFmpeg 進行高效率的影片處理。

## ✨ 功能特色

- **高效壓縮**：使用 H.265 (HEVC) 或 H.264 編碼，可將 2-5GB 的影片壓縮至數百 MB
- **保持畫質**：使用 CRF (Constant Rate Factor) 技術，在壓縮的同時保持高畫質
- **保持解析度**：不會縮放影片，維持原始解析度
- **多格式支援**：
  - **輸入格式**：MOV, MP4, MPG/MPEG, WMV, WebM, AVI, MKV, FLV, M4V, 3GP
  - **輸出格式**：MP4, WebM, MKV, AVI
- **批次處理**：支援同時處理多個檔案
- **即時預覽**：顯示轉檔進度和預估完成時間
- **拖放支援**：直接拖放檔案到應用程式視窗

## 🎯 壓縮品質選項

| 模式 | CRF 值 | 說明 |
|------|--------|------|
| 高畫質 | 18-20 | 幾乎無損，檔案較大 |
| 平衡 | 23-25 | 推薦使用，畫質與大小平衡 |
| 小檔案 | 28-30 | 明顯壓縮，檔案最小 |

## 🚀 安裝

### 開發環境

```bash
# 安裝依賴
npm install

# 啟動開發模式
npm run dev
```

### 建置應用程式

```bash
# 建置 Mac 應用程式
npm run build

# 建置 DMG 安裝檔
npm run build:dmg
```

## 📋 系統需求

- macOS 10.13 或更新版本
- 約 200MB 磁碟空間

## 🛠️ 技術架構

- **Electron** - 跨平台桌面應用框架
- **FFmpeg** - 業界標準的影片處理工具
- **fluent-ffmpeg** - Node.js FFmpeg 包裝器

## 📝 授權

MIT License
