chrome.runtime.onMessage.addListener((message) => { 
  if (message.action === 'start') { 
    chrome.alarms.create('checkPage', { periodInMinutes: 5 }); 
  } else if (message.action === 'stop') { 
    chrome.alarms.clear('checkPage'); 
  } 
});

chrome.alarms.onAlarm.addListener((alarm) => { 
  if (alarm.name === 'checkPage') { 
    refreshAndCheckPage(); 
  } 
});

async function refreshAndCheckPage() { 
  const { targetUrl, discordWebhook } = await chrome.storage.sync.get(['targetUrl', 'discordWebhook']); 
  const { cachedContent } = await chrome.storage.local.get('cachedContent');

  if (!targetUrl) return;

  // Find an open tab matching your target URL
  chrome.tabs.query({ url: targetUrl + '*' }, async (tabs) => {
    if (!tabs || tabs.length === 0) {
      console.log('No matching open tab found for monitoring.');
      return;
    }

    const tab = tabs[0];

    // 1. Automatically refresh the tab first
    chrome.tabs.reload(tab.id, async () => {
      // Wait 15 seconds for the page to finish rendering after reload
      setTimeout(async () => {
        try {
          // 2. Read the newly refreshed HTML content from Chrome's DOM
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.body.innerHTML
          });

          if (!results || !results[0]) return;
          const currentContent = results[0].result;

          // 3. Compare with the previous cache
          if (cachedContent && cachedContent !== currentContent) {
            if (discordWebhook) {
              await sendDiscordAlert(discordWebhook, targetUrl);
            }
          }

          // 4. Overwrite cache with the latest single snapshot
          await chrome.storage.local.set({ cachedContent: currentContent });
        } catch (error) {
          console.error('Could not read reloaded tab:', error);
        }
      }, 15000); // 15-second delay (15000 ms) to let the page load completely
    });
  });
}

async function sendDiscordAlert(webhookUrl, url) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: `🕷️ **Ossa Alert:** Content changed on your refreshed tab: ${url}`
      })
    });
  } catch (error) {
    console.error('Failed to send Discord webhook:', error);
  }
}
