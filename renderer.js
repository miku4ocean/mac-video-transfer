// ========================================
// State Management
// ========================================
const state = {
    files: [],          // Array of file objects with info
    isConverting: false,
    currentFileIndex: 0,
    results: []
};

// ========================================
// DOM Elements
// ========================================
const elements = {
    // Drop zone
    dropZone: document.getElementById('dropZone'),
    selectFilesBtn: document.getElementById('selectFilesBtn'),

    // File list
    fileListContainer: document.getElementById('fileListContainer'),
    fileList: document.getElementById('fileList'),
    fileCount: document.getElementById('fileCount'),
    clearAllBtn: document.getElementById('clearAllBtn'),
    startConvertBtn: document.getElementById('startConvertBtn'),

    // Settings
    outputFormat: document.getElementById('outputFormat'),
    videoCodec: document.getElementById('videoCodec'),
    crfSlider: document.getElementById('crfSlider'),
    crfValue: document.getElementById('crfValue'),
    encodingPreset: document.getElementById('encodingPreset'),
    copyAudio: document.getElementById('copyAudio'),

    // Progress
    progressPanel: document.getElementById('progressPanel'),
    currentFileInfo: document.getElementById('currentFileInfo'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    progressSpeed: document.getElementById('progressSpeed'),
    progressTime: document.getElementById('progressTime'),
    cancelBtn: document.getElementById('cancelBtn'),

    // Results
    resultsPanel: document.getElementById('resultsPanel'),
    resultsList: document.getElementById('resultsList'),
    newConversionBtn: document.getElementById('newConversionBtn'),

    // Toast
    toastContainer: document.getElementById('toastContainer')
};

// ========================================
// Utility Functions
// ========================================
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '--:--';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getFileIcon(extension) {
    const icons = {
        'mov': '🎬',
        'mp4': '🎬',
        'mpg': '📼',
        'mpeg': '📼',
        'wmv': '🎞️',
        'webm': '🌐',
        'avi': '📹',
        'mkv': '🎥',
        'flv': '📺',
        'm4v': '🍎',
        '3gp': '📱'
    };
    return icons[extension.toLowerCase()] || '🎬';
}

function getFileName(filePath) {
    return filePath.split('/').pop();
}

function getFileExtension(filePath) {
    return filePath.split('.').pop().toLowerCase();
}

function showToast(message, type = 'info') {
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span class="toast-message">${message}</span>
  `;

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ========================================
// File Handling
// ========================================
async function addFiles(filePaths) {
    for (const filePath of filePaths) {
        // Check if already added
        if (state.files.find(f => f.path === filePath)) {
            showToast(`已跳過重複檔案: ${getFileName(filePath)}`, 'warning');
            continue;
        }

        try {
            const info = await window.api.getVideoInfo(filePath);
            state.files.push({
                path: filePath,
                name: getFileName(filePath),
                extension: getFileExtension(filePath),
                info: info
            });
        } catch (error) {
            console.error('Error getting video info:', error);
            showToast(`無法讀取檔案: ${getFileName(filePath)}`, 'error');
        }
    }

    updateFileList();
}

function removeFile(index) {
    state.files.splice(index, 1);
    updateFileList();
}

function clearAllFiles() {
    state.files = [];
    updateFileList();
}

function updateFileList() {
    const count = state.files.length;
    elements.fileCount.textContent = count;
    elements.startConvertBtn.disabled = count === 0;

    if (count === 0) {
        elements.fileListContainer.classList.add('hidden');
        elements.dropZone.style.display = 'flex';
        return;
    }

    elements.fileListContainer.classList.remove('hidden');
    elements.dropZone.style.display = 'none';

    elements.fileList.innerHTML = state.files.map((file, index) => `
    <div class="file-item" data-index="${index}">
      <div class="file-icon">${getFileIcon(file.extension)}</div>
      <div class="file-info">
        <div class="file-name">${file.name}</div>
        <div class="file-meta">
          <span>📐 ${file.info.video?.width}×${file.info.video?.height}</span>
          <span>📦 ${formatBytes(file.info.size)}</span>
          <span>⏱️ ${formatDuration(file.info.duration)}</span>
        </div>
      </div>
      <div class="file-actions">
        <button class="file-action-btn remove" title="移除" onclick="removeFile(${index})">🗑️</button>
      </div>
    </div>
  `).join('');
}

// ========================================
// Conversion
// ========================================
async function startConversion() {
    if (state.files.length === 0) return;

    state.isConverting = true;
    state.currentFileIndex = 0;
    state.results = [];

    // Show progress panel
    elements.progressPanel.classList.remove('hidden');
    elements.fileListContainer.classList.add('hidden');
    elements.resultsPanel.classList.add('hidden');

    // Get settings
    const settings = {
        codec: elements.videoCodec.value,
        crf: parseInt(elements.crfSlider.value),
        preset: elements.encodingPreset.value,
        copyAudio: elements.copyAudio.checked
    };

    const outputFormat = elements.outputFormat.value;

    // Process each file
    for (let i = 0; i < state.files.length; i++) {
        if (!state.isConverting) break;

        state.currentFileIndex = i;
        const file = state.files[i];

        // Update UI
        elements.currentFileInfo.innerHTML = `
      <div class="file-name">正在處理: ${file.name} (${i + 1}/${state.files.length})</div>
    `;

        // Generate output path
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const outputPath = await window.api.saveFileDialog(
            `${baseName}_compressed.${outputFormat}`,
            outputFormat
        );

        if (!outputPath) {
            showToast(`已跳過: ${file.name}`, 'warning');
            continue;
        }

        try {
            const result = await window.api.convertVideo({
                inputPath: file.path,
                outputPath: outputPath,
                settings: settings
            });

            state.results.push({
                inputPath: file.path,
                inputName: file.name,
                inputSize: file.info.size,
                outputPath: result.outputPath,
                outputName: getFileName(result.outputPath),
                outputSize: result.outputSize,
                success: true
            });

        } catch (error) {
            console.error('Conversion error:', error);
            state.results.push({
                inputPath: file.path,
                inputName: file.name,
                success: false,
                error: error.message
            });
            showToast(`轉檔失敗: ${file.name}`, 'error');
        }
    }

    state.isConverting = false;
    showResults();
}

function cancelConversion() {
    state.isConverting = false;
    window.api.cancelConversion();
    showToast('已取消轉檔', 'warning');

    elements.progressPanel.classList.add('hidden');
    elements.fileListContainer.classList.remove('hidden');
}

function showResults() {
    elements.progressPanel.classList.add('hidden');
    elements.resultsPanel.classList.remove('hidden');

    const successCount = state.results.filter(r => r.success).length;
    showToast(`完成! ${successCount}/${state.results.length} 個檔案成功轉換`, 'success');

    elements.resultsList.innerHTML = state.results.map((result, index) => {
        if (!result.success) {
            return `
        <div class="result-item error">
          <div class="result-icon" style="background: linear-gradient(135deg, var(--danger), #dc2626)">❌</div>
          <div class="result-info">
            <div class="result-name">${result.inputName}</div>
            <div class="result-stats">
              <span class="stat-item" style="color: var(--danger)">${result.error || '轉檔失敗'}</span>
            </div>
          </div>
        </div>
      `;
        }

        const compressionRatio = ((1 - result.outputSize / result.inputSize) * 100).toFixed(1);

        return `
      <div class="result-item">
        <div class="result-icon">✓</div>
        <div class="result-info">
          <div class="result-name">${result.outputName}</div>
          <div class="result-stats">
            <span class="stat-item">
              <span class="stat-label">原始:</span>
              <span class="stat-value">${formatBytes(result.inputSize)}</span>
            </span>
            <span class="stat-item">
              <span class="stat-label">壓縮後:</span>
              <span class="stat-value success">${formatBytes(result.outputSize)}</span>
            </span>
            <span class="stat-item">
              <span class="stat-label">節省:</span>
              <span class="stat-value success">${compressionRatio}%</span>
            </span>
          </div>
        </div>
        <div class="result-actions">
          <button class="btn btn-sm btn-secondary" onclick="window.api.openFile('${result.outputPath.replace(/'/g, "\\'")}')">
            <span class="btn-icon">▶️</span>
            播放
          </button>
          <button class="btn btn-sm btn-secondary" onclick="window.api.showInFolder('${result.outputPath.replace(/'/g, "\\'")}')">
            <span class="btn-icon">📁</span>
            開啟資料夾
          </button>
        </div>
      </div>
    `;
    }).join('');
}

function startNewConversion() {
    state.files = [];
    state.results = [];
    elements.resultsPanel.classList.add('hidden');
    elements.dropZone.style.display = 'flex';
    updateFileList();
}

// ========================================
// Event Listeners
// ========================================

// File selection
elements.selectFilesBtn.addEventListener('click', async () => {
    const filePaths = await window.api.openFileDialog();
    if (filePaths && filePaths.length > 0) {
        await addFiles(filePaths);
    }
});

// Drag and drop
elements.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    elements.dropZone.classList.add('drag-over');
});

elements.dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    elements.dropZone.classList.remove('drag-over');
});

elements.dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    elements.dropZone.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files);
    const validExtensions = ['mov', 'mp4', 'mpg', 'mpeg', 'wmv', 'webm', 'avi', 'mkv', 'flv', 'm4v', '3gp'];
    const filePaths = files
        .filter(f => validExtensions.includes(getFileExtension(f.name)))
        .map(f => f.path);

    if (filePaths.length > 0) {
        await addFiles(filePaths);
    } else {
        showToast('請選擇有效的影片檔案', 'warning');
    }
});

// Also allow drop on the whole document
document.addEventListener('dragover', (e) => {
    e.preventDefault();
});

document.addEventListener('drop', async (e) => {
    e.preventDefault();

    if (state.isConverting) return;

    const files = Array.from(e.dataTransfer.files);
    const validExtensions = ['mov', 'mp4', 'mpg', 'mpeg', 'wmv', 'webm', 'avi', 'mkv', 'flv', 'm4v', '3gp'];
    const filePaths = files
        .filter(f => validExtensions.includes(getFileExtension(f.name)))
        .map(f => f.path);

    if (filePaths.length > 0) {
        await addFiles(filePaths);
    }
});

// CRF slider
elements.crfSlider.addEventListener('input', (e) => {
    elements.crfValue.textContent = e.target.value;
});

// Preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const crf = btn.dataset.crf;
        const preset = btn.dataset.preset;

        elements.crfSlider.value = crf;
        elements.crfValue.textContent = crf;
        elements.encodingPreset.value = preset;
    });
});

// Format/codec relationship
elements.outputFormat.addEventListener('change', () => {
    const format = elements.outputFormat.value;
    if (format === 'webm') {
        elements.videoCodec.value = 'vp9';
    } else if (elements.videoCodec.value === 'vp9') {
        elements.videoCodec.value = 'h265';
    }
});

// Buttons
elements.clearAllBtn.addEventListener('click', clearAllFiles);
elements.startConvertBtn.addEventListener('click', startConversion);
elements.cancelBtn.addEventListener('click', cancelConversion);
elements.newConversionBtn.addEventListener('click', startNewConversion);

// IPC event listeners
window.api.onConversionProgress((data) => {
    const percent = Math.round(data.percent || 0);
    elements.progressBar.querySelector('.progress-fill').style.width = `${percent}%`;
    elements.progressText.textContent = `${percent}%`;
    elements.progressTime.textContent = data.currentTime || '--:--';
    elements.progressSpeed.textContent = data.speed ? `${data.speed} fps` : '--';
});

// Make removeFile available globally
window.removeFile = removeFile;

// ========================================
// Initialization
// ========================================
console.log('Video Compressor loaded');
