import './csv-toolbar-icons.css';

// Keep the action's descriptive accessible name and tooltip while making common
// table actions compact. The symbols are decorative; the text remains available
// to assistive technology and browser automation through aria-label.
const icons = {
  '表示設定': [
    ['circle', {cx: 12, cy: 12, r: 3}],
    ['path', {d: 'M19 12a7 7 0 0 0-.08-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5L9.2 6a7 7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 3h5l.3-3a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .08-1Z'}]
  ],
  '選択を非表示': [
    ['path', {d: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c5 0 8.5 4.2 9.5 7a13.8 13.8 0 0 1-3.2 4.3M6.2 6.3A13.8 13.8 0 0 0 2.5 12c1 2.8 4.5 7 9.5 7a11 11 0 0 0 4-.8'}]
  ],
  '行・列を削除': [
    ['path', {d: 'M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 10v7m4-7v7'}]
  ],
  '非表示をすべて解除': [
    ['path', {d: 'M2.5 12C3.5 9.2 7 5 12 5s8.5 4.2 9.5 7c-1 2.8-4.5 7-9.5 7S3.5 14.8 2.5 12Z'}],
    ['circle', {cx: 12, cy: 12, r: 3}]
  ],
  '表示設定を保存': [
    ['path', {d: 'M5 3h12l3 3v15H4V3h1Zm2 0v6h9V3M7 21v-8h10v8'}]
  ],
  '表示設定を読込': [
    ['path', {d: 'M3 6h7l2 2h8v11H3V6Zm0 5h18l-2 8'}]
  ]
};

export function applyCsvToolbarIcons(toolbar) {
  for (const button of toolbar.querySelectorAll('button')) {
    const label = button.textContent.trim();
    const paths = icons[label];
    if (!paths) continue;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.classList.add('csv-icon-button');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const [tag, attributes] of paths) {
      const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
      svg.append(shape);
    }
    button.replaceChildren(svg);
  }
}
