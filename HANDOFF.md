# HANDOFF — mac-video-transfer
更新：2026-08-07／claude

## 目前目標
提供 Mac 本機 Electron 影片壓縮工具，讓使用者拖入影片後以 FFmpeg 壓縮輸出。

## 狀態
- 已完成：主要功能實作、北歐設計系統、app icon 更新（f4aaf24，2026-01-02）
- 驗收現況：21 個 Playwright 自動化測試連跑兩次全綠（~5s/次）
  - 原本 10 個 GUI 驗收測試全部保留（啟動、FFmpeg 路徑、選檔、壓縮+ffprobe 驗產物、拖放、零 console error）
  - 新增 9 個 fps 解析測試（8 邏輯等價＋1 端到端）：parseFraction 安全解析 + get-video-info fps 回傳值驗證
  - 新增 2 個錯誤處理測試：不存在檔案 → 錯誤 toast + App 不 crash
- 本輪修復的 bug：
  1. **[安全] eval() 注入**（main.js）：fps 解析改用安全 parseFraction，消除影片 metadata 注入風險
  2. **輸入驗證**（main.js）：get-video-info/convert-video 加檔案存在性檢查，錯誤訊息改中文
  3. **IPC listener 累積**（preload.js）：onConversionStarted/onConversionProgress 註冊前先移除舊 listener
  4. **取消後雙面板**（renderer.js）：showResults 防禦性隱藏 fileListContainer；取消無結果時回檔案清單
  5. **取消清理**（main.js）：改 SIGTERM→500ms SIGKILL 漸進式終止，並清除不完整輸出檔
- 仍需人工（測試無法自動化的部分）：
  - 打包版（`npm run build:dmg`）安裝後，FFmpeg/FFprobe 路徑解析在真正 packaged 環境下的行為
  - 真正用滑鼠把 Finder 中的檔案拖到視窗上（OS 級拖放手勢本身）
  - 硬體加速編碼器（h265_hw/h264_hw, VideoToolbox）在其他 Mac 機型上的相容性

## 下一步（接手的人從這裡開始）
1. 若要驗證打包版：`npm run build:dmg`，安裝後確認 FFmpeg 路徑 fix（9866ac1）在打包環境仍正確
2. `npm audit` 漏洞評估（electron-builder / playwright 開發期依賴為主），暫不影響本機使用
3. 跑測試：`npm run test:e2e`（或 `npx playwright test`），目前 21 個測試

## 地雷（別踩）
- FFmpeg 路徑在打包後與開發時不同，已有 fix（9866ac1），改動相關路徑需重測打包版
- node_modules 已存在，可直接用，但 dist/ 中已有打包版本，重建會覆蓋
- 本機 npm（11.6.4）重新 install 會把 package-lock.json 重新排版成一大坨 diff
- Electron 28 的 `electronApp.evaluate()` 在 main process context 裡沒有 CJS `require`
  （main.js 模組作用域的 require 是模組 wrapper 注入的區域變數，不是全域）
- main.js 的 parseFraction() 是安全的 fps 分數解析器，取代了原本的 eval()，不可改回 eval

## 主辦權
單線／待分派
