# mac-video-transfer — 薄索引
跨平台規則正本：`~/.agents/institution/`（先讀 core/PRINCIPLES.md，照其指示附版本標記）。

## 專案專屬
- Build/test 指令：`npm start`（開發）、`npm run build`（打包 DMG）、`npm run build:dmg`（僅 DMG）
- 架構一句話：Electron 桌面應用，呼叫 ffmpeg-static 在本機壓縮影片，無後端服務。
- 本專案禁區：不得改動 `dist/` 已打包產物（重建即可）；node_modules/ 不要追蹤。
