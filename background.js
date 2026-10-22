// Toolbar badge: "ON" while the bot plays in that tab.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'state' || !sender.tab) return;
  const on = msg.status && msg.status.wanted;
  chrome.action.setBadgeText({tabId: sender.tab.id, text: on ? 'ON' : ''});
  chrome.action.setBadgeBackgroundColor({tabId: sender.tab.id, color: '#00a000'});
});
