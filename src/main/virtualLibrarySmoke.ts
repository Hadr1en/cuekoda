import { app, type BrowserWindow } from 'electron';

const CHECK = `(async () => {
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const waitFor = async (condition, message) => {
    const deadline = performance.now() + 10000;
    while (!condition()) {
      if (performance.now() > deadline) throw new Error(message);
      await frame();
    }
  };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const table = document.getElementById('tracks');
  const viewport = document.getElementById('list-wrap');
  const rows = () => [...table.querySelectorAll('tbody tr[data-track]')];
  const index = (row) => Number(row?.getAttribute('aria-rowindex'));
  const key = (el, key, options = {}) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
  };
  await waitFor(() => table.classList.contains('virtual-library') && rows().length > 1, 'Virtualized table did not open');
  const count = Number(table.getAttribute('aria-rowcount')) - 1;
  viewport.scrollTop = 0;
  await frame();
  const first = rows()[0];
  const widths = [...table.tHead.rows[0].cells].map(cell => cell.getBoundingClientRect().width);
  const mountedAtTop = rows().length;
  assert(count >= 1000 && mountedAtTop < 100 && index(first) === 2, 'Unexpected row count');
  first.focus();
  viewport.scrollTop = viewport.scrollHeight;
  await frame();
  assert(document.activeElement === first, 'Scrolling removed the focused row');
  const last = rows().at(-1);
  assert(index(last) === count + 1 && rows().length < 100, 'Last row is unreachable');
  assert([...table.tHead.rows[0].cells].every((cell, i) => Math.abs(cell.getBoundingClientRect().width - widths[i]) < 1), 'Columns shifted while scrolling');
  first.querySelector('input').focus({ preventScroll: true });
  key(document.activeElement, 'Tab');
  await frame();
  assert(index(document.activeElement) === 3, 'Tab skipped rows outside the viewport');
  document.activeElement.focus();
  viewport.scrollTop = viewport.scrollHeight;
  await frame();
  key(document.activeElement, 'Tab', { shiftKey: true });
  await frame();
  assert(index(document.activeElement.closest('tr')) === 2 && document.activeElement.matches('input[type=checkbox]'), 'Shift+Tab skipped the previous checkbox');
  first.click();
  viewport.scrollTop = viewport.scrollHeight;
  await frame();
  const lastAtBottom = rows().at(-1);
  lastAtBottom.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  assert(document.getElementById('selection-count').textContent.startsWith(String(count) + ' '), 'Range did not include unmounted rows');
  lastAtBottom.click();
  lastAtBottom.focus();
  key(lastAtBottom, 'ArrowUp', { shiftKey: true });
  await frame();
  assert(index(document.activeElement) === count && table.querySelectorAll('tr.marked').length === 2, 'Range selection failed');
  const search = document.querySelector('.lib-tools input[type=search]');
  search.value = 'Library fixture 0001';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !table.classList.contains('virtual-library') && rows().length < 20, 'Filtering did not restore the short table');
  search.value = '';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => table.classList.contains('virtual-library'), 'Clearing search did not restore virtualization');
  const title = table.querySelector('th[data-sort=title]');
  title.click();
  title.click();
  await frame();
  viewport.scrollTop = 0;
  await frame();
  assert(rows()[0]?.textContent.includes('Library fixture ' + String(count - 1).padStart(4, '0')), 'Descending sort failed across unmounted rows');
  const settings = document.getElementById('btn-settings');
  settings.click();
  document.getElementById('virtual-library').click();
  await waitFor(() => !table.classList.contains('virtual-library') && rows().length === count, 'Fallback did not restore the full table');
  settings.ownerDocument.getElementById('dlg-settings').close();
  return { count, mountedAtTop };
})()`;

const ZOOM = `(async () => {
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const table = document.getElementById('tracks');
  const viewport = document.getElementById('list-wrap');
  await frame();
  viewport.scrollTop = viewport.scrollHeight;
  await frame();
  const last = table.querySelector('tbody tr[aria-rowindex="' + table.getAttribute('aria-rowcount') + '"]');
  if (!last || last.getBoundingClientRect().bottom > viewport.getBoundingClientRect().bottom + 2) {
    throw new Error('Last row is clipped after zoom');
  }
  return true;
})()`;

export async function smokeVirtualLibrary(window: BrowserWindow) {
  const contents = window.webContents;
  if (process.env.CUEKODA_SMOKE_LIBRARY_MEASURE === '1') {
    const mounted: number = await contents.executeJavaScript(`(async () => {
      const deadline = performance.now() + 20000;
      while (!document.querySelector('#rows tr[data-track]')) {
        if (performance.now() > deadline) throw new Error('Library did not render');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      await new Promise(resolve => requestAnimationFrame(resolve));
      return document.querySelectorAll('#rows tr[data-track]').length;
    })()`);
    const readyMs = process.uptime() * 1000;
    const workingSets: number[] = [];
    for (let sample = 0; sample < 5; sample++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const memory = app.getAppMetrics().map(({ memory }) => memory?.workingSetSize);
      if (memory.length && memory.every(Number.isFinite)) {
        workingSets.push(memory.reduce((sum, value) => sum + value, 0));
      }
    }
    console.log('[library measure]', JSON.stringify({ mounted, readyMs, workingSets }));
    return;
  }
  for (const zoom of [1, 1.25, 1.5]) {
    contents.setZoomFactor(zoom);
    // Use a separate renderer instance for each run to verify persisted settings.
    const result = await contents.executeJavaScript(CHECK);
    const saved = await contents.executeJavaScript('window.cuekoda.init().then(value => value.settings.virtualizeLibrary)');
    if (saved !== false) throw new Error('The table preference was not persisted');
    await contents.executeJavaScript('window.cuekoda.setSettings({virtualizeLibrary:true})');
    const reloaded = new Promise<void>((resolve) => contents.once('did-finish-load', () => resolve()));
    contents.reload();
    await reloaded;
    await contents.executeJavaScript(`(async () => {
      const element = document.getElementById('tracks');
      const deadline = performance.now() + 10000;
      while (!element.classList.contains('virtual-library')) {
        if (performance.now() > deadline) throw new Error('Virtualized table did not reopen');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    })()`);
    await contents.executeJavaScript(ZOOM);
    console.log('[library smoke]', JSON.stringify({ zoom, ...result }));
  }
}
