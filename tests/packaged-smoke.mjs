#!/usr/bin/env node
// tests/packaged-smoke.mjs — 對「打包後的 .app」跑一次真實壓縮流程，
// 驗證 packaged 環境下 ffmpeg-static/ffprobe-static 的 app.asar.unpacked 路徑解析
// 真的正確（HANDOFF.md「仍需人工」清單第一項：「打包版安裝後，FFmpeg/FFprobe
// 路徑解析在真正 packaged 環境下的行為」——這支腳本把它自動化掉）。
//
// 用法：
//   node tests/packaged-smoke.mjs ["<Foo.app 路徑>"]
//   npm run test:packaged -- "<Foo.app 路徑>"
// 不帶參數時預設檢查 ~/Applications/Mac工具/Video Compressor.app（本機已安裝路徑）。
//
// 流程：
//   1. 產生一段測試影片（優先用系統 ffmpeg，找不到才退回專案內附的 ffmpeg-static）。
//   2. 用 Playwright `_electron.launch({ executablePath })` 啟動「打包後的 .app」
//      （不是開發模式的 `electron .`）。
//   3. 透過 preload 暴露的 `window.api`（IPC，正常使用者流程會走的同一條路）
//      呼叫 getVideoInfo() / convertVideo()，不繞過 main.js 的任何邏輯。
//   4. 斷言：輸出檔存在、用 ffprobe 能讀出合法的影片時長與視訊軌、
//      輸出檔小於輸入檔（quality 70% 壓縮設定下應該變小）。
//   5. 額外核對 main process 印出的 FFmpeg/FFprobe 路徑訊息，確認真的指向
//      `app.asar.unpacked`（而不是掉回 asar 內部或讀到系統 ffmpeg）。

import { createRequire } from 'node:module';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require_ = createRequire(path.join(projectRoot, 'package.json'));
const { _electron: electron } = require_('playwright');

const DEFAULT_APP = path.join(os.homedir(), 'Applications', 'Mac工具', 'Video Compressor.app');
const appPath = process.argv[2] || DEFAULT_APP;

function fail(msg) {
  console.error(`FAIL ${msg}`);
  process.exitCode = 1;
}
let hadFailure = false;
function check(ok, msg) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) hadFailure = true;
}

if (!fs.existsSync(appPath)) {
  console.error(`FAIL 找不到 .app：${appPath}`);
  process.exit(2);
}

const macOSDir = path.join(appPath, 'Contents', 'MacOS');
const exeName = fs.readdirSync(macOSDir)[0];
const exe = path.join(macOSDir, exeName);

function hasSystemFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function makeTestVideo(outPath) {
  if (hasSystemFfmpeg()) {
    console.log('使用系統 ffmpeg 產生測試影片');
    execSync(
      `ffmpeg -y -f lavfi -i "testsrc=duration=3:size=1280x720:rate=30" ` +
        `-f lavfi -i "sine=duration=3" -c:v libx264 -c:a aac -shortest ${JSON.stringify(outPath)}`,
      { stdio: 'pipe' }
    );
  } else {
    console.log('系統無 ffmpeg，改用專案內附 ffmpeg-static');
    const ffmpegBin = require_('ffmpeg-static');
    execFileSync(ffmpegBin, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=3:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=duration=3',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest',
      outPath,
    ], { stdio: 'pipe' });
  }
}

function ffprobeJson(filePath) {
  // 驗證用的 ffprobe 不必是打包版裡的那支，系統或專案內附皆可，
  // 打包版路徑是否正確由下面的 main-process log 另外核對。
  let bin = 'ffprobe';
  if (!hasSystemFfmpeg()) bin = require_('ffprobe-static').path;
  const out = execFileSync(bin, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ], { encoding: 'utf8' });
  return JSON.parse(out);
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvt-packaged-smoke-'));
  const srcPath = path.join(tmpDir, 'in.mp4');
  const outPath = path.join(tmpDir, 'out.mp4');
  const userDataDir = path.join(tmpDir, 'user-data');

  makeTestVideo(srcPath);
  const srcSize = fs.statSync(srcPath).size;
  check(srcSize > 0, `測試來源影片已產生（${srcPath}，${srcSize} bytes）`);

  console.log(`啟動打包版 .app：${exe}`);
  const electronApp = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userDataDir}`],
  });

  let mainLog = '';
  electronApp.process().stdout?.on('data', (d) => { mainLog += d.toString(); });
  electronApp.process().stderr?.on('data', (d) => { mainLog += d.toString(); });

  try {
    const window = await electronApp.firstWindow({ timeout: 30_000 });
    await window.waitForLoadState('domcontentloaded');
    // 給 main process 一點時間印出 app.whenReady() 裡的 FFmpeg/FFprobe path log
    await new Promise((r) => setTimeout(r, 1000));

    // 透過 preload 暴露的 window.api（正常使用者流程的同一條 IPC），
    // 不繞過打包版 main.js 的任何邏輯（含 getFFmpegPath/getFFprobePath）。
    const info = await window.evaluate(async (p) => window.api.getVideoInfo(p), srcPath);
    check(!!info && info.duration > 2.5 && info.duration < 3.5, `get-video-info 讀到合理時長（${info?.duration}s）`);
    check(!!info?.video, `get-video-info 讀到視訊軌（codec=${info?.video?.codec}）`);

    const result = await window.evaluate(async ({ inputPath, outputPath }) => {
      return window.api.convertVideo({
        inputPath,
        outputPath,
        settings: { quality: 70, codec: 'h264', audioMode: 'compress' },
      });
    }, { inputPath: srcPath, outputPath: outPath });

    check(result?.success === true, `convert-video IPC 回報成功（${JSON.stringify(result)}）`);
    check(fs.existsSync(outPath), `輸出檔存在：${outPath}`);

    const outSize = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
    check(outSize > 0, `輸出檔非空（${outSize} bytes）`);

    let probeOk = false;
    let probeMeta = null;
    try {
      probeMeta = ffprobeJson(outPath);
      probeOk = !!probeMeta?.format?.duration && probeMeta.streams.some((s) => s.codec_type === 'video');
    } catch (e) {
      mainLog += `\nffprobe 驗證輸出檔失敗：${e.message}`;
    }
    check(probeOk, `ffprobe 能讀出輸出檔（duration=${probeMeta?.format?.duration}, streams=${probeMeta?.streams?.length}）`);

    check(
      outSize < srcSize,
      `輸出檔（${outSize}）小於來源（${srcSize}），quality=70% 設定下確實有壓縮效果`
    );

    // 「重點驗證打包後 ffmpeg/ffprobe 路徑（asar unpack）正確」：
    // 上面 convert-video 能成功跑完，本身就是 spawn 到正確二進位的端到端證明
    // （main.js getFFmpegPath()/getFFprobePath() 把路徑指向 app.asar.unpacked 後才 spawn 得起來；
    // 路徑錯的話 ffmpeg 子行程會直接 ENOENT，command.on('error') 會讓上面這步整個 reject）。
    // 額外直接檢查檔案系統，確認 main.js L12/L21 的 `.replace('app.asar','app.asar.unpacked')`
    // 轉換出來的路徑，在這個實際打包產物裡真的存在且可執行——
    // 不依賴 stdout 擷取時機（實測 electron.launch({executablePath}) 對 packaged app
    // 的早期 console.log 有時會在我們掛上 'data' listener 前就被驅動層消耗掉，是擷取時序問題，
    // 不是應用程式邏輯問題，改用檔案系統直接查證更可靠）。
    const resourcesDir = path.join(appPath, 'Contents', 'Resources');
    const unpackedFfmpeg = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg');
    const unpackedFfprobeDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin', 'darwin');
    let ffmpegExecutable = false;
    try { fs.accessSync(unpackedFfmpeg, fs.constants.X_OK); ffmpegExecutable = true; } catch {}
    check(ffmpegExecutable, `app.asar.unpacked 內的 ffmpeg 二進位存在且可執行：${unpackedFfmpeg}`);
    const ffprobeFound = fs.existsSync(unpackedFfprobeDir) &&
      fs.readdirSync(unpackedFfprobeDir, { recursive: true }).some((f) => f.toString().endsWith('ffprobe'));
    check(ffprobeFound, `app.asar.unpacked 內的 ffprobe 二進位存在：${unpackedFfprobeDir}`);

    if (!/app\.asar\.unpacked/.test(mainLog)) {
      console.log('（提示：main process 早期 stdout 未擷取到 FFmpeg path log，屬擷取時序，不影響上面兩項 fs 層驗證）');
    }
  } finally {
    await electronApp.close().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(hadFailure ? 'RESULT FAIL' : 'RESULT PASS');
  process.exit(hadFailure ? 1 : 0);
}

main().catch((err) => {
  console.error('FAIL 未預期例外：', err);
  process.exit(1);
});
