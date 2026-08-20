chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'start') {
        chrome.alarms.create('checkPage', { periodInMinutes: 5 });
    } else if (message.action === 'stop') {
        chrome.alarms.clear('checkPage');
    }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkPage') {
        checkPage();
    }
});

async function checkPage() {
    const { targetUrl, discordWebhook } = await chrome.storage.sync.get(['targetUrl', 'discordWebhook']);
    const { cachedContent } = await chrome.storage.local.get('cachedContent');
    
    if (!targetUrl) return;

    try {
        const response = await fetch(targetUrl);
        const text = await response.text();

        if (cachedContent && cachedContent !== text) {
            // Content changed
            notifyUser(targetUrl);
            if (discordWebhook) {
                fetch(discordWebhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: `Content changed on ${targetUrl}` })
                });
            }
        }
        
        chrome.storage.local.set({ cachedContent: text });
    } catch (e) {
        console.error('Check failed', e);
    }
}

function notifyUser(url) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.svg',
        title: 'Web Monitor',
        message: `Content changed on ${url}`
    });
}
