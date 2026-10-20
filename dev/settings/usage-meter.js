// Usage meter (top centre, above the hint): the app's memory, refreshed every two seconds while the page is shown.

function setUpUsageMeter() {
  const refresh = async () => {
    if (document.hidden) return;
    const usage = await window.desktopAPI.getUsage();
    if (usage) $('usage').textContent = 'RAM ' + usage.memoryMB + ' MB';
  };
  refresh();
  setInterval(refresh, 2000);
  document.addEventListener('visibilitychange', refresh);
}
