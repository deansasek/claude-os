// The app header: the icon and name at the top left of every app, drawn by the shell so it sits
// in exactly the same place on every page. An app's view.html starts with
//
//   <header class="app-hd">
//     <div class="app-hd-after">…</div>    optional: right after the name (Weather's city, Clock's tabs)
//     <div class="app-hd-right">…</div>    optional: against the right edge (status pills, date and time)
//   </header>
//
// and the shell puts the icon (HubApp.icon) and the name (HubApp.title, else HubApp.name) in front.
// Apps never write their own icon or wordmark: they reach the shell's through ctx.header, e.g.
// Weather and Clock redraw ctx.header.icon as the sky or the time changes, and the Claude app makes
// ctx.header.brand a light/dark switch. A view without a header gets an empty one.
//
// The metrics (top, left inset, height, icon box, gap, wordmark) live in public/core.css under
// "app header", along with --app-body, the y where every app's content starts.
import { esc } from './dom.ts';

export interface AppHeader {
  el: HTMLElement;      // <header class="app-hd">
  brand: HTMLElement;   // .app-hd-brand: the icon and the name together
  icon: HTMLElement;    // .app-hd-icon: a 26×26 box; the SVG inside fills it
  title: HTMLElement;   // .app-hd-title: the wordmark
}

export function renderAppHeader(root: HTMLElement, app: { name: string; title?: string; icon: string }): AppHeader {
  let el = root.querySelector<HTMLElement>(':scope > header.app-hd');
  if (!el) {
    el = document.createElement('header');
    el.className = 'app-hd';
    root.prepend(el);
  }
  const brand = document.createElement('div');
  brand.className = 'app-hd-brand';
  brand.innerHTML = `<span class="app-hd-icon">${app.icon}</span><span class="app-hd-title">${esc(app.title ?? app.name)}</span>`;
  el.prepend(brand);
  return { el, brand, icon: brand.querySelector<HTMLElement>('.app-hd-icon')!, title: brand.querySelector<HTMLElement>('.app-hd-title')! };
}
