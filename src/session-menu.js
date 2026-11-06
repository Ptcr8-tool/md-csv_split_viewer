// The standard title-bar close uses the saved preference.  These commands
// choose a policy for this close only and should not leave a menu open after a
// save prompt is cancelled.
export function installSessionMenu(root = document) {
  const menu = root.querySelector('.session-menu');
  if (!menu) return;
  const summary = menu.querySelector('summary');
  const exit = menu.querySelector('.session-menu-exit');
  const close = () => { if (exit) exit.open = false; menu.open = false; };
  menu.addEventListener('click', event => {
    if (event.target.closest('[data-cmd],[data-file-action]')) close();
  });
  const position = () => menu.style.setProperty('--session-menu-top', `${Math.round(summary.getBoundingClientRect().bottom + 4)}px`);
  menu.addEventListener('toggle', () => { if (menu.open) position(); else if (exit) exit.open = false; });
  root.defaultView?.addEventListener('resize', () => { if (menu.open) position(); });
  root.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) close();
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      if (exit?.open) { exit.open = false; exit.querySelector('summary')?.focus(); }
      else { close(); summary.focus(); }
      event.preventDefault();
      event.stopPropagation();
    }
  });
}
