const $ = id => document.getElementById(id);
let tabId = null;

function show(st) {
  const off = !st;
  for (const b of ['turbo', 'normal', 'attach', 'stop']) $(b).disabled = off;
  if (off) { $('status').textContent = 'Open https://pacman.live/play.html in this tab (reload it once after installing).'; return; }
  $('stop').disabled = !st.wanted;
  $('attach').disabled = st.wanted;
  const mode = st.turbo ? 'turbo' : 'normal';
  $('status').textContent = st.wanted
    ? `Playing (${mode})\nLevel ${st.level}  deaths ${st.deaths}` + (st.waitingFocus ? '\nWaiting: click the game window' : '')
    : (st.note || 'Stopped');
}

function send(cmd) {
  return new Promise(resolve => {
    if (tabId === null) return resolve(null);
    chrome.tabs.sendMessage(tabId, {type: 'cmd', cmd}, res => { void chrome.runtime.lastError; resolve(res || null); });
  });
}

async function act(cmd) {
  const st = await send(cmd);
  show(st);
  // closing the popup hands focus back to the game, which pauses while the window is blurred
  if (st && cmd !== 'status' && cmd !== 'stop') setTimeout(() => window.close(), 300);
}

$('turbo').onclick = () => act('turbo');
$('normal').onclick = () => act('normal');
$('attach').onclick = () => act('attach');
$('stop').onclick = () => act('stop');

chrome.tabs.query({active: true, currentWindow: true}, async tabs => {
  tabId = tabs[0] ? tabs[0].id : null;
  show(await send('status'));
});
