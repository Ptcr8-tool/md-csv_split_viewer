import './toolbar-folding.css';
import {installSessionMenu} from './session-menu.js';

// Each collapsed section leaves a zero-height anchor at its original position.
// Its compact handle opens that section directly, without adding another row.
export function installToolbarFolding(root = document) {
  const topbar = root.querySelector('.topbar');
  const brand = topbar?.querySelector('.brand');
  const tabbar = root.querySelector('.tabbar');
  const formatbar = root.querySelector('.formatbar');
  const app = root.querySelector('#app');
  if (!topbar || !brand || !tabbar || !formatbar || !app) return;

  const actions = root.createElement('div');
  actions.className = 'topbar-action-group';
  actions.id = 'foldable-actions';
  for (const node of [...topbar.children]) if (node !== brand) actions.append(node);
  topbar.append(actions);
  installSessionMenu(root);

  const tabRow = root.createElement('div');
  tabRow.className = 'tabbar-row';
  tabbar.before(tabRow);
  tabRow.append(tabbar);
  tabbar.id = 'foldable-tabs';
  formatbar.id = 'foldable-format';

  const entries = [
    {key:'actions', label:'操作', short:'操', target:actions, section:actions, container:topbar, after:topbar},
    {key:'tabs', label:'タブ', short:'タ', target:tabbar, section:tabRow, container:tabRow, after:tabRow},
    {key:'format', label:'書式', short:'書', target:formatbar, section:formatbar, container:formatbar, after:formatbar},
  ];
  const anchors = [];
  let queued = false;

  // Several folded sections can share the same boundary. Arrange their
  // handles side by side and reserve room in the next visible header so no
  // existing button or scrollbar is covered.
  function layoutHandles() {
    queued = false;
    for (const node of app.querySelectorAll('[data-fold-reserved]')) {
      node.removeAttribute('data-fold-reserved');
      node.style.removeProperty('--fold-reserve');
    }
    const groups = new Map();
    for (const anchor of anchors) {
      if (!anchor.getClientRects().length) continue;
      const y = Math.round(anchor.getBoundingClientRect().top);
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push(anchor);
    }
    for (const group of groups.values()) {
      group.forEach((anchor, index) => anchor.style.setProperty('--fold-offset', (index * 32) + 'px'));
      let next = group[group.length - 1].nextElementSibling;
      while (next && (next.classList.contains('fold-edge') || getComputedStyle(next).display === 'none')) next = next.nextElementSibling;
      if (next && !next.classList.contains('statusbar')) {
        next.setAttribute('data-fold-reserved', '');
        next.style.setProperty('--fold-reserve', (group.length * 32) + 'px');
      }
    }
  }
  function scheduleLayout() {
    if (!queued) { queued = true; requestAnimationFrame(layoutHandles); }
  }

  for (const {key,label,short,target,section,container,after} of entries) {
    const anchor = root.createElement('div');
    anchor.className = 'fold-edge';
    anchor.dataset.foldAnchor = key;
    anchor.hidden = true;
    after.after(anchor);
    anchors.push(anchor);
    const button = root.createElement('button');
    button.type = 'button';
    button.className = 'section-fold-toggle';
    button.dataset.foldToggle = key;
    button.setAttribute('aria-controls', target.id);
    let expanded = true;
    function apply() {
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', `${label}を${expanded ? '折りたたむ' : '展開'}`);
      button.title = expanded ? `${label}を折りたたむ（元の場所にある引き出しから再表示）` : `${label}を展開`;
      if (expanded) {
        button.textContent = `${label} ▴`;
        container.append(button);
      } else {
        button.replaceChildren();
        const symbol = root.createElement('span');
        symbol.setAttribute('aria-hidden', 'true');
        symbol.textContent = '☷›';
        const caption = root.createElement('span');
        caption.className = 'fold-edge-caption';
        caption.setAttribute('aria-hidden', 'true');
        caption.textContent = short;
        button.append(symbol, caption);
        anchor.append(button);
      }
      section.hidden = !expanded;
      anchor.hidden = expanded;
      scheduleLayout();
    }
    button.addEventListener('click', () => { expanded = !expanded; apply(); button.focus({preventScroll:true}); });
    apply();
  }

  // Visibility changes when document kind, pane, search or notice changes.
  const observer = new MutationObserver(scheduleLayout);
  observer.observe(app, {subtree:true, attributes:true, attributeFilter:['hidden','data-document-kind','data-view']});
  if (typeof ResizeObserver !== 'undefined') {
    const resize = new ResizeObserver(scheduleLayout);
    for (const node of [app,topbar,tabRow,formatbar]) resize.observe(node);
  }
  root.defaultView?.addEventListener('resize', scheduleLayout);
  scheduleLayout();
}
