import { test, expect } from '@playwright/test';

// ============================================================================
// FFmpeg/FFprobe 路徑解析 — packaged 分支的邏輯測試（不啟動 Electron）
//
// 背景：main.js 的 getFFmpegPath()/getFFprobePath()（main.js L7-25）在
// app.isPackaged 為 true 時，對 require('ffmpeg-static') / require('ffprobe-static').path
// 解出的路徑做同一件事：
//
//   ffmpegPath.replace('app.asar', 'app.asar.unpacked')
//
// 這是因為 electron-builder 設定（package.json build.asarUnpack）把
// ffmpeg-static/ffprobe-static 的二進位排除在 app.asar 壓縮檔外、放在
// app.asar.unpacked，執行檔在 asar 內無法直接被 spawn，需改指向 unpacked 路徑。
//
// main.js 沒有把 getFFmpegPath()/getFFprobePath() export 出來（且依規範不能為了
// 測試改動壓縮/路徑邏輯本身），所以這裡改用「邏輯等價測試」：對假造的、
// 型態與真實 asarUnpack 後路徑完全一致的字串，套用與 main.js 完全相同的
// 一行 `.replace('app.asar', 'app.asar.unpacked')` 轉換，驗證轉換結果正確。
//
// 開發模式分支（app.isPackaged === false，直接 require 二進位）已在
// tests/electron-app.spec.ts 測試 2 中，於真正的 Electron main process 內
// 執行相同的 require 呼叫驗證，那個測試打的是 main.js 實際會走的程式碼。
//
// 仍需人工驗收：實際 `npm run build:dmg` 打包、安裝 DMG 後，在真正 packaged
// 的 App 裡確認 ffmpeg/ffprobe 二進位能被找到並成功執行一次轉檔
// （HANDOFF.md「下一步」第 2 項）。
// ============================================================================

function applyAsarUnpackTransform(resolvedPath: string): string {
  // 與 main.js L12 / L21 逐字相同的轉換式。
  return resolvedPath.replace('app.asar', 'app.asar.unpacked');
}

test.describe('FFmpeg/FFprobe packaged 路徑轉換邏輯（main.js L7-25 等價測試）', () => {
  test('ffmpeg-static 路徑：app.asar → app.asar.unpacked', () => {
    const fakePackagedPath =
      '/Applications/Video Compressor.app/Contents/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg';
    const expected =
      '/Applications/Video Compressor.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg';

    expect(applyAsarUnpackTransform(fakePackagedPath)).toBe(expected);
  });

  test('ffprobe-static 路徑：app.asar → app.asar.unpacked', () => {
    const fakePackagedPath =
      '/Applications/Video Compressor.app/Contents/Resources/app.asar/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe';
    const expected =
      '/Applications/Video Compressor.app/Contents/Resources/app.asar.unpacked/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe';

    expect(applyAsarUnpackTransform(fakePackagedPath)).toBe(expected);
  });

  test('未打包路徑（不含 app.asar）不受影響，維持原樣', () => {
    // 對照組：確認轉換式只在真的含有 'app.asar' 字面字串時才動作，
    // 呼應 main.js else 分支（app.isPackaged === false）直接回傳原路徑、
    // 完全不做字串轉換的行為。
    const devPath = '/Users/dev/mac-video-transfer/node_modules/ffmpeg-static/ffmpeg';
    expect(applyAsarUnpackTransform(devPath)).toBe(devPath);
  });

  test('asarUnpack 設定涵蓋 ffmpeg-static 與 ffprobe-static（package.json build.asarUnpack）', () => {
    // 這個轉換式能生效的前提是 electron-builder 真的把這兩個套件排除在 asar 外；
    // 交叉檢查 package.json 設定沒有漂移，避免「路徑轉換邏輯對、但沒實際 unpack」的漏洞。
    const pkg = require('../package.json');
    const asarUnpack: string[] = pkg.build?.asarUnpack || [];
    expect(asarUnpack).toContain('node_modules/ffmpeg-static/**/*');
    expect(asarUnpack).toContain('node_modules/ffprobe-static/**/*');
  });
});
