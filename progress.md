# progress.md — mac-video-transfer

> 本檔依實際讀取的原始碼與文件撰寫（`main.js`／`preload.js`／`renderer.js`／`index.html`／`package.json`／`HANDOFF.md`／`AGENTS.md`／`CLAUDE.md`／`README.md`／git log，讀取於 2026-07-24）。查不到之處一律標「未確認」，不臆造。

## A. 專案名稱

mac-video-transfer（產品名稱：Video Compressor / Video Compressor for Mac）

## B. 專案路徑

`/Users/leonalin/Code/mac-video-transfer`

## C. 專案簡介

一個 macOS 原生 Electron 桌面應用，讓使用者把影片檔拖進視窗，透過本機安裝的 FFmpeg（以 `ffmpeg-static`／`ffprobe-static` 綁定二進位，不需使用者自行安裝）進行壓縮／轉檔，支援 VideoToolbox 硬體加速。整個應用是**單一視窗、單頁四態**的架構：沒有多個頁面路由，`renderer.js` 依狀態切換顯示「空狀態拖放」「待處理清單」「轉檔進度」「完成結果」四個區塊。

注意：`Code/` 目錄下另有姊妹專案 `mac-video-transfer-web`（Web／雲端版本，若存在），與本專案為不同架構，本文件僅涵蓋 `mac-video-transfer`（原生 Electron 桌面版）。

## D. 專案開發目的

依 README.md 與 HANDOFF.md：提供 Mac 使用者一個**本機、免上傳**的影片壓縮工具，取代「上傳到網站壓縮」的常見流程，並用硬體加速大幅縮短處理時間。

## E. 解決使用者痛點

- 大型影片檔（例如手機拍攝的 4K/高位元率影片）佔用硬碟空間，需要快速縮小
- 多數線上壓縮工具需要把影片上傳到伺服器，對大檔案而言慢、對隱私敏感內容而言不安心；本工具全程在本機處理，影片不曾離開使用者的 Mac
- 一般使用者不熟悉 FFmpeg 指令列，本工具用圖形介面把常見的品質／大小／解析度／音訊選項封裝成表單與滑桿
- 需要把檔案壓縮到「指定大小以下」（例如上傳限制 100 MB）時，手動試錯 FFmpeg 參數很麻煩，本工具可直接輸入目標大小自動反推位元率

## F. 專案功能細項介紹

- 拖放或選擇多個影片檔案，批次加入待處理佇列（支援 MOV/MP4/MPG/MPEG/WMV/WebM/AVI/MKV/FLV/M4V/3GP）
- 讀取每個檔案的 ffprobe 資訊（解析度／時長／大小／原始位元率），並即時估算壓縮後大小與節省百分比
- 兩種壓縮模式：
  - **品質百分比模式**：品質滑桿 10–100%，代表輸出位元率為原始位元率的百分比
  - **目標大小模式**：直接輸入目標檔案大小（KB/MB/GB），系統自動反推所需位元率，並在位元率過低時自動降級音訊模式（保留原音 → 壓縮音訊 → 靜音）
- 編碼器選擇：H.265 硬體加速（VideoToolbox）、H.264 硬體加速、H.265 軟體編碼、H.264 軟體編碼、VP9
- 音訊三種模式：保持原始音訊／壓縮為 AAC 128kbps／靜音
- 解析度調整：可設定輸出寬度／高度其中之一或兩者，等比例縮放
- 快速預設按鈕：高畫質 75%／平衡 50%／小檔案 25%（皆搭配 H.265 硬體加速）
- 轉檔進度顯示：進度百分比、目前處理時間點、速度（fps）、已用時間、預估剩餘時間
- 取消轉檔功能（SIGKILL 目前 FFmpeg 子行程）
- 完成結果列表：顯示原始／壓縮後大小與節省百分比，可播放輸出檔、在 Finder 顯示、或用不同設定「再轉」同一原始檔
- 每個待處理檔案顯示「限定大小模式最小建議值」提示

## G. 專案規格及 RPD

**技術棧**
- Electron ^28.0.0（桌面應用框架，主行程 + 渲染行程）
- Node.js（Electron 內建）
- `fluent-ffmpeg` ^2.1.2（FFmpeg 指令組裝與事件監控）
- `ffmpeg-static` ^5.2.0／`ffprobe-static` ^3.1.0（隨應用綁定的本機二進位，免使用者另裝 FFmpeg）
- `electron-builder` ^24.9.1（打包 DMG／ZIP，僅開發期依賴）
- 前端：純 HTML／CSS／原生 JavaScript（無框架），`nordic-design-system.css` 為可重用設計系統

**埠**：不適用。純本機桌面應用，未開啟任何網路埠或伺服器（架構圖已確認無 API 層／雲端層）。

**指令**
- `npm start` 或 `npm run dev` — 開發模式啟動（`electron .`）
- `npm run build` — 打包 macOS DMG＋ZIP（`electron-builder --mac`）
- `npm run build:dmg` — 僅打包 DMG
- `npm run postinstall` — `electron-builder install-app-deps`（安裝後自動執行）

**資料流**
1. 使用者拖放或透過系統對話框選擇影片檔（`open-file-dialog` IPC）
2. renderer 呼叫 `window.api.getVideoInfo(filePath)` → main.js 用 ffprobe 讀取 metadata → 回傳給 renderer 顯示與估算
3. 使用者調整設定、按下「開始轉檔」
4. renderer 呼叫 `window.api.saveFileDialog(...)` 取得輸出路徑，再呼叫 `window.api.convertVideo({inputPath, outputPath, settings})`
5. main.js 依模式（品質% 或目標大小）計算目標位元率，組裝 FFmpeg 指令（`fluent-ffmpeg` → `ffmpeg-static` 二進位子行程）並開始轉檔
6. FFmpeg `progress` 事件透過 `webContents.send('conversion-progress', …)` 即時推回 renderer 更新進度條
7. 完成後 main.js 回傳輸出檔大小，renderer 記錄到結果列表；使用者可播放／開啟資料夾／再轉

全程不涉及任何網路請求或第三方服務。

## H. 目前已完成項目

- 核心壓縮流程完整實作（品質百分比 / 目標大小兩種模式），含音訊自動降級邏輯
- 五種編碼器選項（H.265/H.264 硬體加速、H.265/H.264 軟體、VP9）
- 解析度調整（等比例縮放）
- 批次多檔案佇列處理
- 即時進度顯示（速度／已處理時間／已用時間／預估剩餘）
- 「再轉」功能（用不同設定重新轉換同一原始檔，無需重新選檔）
- 快速預設按鈕（75%/50%/25%）
- 北歐設計系統 UI（`nordic-design-system.css`／`styles.css`），含 App icon 更新
- FFmpeg 路徑打包修正（`app.asar` → `app.asar.unpacked`，commit `9866ac1`）
- README 完整使用說明、常見問題、壓縮效果範例
- Smoke 驗證（commit `cc25c28`，據 HANDOFF.md）：git 工作目錄乾淨、`npm install` 成功、`main.js`/`renderer.js`/`preload.js` 語法檢查通過、`ffmpeg-static`/`ffprobe-static` 二進位可解析且存在、`electron .` 開發模式成功啟動主程序並正確印出 FFmpeg/FFprobe 路徑（未見 crash）
- 公開 repo 已 grep 確認無硬編碼金鑰；`dist/`／`node_modules/`／`.DS_Store` 均正確 `.gitignore`，未進版控

## I. 尚待完成項目

- **人手 GUI 驗證拖放壓縮全流程**：實際拖入一支影片、走完「選檔 → 調整設定 → 轉檔 → 進度顯示 → 輸出檔驗證」全流程，目前僅驗證主程序可啟動，未驗證真實轉檔行為（HANDOFF.md「下一步」第 1 項）
- **打包版（DMG）FFmpeg 路徑驗證**：`npm run build:dmg` 打包後安裝、確認 `app.asar.unpacked` 路徑修正在真實打包環境下仍正確運作；目前該修正只在開發模式下驗證過（HANDOFF.md「下一步」第 2 項）
- **`npm audit` 漏洞評估**：目前顯示 15 個漏洞（1 個 critical），多屬 `electron-builder` 開發期依賴，暫不影響本機使用功能，但尚未評估是否執行 `npm audit fix` 或有無更安全的替代方案（HANDOFF.md「下一步」第 3 項）
- **主辦權**：HANDOFF.md 記載為「單線／待分派」，目前無明確負責人接手後續工作
- 應用程式未經 Apple 開發者簽署／公證，使用者首次開啟需手動右鍵「打開」（README.md 已記載為已知限制，非規劃中的待辦，但屬於使用體驗上的缺口）

## J. 系統優化或增加功能建議

> 以下為依現況推導的建議，非既有規劃文件內容，僅供決策參考。

- 針對 `npm audit` 的 15 個漏洞（含 1 critical）逐一評估影響範圍，特別是打包流程相關依賴，必要時鎖定版本或尋找替代套件
- 目前無自動化測試（`test_compression.js` 為手動效能比較腳本，非測試套件；未見 CI 設定），可考慮補上針對 `main.js` 位元率計算邏輯（品質模式／目標大小模式／音訊自動降級）的單元測試，這段邏輯較複雜且是核心正確性風險點
- 補上打包後（DMG/ZIP）的自動化 smoke 驗證流程，避免每次改動 FFmpeg 路徑相關程式碼都需要人手重新打包測試
- 考慮申請 Apple Developer 簽署與公證，去除使用者「右鍵打開」的額外步驟，降低初次使用的疑慮
- 轉檔佇列目前僅能循序處理、不能重新排序，可評估加入拖曳排序或優先權設定
- 目前僅有單一「北歐銀白」配色（`--accent-dark` 只作為 hover 深色，非深色主題），未見深色模式支援，若使用族群有夜間使用需求可評估加入
- 「再轉」目前需先在結果列表中找到項目點擊，若佇列很長可考慮加入搜尋／篩選
