const toggleBtn = document.getElementById('toggle');
const clearCacheBtn = document.getElementById('clearCache');

function updateButtonText(monitoring) {
    toggleBtn.textContent = monitoring ? 'Stop Monitoring' : 'Start Monitoring';
}

chrome.storage.sync.get('monitoring', (data) => {
    updateButtonText(data.monitoring);
});

toggleBtn.addEventListener('click', () => {
    chrome.storage.sync.get('monitoring', (data) => {
        const newState = !data.monitoring;
        chrome.storage.sync.set({ monitoring: newState }, () => {
            updateButtonText(newState);
            // Notify background to start/stop alarms
            chrome.runtime.sendMessage({ action: newState ? 'start' : 'stop' });
        });
    });
});

clearCacheBtn.addEventListener('click', () => {
    chrome.storage.local.remove('cachedContent', () => {
        alert('Cache cleared');
    });
});
