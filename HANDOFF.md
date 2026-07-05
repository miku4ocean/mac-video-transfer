# HANDOFF — mac-video-transfer
更新：2026-07-05／claude

## 目前目標
提供 Mac 本機 Electron 影片壓縮工具，讓使用者拖入影片後以 FFmpeg 壓縮輸出。

## 狀態
- 已完成：主要功能實作、北歐設計系統、app icon 更新（f4aaf24，2026-01-02）
- 進行中：無 WIP commit，工作區乾淨
- 驗收現況：未驗證（未跑 npm start 確認實際執行）

## 下一步（接手的人從這裡開始）
1. `npm install && npm start` 確認應用可正常啟動
2. 測試拖入影片壓縮流程，確認 FFmpeg 路徑正確（已有 fix commit 9866ac1）
3. 若需打包：`npm run build:dmg`，產物在 dist/

## 地雷（別踩）
- FFmpeg 路徑在打包後與開發時不同，已有 fix（9866ac1），改動相關路徑需重測打包版
- node_modules 已存在（257 目錄），可直接用，但 dist/ 中已有打包版本，重建會覆蓋

## 主辦權
單線／待分派
