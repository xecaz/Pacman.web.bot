// Isolated-world relay between the extension (popup, background) and the bot in the page (pacbot.js, MAIN world).
// Page -> extension: {source: 'pacbot', type: 'state' | 'reply', ...}
// Extension -> page: {source: 'pacbot-ext', id, cmd}
(() => {
  let nextId = 1;
  const waiting = new Map();

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'pacbot') return;
    const m = e.data;
    if (m.type === 'reply' && waiting.has(m.id)) {
      waiting.get(m.id)(m.status);
      waiting.delete(m.id);
    } else if (m.type === 'state') {
      try { chrome.runtime.sendMessage({type: 'state', status: m.status}); } catch (err) {}
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'cmd') return;
    const id = nextId++;
    waiting.set(id, sendResponse);
    window.postMessage({source: 'pacbot-ext', id, cmd: msg.cmd}, '*');
    setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); sendResponse(null); } }, 1500);
    return true;   // reply asynchronously
  });
})();
