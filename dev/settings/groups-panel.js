// 組合 (bottom right, between the power button and the app menu): the saved groups. Clicking one brings it out on
// the desktop (a group out is closed from its row in the layer list); ✎ edits one (desktop-panel.js shows 保存);
// 🗑 deletes one, after asking.
// Groups are made in the layer list (desktop-panel.js); the app keeps them (main.cjs).

const PENCIL = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 17.2V20h2.8l9.9-9.9-2.8-2.8L4 17.2zm15.7-9.4a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0l-1.6 1.6 2.8 2.8 2.3-.9z"/></svg>';
const TRASH = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h2v-8h-2zm4 0v8h2v-8h-2z"/></svg>';

function setGroupsOpen(open) {
  $('groups-panel').hidden = !open;
  $('groups-toggle').setAttribute('aria-expanded', String(open));
  if (open) setAppMenuOpen(false); else $('groups-panel').querySelector('.groups-status')?.replaceChildren();
}

function renderGroups(groups) {
  const panel = $('groups-panel'), status = document.createElement('p');
  status.className = 'groups-status';
  status.setAttribute('role', 'status');
  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'groups-empty';
    empty.textContent = '還沒有組合。在圖層清單用 Shift＋點選角色，再按右鍵組合。';
    panel.replaceChildren(empty);
    return;
  }
  panel.replaceChildren(...groups.map(group => {
    const item = document.createElement('div'), open = document.createElement('button'), change = document.createElement('button'), remove = document.createElement('button');
    item.className = 'group-item' + (group.active ? ' active' : '');
    item.dataset.id = group.id;
    open.type = change.type = remove.type = 'button';
    open.className = 'group-name';
    open.textContent = group.name;
    open.title = group.members.map(id => library.has(id) ? characterLabel(library.get(id)) : id).join('、');
    open.onclick = async () => {
      if (group.active) return;
      const result = await window.desktopAPI.openGroup(group.id);
      if (result?.ok) setGroupsOpen(false); else status.textContent = result?.message || '無法叫出這個組合。';
    };
    change.className = 'icon-button';
    change.innerHTML = PENCIL;
    change.title = change.ariaLabel = '編輯組合';
    change.onclick = async () => {
      const result = await window.desktopAPI.editGroup(group.id);
      if (result?.ok) setGroupsOpen(false); else status.textContent = result?.message || '無法編輯這個組合。';
    };
    remove.className = 'icon-button';
    remove.innerHTML = TRASH;
    remove.title = remove.ariaLabel = '刪除組合';
    remove.onclick = async () => {
      if (!await confirmDialog('要刪除組合「' + group.name + '」嗎？', { detail: '組合裡的角色不會受影響。', ok: '刪除', danger: true })) return;
      await window.desktopAPI.deleteGroup(group.id);
    };
    item.append(open, change, remove);
    return item;
  }), status);
}

function setUpGroups() {
  $('groups-toggle').onclick = () => setGroupsOpen($('groups-panel').hidden);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') setGroupsOpen(false); });
  document.addEventListener('pointerdown', event => {
    if (!$('groups-panel').hidden && !event.target.closest?.('.groups-dock, #dialog')) setGroupsOpen(false);
  });
}
