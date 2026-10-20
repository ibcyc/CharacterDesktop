// Questions in the page's own style, instead of the system's white message boxes: a card over the dimmed page with
// a message, a detail, an optional checkbox and its buttons. One question at a time; Esc answers with the first
// button (取消, 跳過), Enter with the focused one. The app asks through the page too (desktop:ask), such as 跳過 or
// 覆蓋 while importing a character pack.

let dialogQueue = Promise.resolve();

// buttons: [{ label, value, kind: 'primary' | 'danger' }]; the last one is focused unless it is a danger. With input
// ({ value, placeholder }) a text field comes first (focused; Enter answers with the last button).
// Resolves { value, checked, text }.
function askDialog({ title = '角色桌面', message, detail = '', buttons, checkbox = '', input = null }) {
  const ask = () => new Promise(resolve => {
    const backdrop = $('dialog'), row = $('dialog-buttons'), before = document.activeElement;
    $('dialog-title').textContent = title;
    $('dialog-message').textContent = message;
    $('dialog-detail').textContent = detail;
    $('dialog-check').hidden = !checkbox;
    $('dialog-check-label').textContent = checkbox;
    $('dialog-checkbox').checked = false;
    $('dialog-input').hidden = !input;
    $('dialog-input').value = input?.value || '';
    $('dialog-input').placeholder = input?.placeholder || '';
    row.replaceChildren();
    const finish = value => {
      backdrop.hidden = true;
      document.removeEventListener('keydown', onKey, true);
      before?.focus?.({ preventScroll: true });
      resolve({ value, checked: $('dialog-checkbox').checked, text: $('dialog-input').value.trim() });
    };
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(buttons[0].value); }
      else if (event.key === 'Enter' && document.activeElement === $('dialog-input')) { event.preventDefault(); finish(buttons.at(-1).value); }
      else if (event.key === 'Tab') {
        // Focus stays inside the card.
        const items = [...backdrop.querySelectorAll('button, input:not([hidden])')].filter(item => item.offsetParent);
        const index = items.indexOf(document.activeElement);
        event.preventDefault();
        items[(index + (event.shiftKey ? items.length - 1 : 1)) % items.length]?.focus();
      }
    };
    for (const { label, value, kind } of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.value = value;
      if (kind) button.className = kind;
      button.onclick = () => finish(value);
      row.appendChild(button);
    }
    backdrop.hidden = false;
    document.addEventListener('keydown', onKey, true);
    const last = row.lastElementChild;
    (input ? $('dialog-input') : last.classList.contains('danger') ? row.firstElementChild : last).focus();
  });
  return dialogQueue = dialogQueue.then(ask, ask);
}

// 取消 / an action: true when the action was chosen. A danger action is red and not focused at first.
async function confirmDialog(message, { detail = '', ok = '確定', danger = false } = {}) {
  const answer = await askDialog({ message, detail, buttons: [{ label: '取消', value: 'cancel' }, { label: ok, value: 'ok', kind: danger ? 'danger' : 'primary' }] });
  return answer.value === 'ok';
}

function setUpDialogs() {
  window.desktopAPI.onAsk(async question => {
    const answer = await askDialog(question);
    window.desktopAPI.answer(question.id, answer);
  });
}
