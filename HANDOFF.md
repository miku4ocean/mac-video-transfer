# HANDOFF — mac-video-transfer
更新：2026-07-21／claude

## 目前目標
提供 Mac 本機 Electron 影片壓縮工具，讓使用者拖入影片後以 FFmpeg 壓縮輸出。

## 狀態
- 已完成：主要功能實作、北歐設計系統、app icon 更新（f4aaf24，2026-01-02）
- 驗收現況：「穩定」屬實。已驗證：git 乾淨、npm install 成功、main.js/renderer.js/preload.js
  語法檢查通過、ffmpeg-static/ffprobe-static 二進位可解析且存在、`electron .`
  在開發模式下成功啟動主程序並正確印出 FFmpeg/FFprobe 路徑（未見 crash）。
  公開 repo 已 grep 無硬編碼金鑰；dist/、node_modules/、.DS_Store 均正確 gitignore 未進 git。
- 未驗證（需人手 GUI）：拖入影片實際壓縮流程、打包後 DMG 版本的 FFmpeg 路徑（asar.unpacked
  邏輯在 main.js 已見但未跑打包驗證，因任務要求不做打包發佈）。

## 下一步（接手的人從這裡開始）
1. 手動開 App 拖入一支影片，確認壓縮流程與進度顯示正常
2. 若要驗證打包版：`npm run build:dmg`，安裝後確認 FFmpeg 路徑 fix（9866ac1）在打包環境仍正確
3. `npm audit` 顯示 15 個漏洞（1 critical），多為 electron-builder 開發期依賴，暫不影響本機使用，
   之後有空可評估 `npm audit fix`

## 地雷（別踩）
- FFmpeg 路徑在打包後與開發時不同，已有 fix（9866ac1），改動相關路徑需重測打包版
- node_modules 已存在（257 目錄），可直接用，但 dist/ 中已有打包版本，重建會覆蓋
- 本機 npm（11.6.4）重新 install 會把 package-lock.json 重新排版成一大坨 diff（內容無異動，
  純格式），驗證後已 checkout 還原，勿誤 commit 這種純格式化 diff

## 主辦權
單線／待分派
