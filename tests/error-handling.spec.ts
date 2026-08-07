import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ============================================================================
// 錯誤處理測試
//
// 驗證 main.js IPC handler 對無效輸入的容錯行為：
//   1. 不存在的檔案路徑 → 顯示錯誤 toast，不 crash
//   2. 驗證 renderer 的 addFiles() catch 分支正確觸發
// ============================================================================

const projectRoot = path.resolve(__dirname, '..');

test.describe.serial('錯誤處理驗證', () => {
  let electronApp: ElectronApplication;
  let window: Page;
  let tmpDir: string;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvt-error-test-'));
    const userDataDir = path.join(tmpDir, 'user-data');

    electronApp = await electron.launch({
      args: [projectRoot, `--user-data-dir=${userDataDir}`],
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    window.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    window.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });
  });

  test.afterAll(async () => {
    await electronApp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('不存在的檔案 → 顯示錯誤 toast，不 crash，不加入佇列', async () => {
    const nonExistentPath = path.join(tmpDir, 'does_not_exist.mp4');

    // mock dialog 回傳一個不存在的路徑
    await electronApp.evaluate(async ({ dialog }, videoPath) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [videoPath],
      })) as typeof dialog.showOpenDialog;
    }, nonExistentPath);

    await window.locator('#selectFilesBtn').click();

    // 等待 loading overlay 消失（addFiles 結束）
    await expect(window.locator('#loadingOverlay')).toBeHidden({ timeout: 10_000 });

    // 不應加入佇列
    await expect(window.locator('#dropZone')).toBeVisible();
    await expect(window.locator('#startConvertBtn')).toBeDisabled();

    // 應有錯誤 toast 出現
    await expect(window.locator('.toast.error')).toBeVisible({ timeout: 5_000 });
  });

  test('App 未因錯誤而 crash（主視窗仍存在可互動）', async () => {
    // 確認主視窗仍然存活
    expect(await window.title()).toBe('Video Compressor');
    await expect(window.locator('#dropZone')).toBeVisible();
    await expect(window.locator('#selectFilesBtn')).toBeEnabled();
  });
});
