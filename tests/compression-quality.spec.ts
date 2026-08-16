import { test, expect } from '@playwright/test';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';

// ============================================================================
// 壓縮產出品質驗收（HANDOFF.md 之外的深度品質測試）
//
// 涵蓋：
//   A. 三種真實尺寸的合成來源影片（1080p H.264 10s / 4K H.265 5s / 720p H.264
//      含音訊 3s），走真正的 GUI 選檔 → 壓縮 → ffprobe 驗證產物：解析度、
//      編碼、時長（±0.5s）、音軌存在、壓縮比合理（不比原檔大、不是 0 byte）。
//   B. 進度條全程採樣（MutationObserver 監看 #progressText），驗證從 0%
//      開始、單調不倒退、不卡在中間就完成。
//   C. 極低位元率來源的壓縮比迴歸測試（本輪發現並修復的真 bug：quality
//      percentage 模式的 50kbps 下限，會在來源位元率本身低於 50kbps 時把
//      目標位元率墊到比原始還高，讓「壓縮」出的檔案反而變大）。
//
// 明確標註為 MOCK 的部分：
//   - dialog.showOpenDialog / dialog.showSaveDialog：原生對話框無法自動化，
//     直接回傳固定路徑。IPC handler、ffprobe/ffmpeg 呼叫、檔案讀寫都是真的。
// ============================================================================

const projectRoot = path.resolve(__dirname, '..');
const ffmpegBin = require(path.join(projectRoot, 'node_modules', 'ffmpeg-static')) as string;
const ffprobeBin = require(path.join(projectRoot, 'node_modules', 'ffprobe-static')).path as string;

function ffprobeJson(filePath: string): any {
  const out = execFileSync(ffprobeBin, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format', '-show_streams',
    filePath,
  ], { encoding: 'utf-8' });
  return JSON.parse(out);
}

function makeSource(outPath: string, args: string[]) {
  execFileSync(ffmpegBin, ['-y', ...args, outPath], { stdio: 'pipe' });
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

// 監看 #progressText 的每一次文字變化，回傳依序收集到的百分比字串陣列。
async function startProgressSampling(window: Page) {
  await window.evaluate(() => {
    (window as any).__mvtSamples = [];
    const el = document.getElementById('progressText')!;
    const mo = new MutationObserver(() => {
      (window as any).__mvtSamples.push(el.textContent);
    });
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    (window as any).__mvtObserver = mo;
  });
}

async function readProgressSamples(window: Page): Promise<string[]> {
  return window.evaluate(() => {
    const mo = (window as any).__mvtObserver as MutationObserver | undefined;
    mo?.disconnect();
    return ((window as any).__mvtSamples || []) as string[];
  });
}

test.describe.serial('壓縮產出品質驗收', () => {
  let electronApp: ElectronApplication;
  let window: Page;
  let tmpDir: string;
  let src1080: string;
  let src4k: string;
  let src720: string;
  let srcLowBitrate: string;

  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvt-quality-test-'));

    src1080 = path.join(tmpDir, 'source_1080p_h264_10s.mp4');
    makeSource(src1080, [
      '-f', 'lavfi', '-i', 'testsrc2=duration=10:size=1920x1080:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '8000k', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-shortest',
    ]);

    src4k = path.join(tmpDir, 'source_4k_h265_5s.mp4');
    makeSource(src4k, [
      '-f', 'lavfi', '-i', 'testsrc2=duration=5:size=3840x2160:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=5',
      '-c:v', 'libx265', '-preset', 'veryfast', '-b:v', '20000k', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-tag:v', 'hvc1', '-shortest',
    ]);

    src720 = path.join(tmpDir, 'source_720p_h264_3s.mp4');
    makeSource(src720, [
      '-f', 'lavfi', '-i', 'testsrc2=duration=3:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '3000k', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-shortest',
    ]);

    // 極低位元率來源（busy pattern + 35kbps 限制，3 秒讓容器固定開銷佔比夠小）：
    // 用來回歸測試「壓縮出比原檔大」的 bug（50kbps 下限在來源本身低於 50kbps
    // 時會把目標位元率墊高到超過原始位元率）。
    srcLowBitrate = path.join(tmpDir, 'source_ultralow_bitrate.mp4');
    makeSource(srcLowBitrate, [
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:d=3:rate=10',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '35k', '-maxrate', '38k', '-bufsize', '70k',
      '-pix_fmt', 'yuv420p', '-an',
    ]);

    const userDataDir = path.join(tmpDir, 'user-data');
    electronApp = await electron.launch({
      args: [projectRoot, `--user-data-dir=${userDataDir}`],
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. 1080p H.264 10s → 預設設定壓縮，ffprobe 驗證產物 + 進度條 0%→高值單調不倒退', async () => {
    test.setTimeout(60_000);

    await mockOpenDialog(electronApp, src1080);
    await window.locator('#selectFilesBtn').click();
    await expect(window.locator('#fileListContainer')).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('#fileCount')).toHaveText('1');

    const outputPath = path.join(tmpDir, 'out_1080p.mp4');
    await mockSaveDialog(electronApp, outputPath);

    await startProgressSampling(window);
    await window.locator('#startConvertBtn').click();
    await expect(window.locator('#progressPanel')).toBeVisible();
    await expect(window.locator('#resultsPanel')).toBeVisible({ timeout: 45_000 });
    await expect(window.locator('.result-item.error')).toHaveCount(0);

    // --- 進度條檢查 ---
    const samples = await readProgressSamples(window);
    const percents = samples
      .map(s => parseInt((s || '').replace('%', ''), 10))
      .filter(n => !Number.isNaN(n));
    expect(percents.length, `樣本: ${JSON.stringify(samples)}`).toBeGreaterThan(0);
    // 注意：index.html 的 #progressText 初始文字本來就是 "0%"，startConversion()
    // 重置成 '0%' 時若值沒變不會觸發 DOM mutation，所以「起點」不一定會被
    // MutationObserver 捕捉到；改為檢查第一個樣本不會是離譜的高值（代表確實
    // 是從低進度開始回報，而不是一開始就跳到接近完成）。
    expect(percents[0], `樣本: ${JSON.stringify(samples)}`).toBeLessThanOrEqual(50);
    // 單調不倒退（允許 0 容忍度，fluent-ffmpeg 的估計值不應該真的往回跳）
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i], `第 ${i} 個樣本 ${percents[i]} 小於前一個 ${percents[i - 1]}`).toBeGreaterThanOrEqual(percents[i - 1]);
    }
    // 不應出現不合理的值（負數或離譜超過 100）
    for (const p of percents) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(110);
    }
    expect(Math.max(...percents)).toBeGreaterThanOrEqual(90);

    // --- ffprobe 產物驗證 ---
    expect(fs.existsSync(outputPath)).toBe(true);
    const outSize = fs.statSync(outputPath).size;
    const inSize = fs.statSync(src1080).size;
    expect(outSize).toBeGreaterThan(0);
    expect(outSize).toBeLessThan(inSize); // 品質 50% 應該確實變小

    const probe = ffprobeJson(outputPath);
    const v = probe.streams.find((s: any) => s.codec_type === 'video');
    const a = probe.streams.find((s: any) => s.codec_type === 'audio');
    expect(v).toBeTruthy();
    expect(v.codec_name).toBe('hevc'); // 預設編碼器 h265_hw
    expect(v.width).toBe(1920);
    expect(v.height).toBe(1080);
    expect(a, '原始有音軌，預設 audioMode=copy，輸出應保留音軌').toBeTruthy();
    expect(Math.abs(Number(probe.format.duration) - 10)).toBeLessThan(0.5);
  });

  test('2. 4K H.265 5s → 軟體 H.264 編碼 + 30% 品質，驗證解析度不變且確實壓縮', async () => {
    test.setTimeout(60_000);

    await window.locator('#newConversionBtn').click();
    await expect(window.locator('#dropZone')).toBeVisible();

    await mockOpenDialog(electronApp, src4k);
    await window.locator('#selectFilesBtn').click();
    await expect(window.locator('#fileListContainer')).toBeVisible({ timeout: 15_000 });

    // 切換到軟體 H.264 編碼，品質降到 30%
    await window.locator('#videoCodec').selectOption('h264');
    await window.locator('#crfSlider').fill('30');

    const outputPath = path.join(tmpDir, 'out_4k.mp4');
    await mockSaveDialog(electronApp, outputPath);

    await window.locator('#startConvertBtn').click();
    await expect(window.locator('#resultsPanel')).toBeVisible({ timeout: 45_000 });
    await expect(window.locator('.result-item.error')).toHaveCount(0);

    expect(fs.existsSync(outputPath)).toBe(true);
    const outSize = fs.statSync(outputPath).size;
    const inSize = fs.statSync(src4k).size;
    expect(outSize).toBeGreaterThan(0);
    expect(outSize).toBeLessThan(inSize);

    const probe = ffprobeJson(outputPath);
    const v = probe.streams.find((s: any) => s.codec_type === 'video');
    expect(v.codec_name).toBe('h264');
    expect(v.width).toBe(3840);
    expect(v.height).toBe(2160);
    expect(Math.abs(Number(probe.format.duration) - 5)).toBeLessThan(0.5);
  });

  test('3. 720p 含音訊 3s → 輸出 WebM/VP9 + 靜音模式，驗證無音軌且確實壓縮', async () => {
    test.setTimeout(60_000);

    await window.locator('#newConversionBtn').click();
    await expect(window.locator('#dropZone')).toBeVisible();

    await mockOpenDialog(electronApp, src720);
    await window.locator('#selectFilesBtn').click();
    await expect(window.locator('#fileListContainer')).toBeVisible({ timeout: 15_000 });

    await window.locator('#outputFormat').selectOption('webm'); // 連帶把 codec 切成 vp9
    await window.locator('#audioMode').selectOption('mute');

    const outputPath = path.join(tmpDir, 'out_720p.webm');
    await mockSaveDialog(electronApp, outputPath);

    await window.locator('#startConvertBtn').click();
    await expect(window.locator('#resultsPanel')).toBeVisible({ timeout: 45_000 });
    await expect(window.locator('.result-item.error')).toHaveCount(0);

    expect(fs.existsSync(outputPath)).toBe(true);
    const outSize = fs.statSync(outputPath).size;
    const inSize = fs.statSync(src720).size;
    expect(outSize).toBeGreaterThan(0);
    expect(outSize).toBeLessThan(inSize);

    const probe = ffprobeJson(outputPath);
    const v = probe.streams.find((s: any) => s.codec_type === 'video');
    const a = probe.streams.find((s: any) => s.codec_type === 'audio');
    expect(v.codec_name).toBe('vp9');
    expect(v.width).toBe(1280);
    expect(v.height).toBe(720);
    expect(a, '靜音模式輸出不應有音軌').toBeFalsy();
    expect(Math.abs(Number(probe.format.duration) - 3)).toBeLessThan(0.5);
  });

  test('4. [迴歸] 極低位元率來源 → 壓縮後不應反而比原檔大（50kbps 下限 bug，main.js 已修復）', async () => {
    test.setTimeout(30_000);

    await window.locator('#newConversionBtn').click();
    await expect(window.locator('#dropZone')).toBeVisible();

    await mockOpenDialog(electronApp, srcLowBitrate);
    await window.locator('#selectFilesBtn').click();
    await expect(window.locator('#fileListContainer')).toBeVisible({ timeout: 15_000 });

    // 預設品質 50%，編碼器維持預設 h265_hw
    const outputPath = path.join(tmpDir, 'out_lowbitrate.mp4');
    await mockSaveDialog(electronApp, outputPath);

    await window.locator('#startConvertBtn').click();
    await expect(window.locator('#resultsPanel')).toBeVisible({ timeout: 20_000 });
    await expect(window.locator('.result-item.error')).toHaveCount(0);

    expect(fs.existsSync(outputPath)).toBe(true);
    const outSize = fs.statSync(outputPath).size;
    const inSize = fs.statSync(srcLowBitrate).size;
    expect(outSize).toBeGreaterThan(0);
    expect(
      outSize,
      `原始 ${inSize} bytes，壓縮後 ${outSize} bytes — 壓縮工具不應該讓極低位元率來源反而變大`
    ).toBeLessThanOrEqual(inSize);
  });
});
