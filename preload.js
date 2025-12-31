const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
    // File dialogs
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    saveFileDialog: (defaultName, format) => ipcRenderer.invoke('save-file-dialog', defaultName, format),

    // Video operations
    getVideoInfo: (filePath) => ipcRenderer.invoke('get-video-info', filePath),
    convertVideo: (options) => ipcRenderer.invoke('convert-video', options),
    cancelConversion: () => ipcRenderer.invoke('cancel-conversion'),

    // File operations
    showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
    openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),

    // Event listeners
    onConversionStarted: (callback) => {
        ipcRenderer.on('conversion-started', (event, data) => callback(data));
    },
    onConversionProgress: (callback) => {
        ipcRenderer.on('conversion-progress', (event, data) => callback(data));
    },

    // Remove listeners
    removeAllListeners: (channel) => {
        ipcRenderer.removeAllListeners(channel);
    }
});
