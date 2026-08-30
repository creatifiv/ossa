document.addEventListener('DOMContentLoaded', async () => {
  const toggleBtn = document.getElementById('toggle');
  const clearBtn = document.getElementById('clearCache');
  const countdownEl = document.getElementById('countdown');

  updateButtonState();
  updateCountdown();

  setInterval(updateCountdown, 1000);

  toggleBtn.addEventListener('click', async () => {
    const alarms = await chrome.alarms.getAll();
    const isMonitoring = alarms.some(alarm => alarm.name === 'checkPage');

    if (isMonitoring) {
      chrome.runtime.sendMessage({ action: 'stop' });
      toggleBtn.textContent = 'Start Monitoring';
      toggleBtn.style.backgroundColor = '';
      countdownEl.textContent = '--:--';
    } else {
      chrome.runtime.sendMessage({ action: 'start' });
      toggleBtn.textContent = 'Stop Monitoring';
      toggleBtn.style.backgroundColor = 'var(--danger)';
    }
  });

  clearBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove('cachedContent');
    clearBtn.textContent = 'Cache Cleared!';
    setTimeout(() => {
      clearBtn.textContent = 'Clear Cache';
    }, 1500);
  });

  async function updateButtonState() {
    const alarms = await chrome.alarms.getAll();
    const isMonitoring = alarms.some(alarm => alarm.name === 'checkPage');

    if (isMonitoring) {
      toggleBtn.textContent = 'Stop Monitoring';
      toggleBtn.style.backgroundColor = 'var(--danger)';
    } else {
      toggleBtn.textContent = 'Start Monitoring';
      toggleBtn.style.backgroundColor = '';
    }
  }

  async function updateCountdown() {
    const alarm = await chrome.alarms.get('checkPage');
    if (!alarm) {
      countdownEl.textContent = '--:--';
      return;
    }

    const now = Date.now();
    const remainingMs = alarm.scheduledTime - now;

    if (remainingMs <= 0) {
      countdownEl.textContent = 'Checking...';
      return;
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    countdownEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
});
