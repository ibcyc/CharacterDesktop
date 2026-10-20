// 來源 (in the app menu, bottom right; the popup opens to its left): where the characters come from. Local characters are the user's own pictures; each extension
// names its website and the rights holder of its material.

function renderSources(sources) {
  const panel = $('sources-panel');
  // items: [name, detail, credits]; credits ([{ name, detail }]) are listed under their item.
  const list = items => {
    const element = document.createElement('ul');
    for (const [name, detail, credits = []] of items) {
      const item = document.createElement('li');
      const bold = document.createElement('b');
      bold.textContent = name;
      item.append(bold, detail);
      if (credits.length) item.appendChild(list(credits.map(credit => [credit.name, '：' + credit.detail])));
      element.appendChild(item);
    }
    return element;
  };
  const section = (title, items) => {
    const heading = document.createElement('h3');
    heading.textContent = title;
    panel.append(heading, list(items));
  };
  panel.replaceChildren();
  section('Local', [['使用者的圖片', '：Data\\Local']]);
  section('Extension', sources.length
    ? sources.map(source => [source.name, '：' + source.site + (source.author ? '，著作者 ' + source.author : ''), source.credits])
    : [['沒有安裝擴充功能', '']]);
}

function setSourcesOpen(open) {
  $('sources-panel').hidden = !open;
  $('sources-toggle').setAttribute('aria-expanded', String(open));
}

function setUpSourcesPanel(state) {
  renderSources(state.sources || []);
  $('sources-toggle').onclick = () => setSourcesOpen($('sources-panel').hidden);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') setSourcesOpen(false); });
}
