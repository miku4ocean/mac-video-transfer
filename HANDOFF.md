# HANDOFF — mac-video-transfer
更新：2026-08-16／claude

## 目前目標
提供 Mac 本機 Electron 影片壓縮工具，讓使用者拖入影片後以 FFmpeg 壓縮輸出。

## 狀態
- 已完成：主要功能實作、北歐設計系統、app icon 更新（f4aaf24，2026-01-02）
- 驗收現況：43 個 Playwright 自動化測試連跑三次全綠（~60-90s/次，視系統負載）
  - 原本 21 個測試全部保留（GUI 驗收 6、fps 解析 9、錯誤處理 2、路徑解析 4）
  - 新增 4 個壓縮品質測試（`tests/compression-quality.spec.ts`）：1080p H.264 10s /
    4K H.265 5s / 720p 含音訊 3s 三種真實尺寸來源，走真正 GUI 選檔→壓縮→ffprobe
    驗證解析度/編碼/時長/音軌/壓縮比；另含進度條全程採樣（MutationObserver）驗證
    單調不倒退、不卡在中間；第 4 個是極低位元率來源的迴歸測試
  - 新增 5 個邊界情況測試（`tests/edge-cases.spec.ts`）：中文+空白檔名、極小檔案
    （<100KB/1s）、非影片檔（.txt 改副檔名）、損壞影片（截斷檔案 moov atom 遺失）、
    全程零未捕捉例外
  - 新增 13 個版面可用性測試（`tests/layout-responsive.spec.ts`）：900×600（下限）/
    1200×800（預設）/1920×1080 三種視窗尺寸 × dropZone/fileList/壓縮中三種畫面
    狀態，驗證無水平捲軸、進度條不溢出容器（含 0%/100% 邊界值）
- 本輪（2026-08-16）修復的真 bug：
  1. **[壓縮品質] 位元率下限蓋過原始位元率**（main.js Quality Percentage 模式）：
     `targetVideoBitrate` 先算 `原始位元率 × quality%`，再套 50kbps 下限
     `Math.max(target, 50000)`——但當來源本身位元率就低於 50kbps（例如低解析度、
     低動態的極小片段）時，這個下限會把目標位元率墊到比原始還高，讓「壓縮」
     出的檔案反而比原檔更大。修法：再加一道 `Math.min(target, originalVideoBitrate)`
     把目標值夾回原始位元率以內。迴歸測試見 compression-quality.spec.ts 測試 4。
- 上一輪（2026-08-07）修復的 bug：
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
3. 跑測試：`npm run test:e2e`（或 `npx playwright test`），目前 43 個測試
4. Target Size 模式（main.js L208-245）尚未被壓縮品質測試覆蓋到，且沒有套用
   「不超過原始位元率」的夾限（該模式允許使用者明確指定比原檔大的目標大小，
   語意上不算 bug，但接手者如果要動這段邏輯，留意這個差異）

## 地雷（別踩）
- FFmpeg 路徑在打包後與開發時不同，已有 fix（9866ac1），改動相關路徑需重測打包版
- node_modules 已存在，可直接用，但 dist/ 中已有打包版本，重建會覆蓋
- 本機 npm（11.6.4）重新 install 會把 package-lock.json 重新排版成一大坨 diff
- Electron 28 的 `electronApp.evaluate()` 在 main process context 裡沒有 CJS `require`
  （main.js 模組作用域的 require 是模組 wrapper 注入的區域變數，不是全域）
- main.js 的 parseFraction() 是安全的 fps 分數解析器，取代了原本的 eval()，不可改回 eval
- main.js Quality Percentage 模式的 50kbps 下限已加 `Math.min(target, originalVideoBitrate)`
  夾限（2026-08-16），不要單獨拿掉這行，否則極低位元率來源又會被「壓縮」成更大的檔案
- 本機這次跑測試時系統負載異常高（`uptime` load average 200~300，8 核心機器），
  疑似有其他無關的併發程序在跑；單次跑到 timeout 相關的偶發失敗（例如
  `electronApp.close()` 逾時、單一 Playwright 斷言 timeout）先懷疑是系統負載，
  重跑 1-2 次確認是否穩定重現，再判斷是不是真的 regression

## 主辦權
單線／待分派
