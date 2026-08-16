import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';

// ============================================================================
// 邊界情況驗收
//
// 涵蓋：
//   1. 含中文與空白的檔名 → 選檔、壓縮、輸出檔名都正確，不因編碼問題出錯
//   2. 極小檔案（<100KB，1 秒）→ 壓縮成功且產物有效，不因位元率過低而崩潰
//   3. 非影片檔（.txt 改副檔名成 .mp4）→ 顯示錯誤 toast，不白屏、不加入佇列
//   4. 損壞的影片（截斷檔案，moov atom 遺失）→ 顯示錯誤 toast，不白屏、不 crash
//
// 明確標註為 MOCK 的部分：dialog.showOpenDialog 直接回傳固定路徑（原生對話框
// 無法自動化）；IPC handler、ffprobe/ffmpeg 呼叫、檔案讀寫完全真實執行。
// ============================================================================

const projectRoot = path.resolve(__dirname, '..');
const ffmpegBin = require(path.join(projectRoot, 'node_modules', 'ffmpeg-static')) as string;
const ffprobeBin = require(path.join(projectRoot, 'node_modules', 'ffprobe-static')).path as string;

function makeSource(outPath: string, args: string[]) {
  execFileSync(ffmpegBin, ['-y', ...args, outPath], { stdio: 'pipe' });
}

function ffprobeJson(filePath: string): any {
  const out = execFileSync(ffprobeBin, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ], { encoding: 'utf-8' });
  return JSON.parse(out);
}

async function mockOpenDialog(app: ElectronApplication, filePath: string) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [p],
    })) as typeof dialog.showOpenDialog;
  }, filePath);
}

async function mockSaveDialog(app: ElectronApplication, filePath: string) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: p,
    })) as typeof dialog.showSaveDialog;
  }, filePath);
}

test.describe.serial('邊界情況驗收', () => {
  let electronApp: ElectronApplication;
  let window: Page;
  let tmpDir: string;
  // 這份測試刻意觸發多個錯誤路徑（非影片檔、損壞檔案），renderer.js 的
  // catch 分支本來就會 console.error() 記錄除錯資訊，屬預期行為，不是 bug；
  // 真正代表「App 崩潰／白屏」的訊號是未被捕捉的例外（pageerror），所以只
  // 追蹤 pageerror，不追蹤預期中的 console.error。
  const pageErrors: string[] = [];

  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvt-edge-test-'));
    const userDataDir = path.join(tmpDir, 'user-data');

    electronApp = await electron.launch({
      args: [projectRoot, `--user-data-dir=${userDataDir}`],
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    window.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
  });

  test.afterAll(async () => {
    await electronApp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. 含中文與空白的檔名：選檔 → 顯示正確檔名 → 壓縮成功 → 產物有效', async () => {
    test.setTimeout(30_000);

    const chineseName = '測試 影片(2).mp4';
    const srcPath = path.join(tmpDir, chineseName);
    makeSource(srcPath, [
      '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=320x240:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k',
    ]);

    await mockOpenDialog(electronApp, srcPath);
    await window.locator('#selectFilesBtn').click();
    await expect(window.locator('#fileListContainer')).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('#fileCount')).toHaveText('1');
    // 檔名（含中文、空白、括號）應該原封不動顯示，不亂碼、不截斷
    await expect(window.locator('#fileList .file-name')).toHaveText(chineseName);

    const outputName = '壓縮後 測試 影片(2).mp4';
    const outputPath = path.join(tmpDir, outputName);
    await mockSaveDialog(electronApp, outputPath);

    await window.locator('#startConvertBtn').click();
    await expect(window.locator('#resultsPanel')).toBeVisible({ timeout: 20_000 });
    await expect(window.locator('.result-item.error')).toHaveCount(0);

    expect(fs.existsSync(outputPath), `輸出檔應存在於: ${outputPath}`).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);

    const probe = ffprobeJson(outputPath);
    const v = probe.streams.find((s: any) => s.codec_type === 'video');
    expect(v).toBeTruthy();
    expect(Number(probe.format.duration)).toBeGreaterThan(0);
  });

  test('2. 極小檔案（<100KB，1 秒）→ 壓縮成功且產物為有效影片', async () => {
    test.setTimeout(30_000);

    await window.locator('#newConversionBtn').click();
    await expect(window.locator('#dropZone')).toBeVisible();

    const tinyPath = path.join(tmpDir, 'tiny_1s.mp4');
    makeSource(tinyPath, [
      '-f', 'lavfi', '-i', 'testsrc2=duration=1:size=64x64:rate=5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '20k', '-pix_fmt', 'yuv420p', '-an',
    ]);
    expect(fs.statSync(tinyPath).size, '測試前提：來源應小於 100KB').toBeLessThan(100 * 1024);

    await mockOpenDialog(electronApp, tinyPath);
    await window.locator('#selectFilesBtn').click();
    await expect(window.locator('#fileListContainer')).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('#fileCount')).toHaveText('1');

    const outputPath = path.join(tmpDir, 'tiny_compressed.mp4');
    await mockSaveDialog(electronApp, outputPath);

    await window.locator('#startConvertBtn').click();
    await expect(window.locator('#resultsPanel')).toBeVisible({ timeout: 20_000 });
    await expect(window.locator('.result-item.error')).toHaveCount(0);

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
    const probe = ffprobeJson(outputPath);
    expect(probe.streams.find((s: any) => s.codec_type === 'video')).toBeTruthy();
  });

  test('3. 非影片檔（.txt 改副檔名為 .mp4）→ 錯誤 toast，不白屏，不加入佇列', async () => {
    test.setTimeout(20_000);

    await window.locator('#newConversionBtn').click();
    await expect(window.locator('#dropZone')).toBeVisible();

    const fakePath = path.join(tmpDir, 'fake_video.mp4');
    fs.writeFileSync(fakePath, 'this is just plain text content, not a real video file\n'.repeat(20), 'utf-8');

    await mockOpenDialog(electronApp, fakePath);
    await window.locator('#selectFilesBtn').click();

    await expect(window.locator('#loadingOverlay')).toBeHidden({ timeout: 10_000 });
    // toast 3 秒後會自動淡出移除，用 .last() 避免撞到前一個測試殘留的 toast；
    // 用文字內容確認這確實是「這次」的錯誤 toast，不是誤判前一個。
    const toast3 = window.locator('.toast.error').last();
    await expect(toast3).toBeVisible({ timeout: 5_000 });
    await expect(toast3).toContainText('fake_video.mp4');

    // 不應加入佇列，畫面應停在 dropZone（不白屏、不殘留 loading）
    await expect(window.locator('#dropZone')).toBeVisible();
    await expect(window.locator('#startConvertBtn')).toBeDisabled();
    await expect(window.locator('body')).toBeVisible();
    expect(await window.title()).toBe('Video Compressor');
  });

  test('4. 損壞的影片（截斷檔案，moov atom 遺失）→ 錯誤 toast，不白屏，不 crash', async () => {
    test.setTimeout(20_000);

    // 先產生一支「未加 faststart」的完整影片（moov atom 在檔尾），
    // 再截斷成前 40%，讓 moov atom（連同影片索引）遺失，模擬真實損壞檔案。
    const fullPath = path.join(tmpDir, 'full_for_truncate.mp4');
    makeSource(fullPath, [
      '-f', 'lavfi', '-i', 'testsrc2=duration=3:size=320x240:rate=10',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an',
    ]);
    const fullSize = fs.statSync(fullPath).size;
    const cut = Math.floor(fullSize * 0.4);
    const buf = Buffer.alloc(cut);
    const fd = fs.openSync(fullPath, 'r');
    fs.readSync(fd, buf, 0, cut, 0);
    fs.closeSync(fd);
    const corruptedPath = path.join(tmpDir, 'corrupted_truncated.mp4');
    fs.writeFileSync(corruptedPath, buf);

    // 確認這支檔案真的讀不出 metadata（測試前提）
    expect(() => ffprobeJson(corruptedPath)).toThrow();

    await mockOpenDialog(electronApp, corruptedPath);
    await window.locator('#selectFilesBtn').click();

    await expect(window.locator('#loadingOverlay')).toBeHidden({ timeout: 10_000 });
    const toast4 = window.locator('.toast.error').last();
    await expect(toast4).toBeVisible({ timeout: 5_000 });
    await expect(toast4).toContainText('corrupted_truncated');

    await expect(window.locator('#dropZone')).toBeVisible();
    await expect(window.locator('#startConvertBtn')).toBeDisabled();
    await expect(window.locator('body')).toBeVisible();
    expect(await window.title()).toBe('Video Compressor');
  });

  test('5. 全程零未捕捉例外（pageerror）——確認 App 沒有白屏／崩潰', async () => {
    expect(pageErrors, `收集到的 pageerror:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});
