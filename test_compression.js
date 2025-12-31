const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const testDir = path.join(__dirname, 'test_videos');
if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir);
}

// Test configurations
const testConfigs = [
    { name: 'H.265 High Quality', codec: 'libx265', crf: 20, preset: 'medium', ext: 'mp4' },
    { name: 'H.265 Balanced', codec: 'libx265', crf: 25, preset: 'medium', ext: 'mp4' },
    { name: 'H.265 Small File', codec: 'libx265', crf: 30, preset: 'medium', ext: 'mp4' },
    { name: 'H.264 High Quality', codec: 'libx264', crf: 20, preset: 'medium', ext: 'mp4' },
    { name: 'H.264 Balanced', codec: 'libx264', crf: 25, preset: 'medium', ext: 'mp4' },
    { name: 'H.264 Small File', codec: 'libx264', crf: 30, preset: 'medium', ext: 'mp4' },
    { name: 'VP9 Balanced', codec: 'libvpx-vp9', crf: 30, preset: null, ext: 'webm' }
];

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function createTestVideo() {
    const sourcePath = path.join(testDir, 'source_video.mp4');

    if (fs.existsSync(sourcePath)) {
        console.log('Source video already exists, skipping creation...');
        return sourcePath;
    }

    console.log('Creating 30-second 1080p test video...');

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input('testsrc2=duration=30:size=1920x1080:rate=30')
            .inputFormat('lavfi')
            .input('sine=frequency=440:duration=30')
            .inputFormat('lavfi')
            .videoCodec('libx264')
            .addOption('-preset', 'ultrafast')
            .addOption('-crf', '10')
            .audioCodec('aac')
            .audioBitrate('192k')
            .on('start', (cmd) => console.log('FFmpeg command:', cmd))
            .on('progress', (progress) => {
                process.stdout.write(`\rCreating source: ${Math.round(progress.percent || 0)}%`);
            })
            .on('end', () => {
                console.log('\nSource video created!');
                resolve(sourcePath);
            })
            .on('error', reject)
            .save(sourcePath);
    });
}

async function getVideoInfo(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            resolve({
                size: fs.statSync(filePath).size,
                duration: metadata.format.duration,
                width: metadata.streams.find(s => s.codec_type === 'video')?.width,
                height: metadata.streams.find(s => s.codec_type === 'video')?.height
            });
        });
    });
}

async function convertVideo(inputPath, config) {
    const outputName = `output_${config.name.replace(/\s+/g, '_').toLowerCase()}.${config.ext}`;
    const outputPath = path.join(testDir, outputName);

    console.log(`\nTesting: ${config.name}`);
    console.log(`  Codec: ${config.codec}, CRF: ${config.crf}`);

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
        let command = ffmpeg(inputPath);

        command = command.videoCodec(config.codec);
        command = command.addOption('-crf', config.crf.toString());

        if (config.preset) {
            command = command.addOption('-preset', config.preset);
        }

        if (config.codec === 'libx265') {
            command = command.addOption('-tag:v', 'hvc1');
        }

        command = command.audioCodec('aac').audioBitrate('128k');

        if (config.ext === 'mp4') {
            command = command.format('mp4').addOption('-movflags', '+faststart');
        } else if (config.ext === 'webm') {
            command = command.format('webm');
        }

        command
            .on('progress', (progress) => {
                process.stdout.write(`\r  Progress: ${Math.round(progress.percent || 0)}%`);
            })
            .on('end', () => {
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`\n  Completed in ${duration}s`);
                resolve(outputPath);
            })
            .on('error', reject)
            .save(outputPath);
    });
}

async function runTests() {
    console.log('='.repeat(60));
    console.log('Video Compression Test Suite');
    console.log('='.repeat(60));

    try {
        // Create source video
        const sourcePath = await createTestVideo();
        const sourceInfo = await getVideoInfo(sourcePath);

        console.log('\n' + '-'.repeat(60));
        console.log('Source Video Information:');
        console.log(`  Resolution: ${sourceInfo.width}x${sourceInfo.height}`);
        console.log(`  Duration: ${sourceInfo.duration.toFixed(1)}s`);
        console.log(`  File Size: ${formatBytes(sourceInfo.size)}`);
        console.log('-'.repeat(60));

        const results = [];

        // Run each test
        for (const config of testConfigs) {
            try {
                const outputPath = await convertVideo(sourcePath, config);
                const outputInfo = await getVideoInfo(outputPath);

                const compressionRatio = ((1 - outputInfo.size / sourceInfo.size) * 100).toFixed(1);

                results.push({
                    name: config.name,
                    codec: config.codec,
                    crf: config.crf,
                    inputSize: sourceInfo.size,
                    outputSize: outputInfo.size,
                    compressionRatio: compressionRatio,
                    resolution: `${outputInfo.width}x${outputInfo.height}`
                });

                console.log(`  Input: ${formatBytes(sourceInfo.size)} → Output: ${formatBytes(outputInfo.size)}`);
                console.log(`  Compression: ${compressionRatio}% smaller`);

            } catch (err) {
                console.error(`  Error: ${err.message}`);
            }
        }

        // Print summary table
        console.log('\n' + '='.repeat(60));
        console.log('Compression Test Results Summary');
        console.log('='.repeat(60));
        console.log('');
        console.log('| 編碼設定 | 原始大小 | 壓縮後大小 | 壓縮率 | 解析度 |');
        console.log('|----------|----------|------------|--------|--------|');

        for (const r of results) {
            console.log(`| ${r.name.padEnd(20)} | ${formatBytes(r.inputSize).padEnd(10)} | ${formatBytes(r.outputSize).padEnd(12)} | ${r.compressionRatio.padStart(5)}% | ${r.resolution} |`);
        }

        console.log('\n✅ All tests completed!');

        // Save results to JSON
        const resultsPath = path.join(testDir, 'test_results.json');
        fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
        console.log(`Results saved to: ${resultsPath}`);

    } catch (err) {
        console.error('Test failed:', err);
        process.exit(1);
    }
}

runTests();
