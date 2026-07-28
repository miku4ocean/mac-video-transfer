# HANDOFF — mac-video-transfer
更新：2026-07-29／claude

## 目前目標
提供 Mac 本機 Electron 影片壓縮工具，讓使用者拖入影片後以 FFmpeg 壓縮輸出。

## 狀態
- 已完成：主要功能實作、北歐設計系統、app icon 更新（f4aaf24，2026-01-02）
- 驗收現況：「穩定」屬實，且原本 L17「手動測拖曳壓縮」已補上 Playwright 自動化測試
  （`tests/electron-app.spec.ts`、`tests/ffmpeg-path-resolution.spec.ts`，10 個測試，
  連跑兩次全綠，每次約 3-7 秒；仿照 markdown-master-electron／image-viewer-ocr 的
  `_electron` 驅動寫法）。涵蓋：
  - App 啟動零例外、主視窗渲染、全程 console 零 error
  - FFmpeg/FFprobe 路徑解析（開發模式分支）：讀取 main process 實際印出的路徑並驗證
    存在、可執行（`electronApp.evaluate()` 在這版 Electron 的 CDP context 沒有
    CJS `require`，改用 capture stdout 的方式驗證，測試檔內有註解說明）
  - 檔案選取（mock `dialog.showOpenDialog`）→ 壓縮（mock `dialog.showSaveDialog`，
    其餘走真實 ffmpeg 二進位對自製 2 秒測試影片實際壓縮）→ 用真實 ffprobe 驗證輸出
  - 拖放：合成帶 `.path` 的 File 觸發 `drop` 事件（renderer.js 直接讀 `f.path`，
    不是新版 `webUtils.getPathForFile`，這招在本專案有效）
  - FFmpeg packaged 分支（`app.asar` → `app.asar.unpacked`）：main.js 沒 export
    該函式，改用邏輯等價測試覆蓋 `tests/ffmpeg-path-resolution.spec.ts`
- 仍需人工（測試無法自動化的部分，見 spec 檔頭註解）：
  - 打包版（`npm run build:dmg`）安裝後，FFmpeg/FFprobe 路徑解析在真正 packaged
    環境下的行為（本測試只能在未打包狀態跑，packaged 分支只驗證了字串轉換邏輯）
  - 真正用滑鼠把 Finder 中的檔案拖到視窗上（OS 級拖放手勢本身）
  - 硬體加速編碼器（h265_hw/h264_hw, VideoToolbox）在其他 Mac 機型上的相容性

## 下一步（接手的人從這裡開始）
1. 若要驗證打包版：`npm run build:dmg`，安裝後確認 FFmpeg 路徑 fix（9866ac1）在打包環境仍正確
2. `npm audit` 目前 18 個漏洞（1 critical，此次新增 playwright devDependency 後從 15→18），
   多為 electron-builder / playwright 開發期依賴，暫不影響本機使用，之後有空可評估 `npm audit fix`
3. 跑測試：`npm run test:e2e`（或 `npx playwright test`）

## 地雷（別踩）
- FFmpeg 路徑在打包後與開發時不同，已有 fix（9866ac1），改動相關路徑需重測打包版
- node_modules 已存在，可直接用，但 dist/ 中已有打包版本，重建會覆蓋
- 本機 npm（11.6.4）重新 install 會把 package-lock.json 重新排版成一大坨 diff（內容無異動，
  純格式）；這次新增 playwright devDependency 時的 diff 已核對過，純新增 4 個套件
  （@playwright/test、playwright、playwright-core、fsevents），沒有既有套件版本被改動
- Electron 28 的 `electronApp.evaluate()` 在 main process context 裡沒有 CJS `require`
  （main.js 模組作用域的 require 是模組 wrapper 注入的區域變數，不是全域），別想在
  evaluate callback 裡直接 require 東西，要嘛靠 stdout 讀 main.js 印出的值，要嘛用
  evaluate 參數本身帶進去的 electron 模組物件（app/dialog/...）

## 主辦權
單線／待分派
