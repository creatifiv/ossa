// Helper functions to persist monitoring state across service worker restarts
async function setMonitoring(status) {
  await chrome.storage.local.set({ monitoring: status });
}

async function getMonitoring() {
  const data = await chrome.storage.local.get('monitoring');
  return !!data.monitoring;
}

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.action === 'start') {
    await setMonitoring(true);
    scheduleNextCheck();
  } else if (message.action === 'stop') {
    await setMonitoring(false);
    chrome.alarms.clear('checkPage');
    console.log('Monitoring stopped.');
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkPage' && (await getMonitoring())) {
    refreshAndCheckPage();
  }
});

async function scheduleNextCheck() {
  if (!(await getMonitoring())) return;
  
  const minMinutes = 1;
  const maxMinutes = 10;
  const randomMinutes = Math.random() * (maxMinutes - minMinutes) + minMinutes;

  console.log(`Next check scheduled in approximately ${randomMinutes.toFixed(1)} minutes.`);
  chrome.alarms.create('checkPage', { delayInMinutes: randomMinutes });
}

async function refreshAndCheckPage() {
  if (!(await getMonitoring())) return;

  const { targetUrl, discordWebhook } = await chrome.storage.sync.get(['targetUrl', 'discordWebhook']);
  const { cachedContent } = await chrome.storage.local.get('cachedContent');

  if (!targetUrl) {
    console.error('No target URL configured.');
    return;
  }

  chrome.tabs.query({ windowType: 'normal' }, async (tabs) => {
    const matchingTab = tabs.find(tab => tab.url && tab.url.includes(targetUrl));

    if (!matchingTab) {
      console.log('No matching open tab found. Skipping this cycle.');
      scheduleNextCheck();
      return;
    }

    const tabId = matchingTab.id;

    chrome.tabs.reload(tabId, () => {
      if (chrome.runtime.lastError) {
        console.warn('Reload warning:', chrome.runtime.lastError.message);
        scheduleNextCheck();
        return;
      }

      setTimeout(async () => {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
              function isVisible(el) {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                  return false;
                }
                return el.parentElement ? isVisible(el.parentElement) : true;
              }

              let tableHTML = '';
              let contentName = 'Unknown Project Data';

              const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, th, span, div'));
              const projectsHeading = headings.find(el => el.textContent.trim() === 'Projects');
              
              if (projectsHeading) {
                let targetContainer = projectsHeading.nextElementSibling;
                while (targetContainer && targetContainer.tagName !== 'TABLE' && targetContainer.tagName !== 'DIV') {
                  targetContainer = targetContainer.nextElementSibling;
                }
                if (targetContainer && isVisible(targetContainer)) {
                  tableHTML = targetContainer.innerHTML;
                  
                  const textLines = targetContainer.innerText.split('\n').map(t => t.trim()).filter(t => t.length > 0);
                  if (textLines.length > 0) {
                    contentName = textLines[0];
                  }
                }
              }

              const walkDOM = (node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  if (!isVisible(node)) return '';
                  let innerStr = '';
                  for (let child of node.childNodes) {
                    innerStr += walkDOM(child);
                  }
                  return `<${node.tagName}>${innerStr}</${node.tagName}>`;
                } else if (node.nodeType === Node.TEXT_NODE) {
                  return node.textContent.trim();
                }
                return '';
              };

              let bodyHTML = walkDOM(document.body);

              return { tableHTML, bodyHTML, contentName };
            }
          });

          if (results && results[0]) {
            const currentData = results[0].result;

            if (cachedContent) {
              let alertMessage = null;
              
              if (cachedContent.tableHTML !== currentData.tableHTML) {
                alertMessage = `🕷️ **Ossa Alert:** Projects Table Updated!\n**Content:** ${currentData.contentName}`;
              } else if (cachedContent.bodyHTML !== currentData.bodyHTML) {
                alertMessage = `🕷️ **Ossa Alert:** General visible page updates detected.`;
              }

              if (alertMessage && discordWebhook) {
                await sendDiscordAlert(discordWebhook, alertMessage);
              }
            }

            await chrome.storage.local.set({ cachedContent: currentData });
          }
        } catch (error) {
          console.error('Could not read reloaded tab:', error);
        } finally {
          if (await getMonitoring()) {
            scheduleNextCheck();
          }
        }
      }, 15000); 
    });
  });
}

async function sendDiscordAlert(webhookUrl, message) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: message
      })
    });
    console.log('Discord notification sent.');
  } catch (error) {
    console.error('Failed to send Discord webhook:', error);
  }
}
