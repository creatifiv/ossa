let attachedTabId = null;
let monitoring = false;


// ---------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'start') {
        startMonitoring();
    }

    if (message.action === 'stop') {
        stopMonitoring();
    }
});


chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'checkPage' && monitoring) {
        await checkPage();

        // Schedule the next check only after this one finishes.
        if (monitoring) {
            scheduleNextCheck();
        }
    }
});


// ---------------------------------------------------------
// Schedule next check
// ---------------------------------------------------------

function scheduleNextCheck() {
    // Random interval between 3 and 10 minutes.
    const minMinutes = 3;
    const maxMinutes = 10;

    const delay =
        minMinutes +
        Math.random() * (maxMinutes - minMinutes);

    chrome.alarms.create('checkPage', {
        delayInMinutes: delay
    });

    console.log(
        `Next check scheduled in ${delay.toFixed(2)} minutes`
    );
}


// ---------------------------------------------------------
// Start monitoring
// ---------------------------------------------------------

async function startMonitoring() {
    monitoring = true;

    // Prevent an old alarm from remaining active.
    await chrome.alarms.clear('checkPage');

    // Check immediately.
    await checkPage();

    // Schedule the next random check.
    if (monitoring) {
        scheduleNextCheck();
    }
}


// ---------------------------------------------------------
// Stop monitoring
// ---------------------------------------------------------

async function stopMonitoring() {
    monitoring = false;

    await chrome.alarms.clear('checkPage');

    if (attachedTabId !== null) {
        try {
            await chrome.debugger.detach({
                tabId: attachedTabId
            });
        } catch (e) {
            // Tab may already be closed/detached.
        }

        attachedTabId = null;
    }
}


// ---------------------------------------------------------
// Normalize URLs for tab matching
// ---------------------------------------------------------

function normalizeUrl(url) {
    try {
        const parsed = new URL(url);

        // Ignore query string and hash.
        // Remove trailing slash from pathname.
        let pathname = parsed.pathname.replace(/\/+$/, '');

        if (!pathname) {
            pathname = '/';
        }

        return {
            origin: parsed.origin,
            pathname
        };

    } catch (e) {
        return null;
    }
}


// ---------------------------------------------------------
// Determine whether a tab matches targetUrl
// ---------------------------------------------------------

function urlsMatch(targetUrl, tabUrl) {
    const target = normalizeUrl(targetUrl);
    const tab = normalizeUrl(tabUrl);

    if (!target || !tab) {
        return false;
    }

    return (
        target.origin === tab.origin &&
        target.pathname === tab.pathname
    );
}


// ---------------------------------------------------------
// Find already-open target tab
// ---------------------------------------------------------

async function findTargetTab(targetUrl) {

    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {

        if (!tab.id || !tab.url) {
            continue;
        }

        if (urlsMatch(targetUrl, tab.url)) {
            return tab;
        }
    }

    return null;
}


// ---------------------------------------------------------
// Attach debugger if necessary
// ---------------------------------------------------------

async function ensureDebuggerAttached(tabId) {

    // Already monitoring this tab.
    if (attachedTabId === tabId) {
        return;
    }


    // Detach from previous tab.
    if (attachedTabId !== null) {

        try {
            await chrome.debugger.detach({
                tabId: attachedTabId
            });
        } catch (e) {
            // Ignore.
        }

        attachedTabId = null;
    }


    // Attach to existing Chrome tab.
    await chrome.debugger.attach(
        { tabId },
        '1.3'
    );


    // Enable network events.
    await chrome.debugger.sendCommand(
        { tabId },
        'Network.enable'
    );


    attachedTabId = tabId;
}


// ---------------------------------------------------------
// Main page check
// ---------------------------------------------------------

async function checkPage() {

    if (!monitoring) {
        return;
    }


    const {
        targetUrl,
        discordWebhook
    } = await chrome.storage.sync.get([
        'targetUrl',
        'discordWebhook'
    ]);


    if (!targetUrl) {
        console.error(
            'No target URL configured.'
        );

        return;
    }


    // Find the tab that is already open.
    const tab =
        await findTargetTab(targetUrl);


    if (!tab || tab.id === undefined) {

        console.error(
            'Target tab is not open:',
            targetUrl
        );

        return;
    }


    const tabId = tab.id;


    try {

        // Attach BEFORE reload.
        await ensureDebuggerAttached(tabId);


        // Start listening BEFORE Chrome reloads.
        const responsePromise =
            waitForDocumentResponse(tabId);


        // Chrome performs the actual navigation.
        await chrome.tabs.reload(tabId);


        // Get the document downloaded by Chrome.
        const pageContent =
            await responsePromise;


        if (pageContent === null) {
            throw new Error(
                'Unable to capture document response.'
            );
        }


        // Get previous cached response.
        const {
            cachedContent
        } = await chrome.storage.local.get(
            'cachedContent'
        );


        // Compare with previous response.
        if (
            cachedContent !== undefined &&
            cachedContent !== pageContent
        ) {

            console.log(
                'Page changed:',
                targetUrl
            );


            // Local Chrome notification.
            notifyUser(targetUrl);


            // Discord notification.
            if (discordWebhook) {

                await sendDiscordNotification(
                    discordWebhook,
                    targetUrl
                );
            }
        }


        // Store latest response.
        await chrome.storage.local.set({
            cachedContent: pageContent
        });


    } catch (error) {

        console.error(
            'Check failed:',
            error
        );


        // Reset debugger state if necessary.
        if (
            attachedTabId === tabId &&
            !await tabStillExists(tabId)
        ) {
            attachedTabId = null;
        }
    }
}


// ---------------------------------------------------------
// Capture the main Document response
// ---------------------------------------------------------

function waitForDocumentResponse(tabId) {

    return new Promise((resolve, reject) => {

        let requestId = null;
        let finished = false;


        const timeout = setTimeout(() => {

            cleanup();

            reject(
                new Error(
                    'Timed out waiting for document response.'
                )
            );

        }, 30000);


        function cleanup() {

            clearTimeout(timeout);

            chrome.debugger.onEvent.removeListener(
                handleDebuggerEvent
            );
        }


        function finish(content) {

            if (finished) {
                return;
            }

            finished = true;

            cleanup();

            resolve(content);
        }


        function fail(error) {

            if (finished) {
                return;
            }

            finished = true;

            cleanup();

            reject(error);
        }


        async function handleDebuggerEvent(
            source,
            method,
            params
        ) {

            if (source.tabId !== tabId) {
                return;
            }


            // Identify the main HTML document.
            if (
                method ===
                'Network.responseReceived' &&
                params.type === 'Document'
            ) {

                requestId = params.requestId;

                console.log(
                    'Document response detected:',
                    params.response.url
                );
            }


            // Document finished downloading.
            if (
                method ===
                'Network.loadingFinished' &&
                params.requestId === requestId
            ) {

                try {

                    const result =
                        await chrome.debugger.sendCommand(
                            { tabId },
                            'Network.getResponseBody',
                            {
                                requestId
                            }
                        );


                    let body = result.body;


                    // Decode base64 responses.
                    if (result.base64Encoded) {

                        const binary =
                            atob(body);

                        const bytes =
                            new Uint8Array(
                                binary.length
                            );


                        for (
                            let i = 0;
                            i < binary.length;
                            i++
                        ) {
                            bytes[i] =
                                binary.charCodeAt(i);
                        }


                        body =
                            new TextDecoder().decode(
                                bytes
                            );
                    }


                    finish(body);

                } catch (error) {

                    fail(error);
                }
            }
        }


        chrome.debugger.onEvent.addListener(
            handleDebuggerEvent
        );
    });
}


// ---------------------------------------------------------
// Check whether target tab still exists
// ---------------------------------------------------------

async function tabStillExists(tabId) {

    try {

        await chrome.tabs.get(tabId);

        return true;

    } catch (e) {

        return false;
    }
}


// ---------------------------------------------------------
// Chrome notification
// ---------------------------------------------------------

function notifyUser(url) {

    chrome.notifications.create({

        type: 'basic',

        title: 'Web Monitor',

        message:
            `Content changed on ${url}`

    });
}


// ---------------------------------------------------------
// Discord notification
// ---------------------------------------------------------

async function sendDiscordNotification(
    webhook,
    url
) {

    try {

        await fetch(webhook, {

            method: 'POST',

            headers: {
                'Content-Type':
                    'application/json'
            },

            body: JSON.stringify({

                content:
                    `Content changed on ${url}`

            })

        });

    } catch (error) {

        console.error(
            'Discord notification failed:',
            error
        );
    }
}


// ---------------------------------------------------------
// Handle target tab closing
// ---------------------------------------------------------

chrome.tabs.onRemoved.addListener(
    (tabId) => {

        if (tabId === attachedTabId) {
            attachedTabId = null;
        }
    }
);
