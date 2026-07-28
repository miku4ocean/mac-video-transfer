import { defineConfig } from '@playwright/test';

// Electron GUI 驗收測試設定。
// 只跑 tests/ 內的 Electron GUI 測試；不啟動任何 web server，
// spec 檔自行用 `_electron` API 啟動/關閉真正的 Electron App。
// workers 固定為 1：單一 App 實例、describe.serial，平行跑會互相干擾。
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
