let monitoring = false;

// Listen for start/stop commands from popup.js
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'start') {
    monitoring = true;
    scheduleNextCheck();
  } else if (message.action === 'stop') {
    monitoring = false;
    chrome.alarms.clear('checkPage');
  }
});

// Handle the background alarm event
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkPage' && monitoring) {
    refreshAndCheckPage();
  }
});

// Schedule a randomized check between 5 and 20 minutes
function scheduleNextCheck() {
  if (!monitoring) return;
  
  const minMinutes = 5;
  const maxMinutes = 20;
  const randomMinutes = Math.random() * (maxMinutes - minMinutes) + minMinutes;

  console.log(`Next check scheduled in approximately ${randomMinutes.toFixed(1)} minutes.`);
  chrome.alarms.create('checkPage', { delayInMinutes: randomMinutes });
}

// Main function to refresh the open tab and check visible content + Projects table
async function refreshAndCheckPage() {
  if (!monitoring) return;

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

              // 1. Isolate Projects table and extract name
              const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, th, span, div'));
              const projectsHeading = headings.find(el => el.textContent.trim() === 'Projects');
              
              if (projectsHeading) {
                let targetContainer = projectsHeading.nextElementSibling;
                while (targetContainer && targetContainer.tagName !== 'TABLE' && targetContainer.tagName !== 'DIV') {
                  targetContainer = targetContainer.nextElementSibling;
                }
                if (targetContainer && isVisible(targetContainer)) {
                  tableHTML = targetContainer.innerHTML;
                  
                  // Extract the first meaningful line of text as the content name
                  const textLines = targetContainer.innerText.split('\n').map(t => t.trim()).filter(t => t.length > 0);
                  if (textLines.length > 0) {
                    contentName = textLines[0];
                  }
                }
              }

              // 2. Grab broader visible body elements
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

              // Return an object instead of a concatenated string
              return { tableHTML, bodyHTML, contentName };
            }
          });

          if (results && results[0]) {
            const currentData = results[0].result;

            if (cachedContent) {
              let alertMessage = null;
              
              // Check if the table specifically changed
              if (cachedContent.tableHTML !== currentData.tableHTML) {
                alertMessage = `🕷️ **Ossa Alert:** Projects Table Updated!\n**Content:** ${currentData.contentName}`;
              } 
              // Otherwise, check if general page changed
              else if (cachedContent.bodyHTML !== currentData.bodyHTML) {
                alertMessage = `🕷️ **Ossa Alert:** General visible page updates detected.`;
              }

              // Send alert without any URLs
              if (alertMessage && discordWebhook) {
                await sendDiscordAlert(discordWebhook, alertMessage);
              }
            }

            await chrome.storage.local.set({ cachedContent: currentData });
          }
        } catch (error) {
          console.error('Could not read reloaded tab:', error);
        } finally {
          if (monitoring) scheduleNextCheck();
        }
      }, 15000); 
    });
  });
}

// Send tailored alert to Discord webhook
async function sendDiscordAlert(webhookUrl, message) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
    console.log('Discord notification sent.');
  } catch (error) {
    console.error('Failed to send Discord webhook:', error);
  }
}
