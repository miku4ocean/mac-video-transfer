import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';

// ============================================================================
// GUI 驗收自動化（HANDOFF.md L17「手動測拖曳壓縮與打包版路徑」的可自動化子集）
//
// 涵蓋：
//   1. App 啟動零例外、主視窗渲染、全程 console 零 error
//   2. 檔案選取 → 壓縮流程：mock dialog.showOpenDialog/showSaveDialog，
//      其餘（getVideoInfo、convertVideo）走真實 IPC + 真實 ffmpeg 二進位，
//      對一支自製 2 秒測試影片實際跑一次壓縮，最後用 ffprobe 驗證輸出檔
//      是有效影片。
//   3. FFmpeg/FFprobe 路徑解析（開發模式分支）：讀取 main.js app.whenReady()
//      內 console.log 印出的、getFFmpegPath()/getFFprobePath() 實際解析出的
//      路徑（main process 真正在用的路徑，不是測試裡重新算一次），驗證
//      存在且可執行。（electronApp.evaluate() 在這個 Electron 版本的 CDP
//      context 沒有 CJS 的 require，實測過改用這個方式。）
//   4. 拖放：合成帶 .path 的 File 觸發 dropZone 的 'drop' 事件（renderer.js
//      直接讀 f.path，不是走新版 webUtils.getPathForFile，所以合成 File
//      設 .path 這招在本專案的 Electron 28 上有效，不受「webUtils 對合成
//      File 回空字串」那個新版已知限制影響）。
//
// 明確標註為 MOCK 的部分：
//   - dialog.showOpenDialog / dialog.showSaveDialog：原生系統對話框無法被
//     自動化操控，換成假實作直接回傳固定路徑。IPC handler 本身、
//     ffprobe/ffmpeg 呼叫、實際檔案讀寫完全沒有被 mock。
//   - 拖放測試合成 File 並用 Object.defineProperty 補 .path，模擬「從
//     Finder 拖放」；headless 測試環境無法驅動真正的 OS 級拖放手勢。
//
// 仍需人工驗收（見 HANDOFF.md）：
//   - 打包版（npm run build:dmg）安裝後 FFmpeg/FFprobe 路徑解析
//     （app.asar → app.asar.unpacked 分支）——本測試只能在未打包狀態下
//     跑，packaged 分支的字串轉換邏輯改在 tests/ffmpeg-path-resolution.spec.ts
//     用邏輯等價測試覆蓋，實際打包安裝後的行為仍需人工跑一次 build:dmg 驗證。
//   - 真正用滑鼠把 Finder 中的檔案拖到視窗上（OS 級拖放手勢本身）
//   - 硬體加速編碼器（h265_hw/h264_hw, VideoToolbox）在不同 Mac 機型上的
//     相容性；本測試沿用 App 預設設定（H.265 硬體加速），在其他機器上
//     若無 VideoToolbox 支援可能行為不同
// ============================================================================

const projectRoot = path.resolve(__dirname, '..');
const ffmpegBin = require(path.join(projectRoot, 'node_modules', 'ffmpeg-static')) as string;
const ffprobeBin = require(path.join(projectRoot, 'node_modules', 'ffprobe-static')).path as string;

function createTinyTestVideo(outPath: string) {
  // 2 秒、320x240、25fps 的合成測試影片（testsrc2 + 440Hz 正弦波音軌），
  // 純本機 lavfi 產生，不連外部網站、不進 git（寫在呼叫端傳入的 os.tmpdir 路徑）。
  execFileSync(ffmpegBin, [
    '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=320x240:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k',
    '-y', outPath,
  ], { stdio: 'pipe' });
}

function ffprobeJson(filePath: string): any {
  const out = execFileSync(ffprobeBin, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format', '-show_streams',
    filePath,
  ], { encoding: 'utf-8' });
  return JSON.parse(out);
}

test.describe.serial('mac-video-transfer GUI 驗收', () => {
  let electronApp: ElectronApplication;
  let window: Page;
  let tmpDir: string;
  let sourceVideo: string;
  let mainProcessStdout = '';
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvt-electron-gui-test-'));
    sourceVideo = path.join(tmpDir, 'source_2s.mp4');
    createTinyTestVideo(sourceVideo);

    const userDataDir = path.join(tmpDir, 'user-data');

    electronApp = await electron.launch({
      args: [projectRoot, `--user-data-dir=${userDataDir}`],
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test' },
    });

    // main.js 在 app.whenReady() 裡用 console.log 印出實際解析出的
    // FFmpeg/FFprobe 路徑（main.js L64-65）。子行程的 stdout 在 Node 裡預設是
    // 暫停模式，只要在資料被別的消費者讀走前掛上 'data' listener 就不會漏接，
    // 這裡在 firstWindow() 之前就掛，經實測穩定能收到這兩行。
    electronApp.process().stdout?.on('data', (d: Buffer) => {
      mainProcessStdout += d.toString();
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
    // 精準關閉本測試啟動的這個 ElectronApplication，不使用 pkill/killall。
    await electronApp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. App 啟動零例外、主視窗渲染', async () => {
    expect(electronApp.process().pid).toBeGreaterThan(0);
    expect(await window.title()).toBe('Video Compressor');
    await expect(window.locator('body')).toBeVisible();
    await expect(window.locator('#dropZone')).toBeVisible();
    await expect(window.locator('#startConvertBtn')).toBeDisabled();
  });

  test('2. FFmpeg/FFprobe 路徑解析（開發模式分支，讀取 main process 實際印出的路徑）', async () => {
    // electronApp.evaluate() 在這個 Electron 版本的 CDP context 裡沒有 CJS 的
    // require（main.js 模組作用域裡的 require 是模組 wrapper 注入的區域變數，
    // 不是全域），實測 typeof require === 'undefined'。改為直接讀 main.js
    // app.whenReady() 內 console.log 印出的、getFFmpegPath()/getFFprobePath()
    // 真正解析出的路徑（main.js L59-65），驗證那就是 main process 實際會用
    // 的路徑，而不是在測試裡重新呼叫一次邏輯。
    const ffmpegMatch = mainProcessStdout.match(/FFmpeg path: (.+)/);
    const ffprobeMatch = mainProcessStdout.match(/FFprobe path: (.+)/);

    expect(ffmpegMatch, `main process stdout 沒有印出 FFmpeg path，收到的內容:\n${mainProcessStdout}`).toBeTruthy();
    expect(ffprobeMatch, `main process stdout 沒有印出 FFprobe path，收到的內容:\n${mainProcessStdout}`).toBeTruthy();

    const ffmpegPath = ffmpegMatch![1].trim();
    const ffprobePath = ffprobeMatch![1].trim();

    // 開發模式（未打包）不應出現 asar.unpacked 轉換，路徑應直接落在
    // 專案自己的 node_modules 底下。
    expect(ffmpegPath).toContain(path.join('node_modules', 'ffmpeg-static'));
    expect(ffprobePath).toContain(path.join('node_modules', 'ffprobe-static'));
    expect(ffmpegPath).not.toContain('app.asar');
    expect(ffprobePath).not.toContain('app.asar');

    // 交叉核對：與這支測試檔自己 require() 解析出的路徑（同一份 node_modules）一致
    expect(ffmpegPath).toBe(ffmpegBin);
    expect(ffprobePath).toBe(ffprobeBin);

    expect(fs.existsSync(ffmpegPath)).toBe(true);
    expect(fs.existsSync(ffprobePath)).toBe(true);
    // 可執行檔權限檢查（X_OK 不丟例外即為可執行）
    expect(() => fs.accessSync(ffmpegPath, fs.constants.X_OK)).not.toThrow();
    expect(() => fs.accessSync(ffprobePath, fs.constants.X_OK)).not.toThrow();
  });

  test('3. 檔案選取：mock dialog.showOpenDialog 回傳測試影片', async () => {
    await electronApp.evaluate(async ({ dialog }, videoPath) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [videoPath],
      })) as typeof dialog.showOpenDialog;
    }, sourceVideo);

    await window.locator('#selectFilesBtn').click();

    // 第一次從 Electron main process 內 spawn ffprobe-static 二進位時，
    // macOS 對「首次執行的未知二進位」的 Gatekeeper 檢查會有數秒延遲
    // （實測過一次後同一路徑會變快），這裡放寬到 15s 涵蓋這個冷啟動成本，
    // 之後的斷言在 container 出現後就很快，維持預設 timeout 即可。
    await expect(window.locator('#fileListContainer')).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('#fileCount')).toHaveText('1');
    // 用 #fileList 範圍限定，避免撞到 progressPanel 裡靜態存在（但隱藏）的 .file-name
    await expect(window.locator('#fileList .file-name')).toHaveText('source_2s.mp4');
    await expect(window.locator('#startConvertBtn')).toBeEnabled();
  });

  test('4. 壓縮流程：mock dialog.showSaveDialog，其餘走真實 ffmpeg 壓縮 + ffprobe 驗證輸出', async () => {
    const outputPath = path.join(tmpDir, 'compressed_output.mp4');

    // 唯一 mock 點：原生「儲存檔案」對話框無法自動化操控，直接回傳固定路徑。
    // 之後 convertVideo 的 IPC handler、fluent-ffmpeg 呼叫、真正的
    // ffmpeg 編碼子行程、輸出檔寫入完全是真實執行。
    await electronApp.evaluate(async ({ dialog }, outPath) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: outPath,
      })) as typeof dialog.showSaveDialog;
    }, outputPath);

    await window.locator('#startConvertBtn').click();

    await expect(window.locator('#progressPanel')).toBeVisible();
    // 壓縮完成後會切到結果面板並跳出「完成!」toast
    await expect(window.locator('#resultsPanel')).toBeVisible({ timeout: 30_000 });
    await expect(window.locator('.result-item.error')).toHaveCount(0);

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);

    // 用真實 ffprobe（而非重複前端邏輯）驗證輸出確實是有效、可解析的影片檔
    const probe = ffprobeJson(outputPath);
    const videoStream = probe.streams.find((s: any) => s.codec_type === 'video');
    expect(videoStream).toBeTruthy();
    expect(Number(probe.format.duration)).toBeGreaterThan(0);
  });

  test('5. 拖放：合成帶 .path 的 File，模擬從 Finder 拖放第二支測試影片', async () => {
    const dropVideo = path.join(tmpDir, 'drop_2s.mp4');
    createTinyTestVideo(dropVideo);

    // 上一個測試結束時停在結果面板（resultsPanel）。點「新增檔案」
    // （newConversionBtn → startNewConversion()）清空 state 並回到 dropZone 畫面。
    await window.locator('#newConversionBtn').click();
    await expect(window.locator('#dropZone')).toBeVisible();

    await window.evaluate(async ({ filePath, fileName }) => {
      const file = new File(['ignored — 內容由 main process 透過 fs/ffprobe 真實讀取'], fileName, {
        type: 'video/mp4',
      });
      // renderer.js 的 drop handler 直接讀 f.path（非 webUtils.getPathForFile），
      // 用 defineProperty 補上真實檔案系統路徑即可命中同一段真實程式碼。
      Object.defineProperty(file, 'path', { value: filePath });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      document.getElementById('dropZone')?.dispatchEvent(dropEvent);
    }, { filePath: dropVideo, fileName: 'drop_2s.mp4' });

    await expect(window.locator('#fileListContainer')).toBeVisible();
    await expect(window.locator('#fileList .file-name')).toHaveText('drop_2s.mp4');
  });

  test('6. 全程零 console error（含前面所有步驟）', async () => {
    expect(consoleErrors, `收集到的 console error:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
