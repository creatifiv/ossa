document.getElementById('save').addEventListener('click', () => {
    const url = document.getElementById('url').value;
    const webhook = document.getElementById('webhook').value;
    chrome.storage.sync.set({ targetUrl: url, discordWebhook: webhook }, () => {
        alert('Options saved');
    });
});

chrome.storage.sync.get(['targetUrl', 'discordWebhook'], (result) => {
    document.getElementById('url').value = result.targetUrl || '';
    document.getElementById('webhook').value = result.discordWebhook || '';
});
