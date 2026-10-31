// The standard title-bar close uses the saved preference.  These commands
// choose a policy for this close only and should not leave a menu open after a
// save prompt is cancelled.
export function installSessionMenu(root = document) {
  const menu = root.querySelector('.session-menu');
  if (!menu) return;
  const summary = menu.querySelector('summary');
  menu.addEventListener('click', event => {
    if (event.target.closest('[data-cmd],[data-file-action]')) menu.open = false;
  });
  root.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      summary.focus();
      event.preventDefault();
      event.stopPropagation();
    }
  });
}
