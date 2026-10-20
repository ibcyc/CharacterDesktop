// Settings page start-up: runs the extensions' parts of the page, starts the preview, then wires every panel to the app.
// Load order (see build.py): shared rules and kinds, preview, panels, this file, motion.

async function startSettings() {
  const state = await window.desktopAPI.getState();
  document.title = 'CharacterDesktop v' + state.version;
  setUpDialogs();
  // The app menu first: whatever else fails to start, the power button and 重啟 still work.
  setUpAppMenu();
  setUpStartupSwitch(state);
  window.desktopAPI.onOptions(showDesktopOptions);
  setUpCharacterPanel();
  setUpTuningPanel(state);
  setUpExpressionMenus();
  await restoreFromApp(state);
  // Restoring may change the look and with it the height, so the options are read again.
  showDesktopOptions((await window.desktopAPI.getState()).options);
  setUpDesktopPanel();
  setUpDownloadPanel(state);
  setUpLocalPanel(state);
  setUpSourcesPanel(state);
  setUpUiPanel(state);
  setUpInstall(state);
  setUpGroups();
  setUpTools();
  setUpUsageMeter();
  const news = [...state.extensionProblems, ...state.notices];
  if (news.length) $('errors').textContent = news.join('\n');
  exposeTestHooks();
}

// Hooks used by the self-tests.
function exposeTestHooks() {
  window.desktopSettingsTest = {
    summary: () => ({ roles: library.size, activeId }),
    idle: () => !!currentKey && ready && !busy,
    lastPoke: () => lastPokePlan,
    temporaryExpression: () => activeKind?.test?.temporaryExpression() ?? null,
    kind: id => characterKinds.get(id)?.test,
    tool: id => tools.get(id)?.test,
    moveLayer
  };
  window.desktopInstallTest = { offerShortcut, uninstallApp };
  window.desktopWorkflowTest = { download: downloadFromURL, downloadList, showPicked, addLocal, saveRename, changeTuning, exportPack, importPack };
}

// Only layer rows can be dragged. A drag started anywhere else (text, an image, a link) is stopped: it would also
// take the mouse away from a slider being dragged.
document.addEventListener('dragstart', event => { if (!event.target.closest?.('.layer')) event.preventDefault(); });

loadExtensionPages('settings').then(startPreview).then(startSettings).catch(showError);
