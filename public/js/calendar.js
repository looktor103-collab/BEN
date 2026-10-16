// Month calendar: net cash flow per day, tap a day to see its entries.
(() => {
  const B = window.Ben;
  const { $, S, api, el, on, ymd, thb, fmtShort, fmtTHB, thLong } = B;
  let cursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selected = null;
  let extra = []; // transactions for a month older than what the dashboard loaded

  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  async function monthData() {
    const first = ymd(cursor), last = ymd(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
    if (first >= (S.loadedFrom || '0000-00-00')) return S.ALL.filter((x) => x.date >= first && x.date <= last);
    const { transactions } = await api(`/transactions?from=${first}&to=${last}`);
    extra = transactions;
    return transactions;
  }

  async function render() {
    const list = await monthData();
    const byDay = {};
    list.forEach((x) => {
      const d = (byDay[x.date] ??= { net: 0, items: [] });
      d.net += x.type === 'income' ? thb(x) : -thb(x);
      d.items.push(x);
    });
    $('calTitle').textContent = cursor.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

    const grid = $('calGrid');
    grid.replaceChildren(...['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map((d) => el('div', { className: 'cal-dow', textContent: d })));
    const offset = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7; // Monday first
    for (let i = 0; i < offset; i++) grid.append(el('div', { className: 'cal-cell empty' }));
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const today = B.todayStr();
    for (let d = 1; d <= days; d++) {
      const key = `${monthKey(cursor)}-${String(d).padStart(2, '0')}`, info = byDay[key];
      const cell = el('button', { type: 'button', className: 'cal-cell' + (key === today ? ' today' : '') + (key === selected ? ' sel' : '') + (info ? ' has' : ''), ariaLabel: key },
        el('span', { className: 'cal-num', textContent: d }));
      if (info) cell.append(el('span', { className: 'cal-net ' + (info.net >= 0 ? 'pos' : 'neg'), textContent: (info.net >= 0 ? '+' : '−') + fmtShort(Math.round(Math.abs(info.net))) }));
      cell.onclick = () => { selected = key; render(); };
      grid.append(cell);
    }

    const box = $('calDay');
    box.replaceChildren();
    if (selected && selected.startsWith(monthKey(cursor))) {
      const info = byDay[selected];
      box.append(el('h3', { textContent: '📅 ' + thLong(new Date(selected + 'T00:00:00')) + (info ? ` · สุทธิ ${info.net >= 0 ? '+' : '−'}${fmtTHB(Math.abs(info.net))}` : '') }));
      if (!info) box.append(el('div', { className: 'hint', textContent: 'ไม่มีรายการในวันนี้' }));
      else info.items.forEach((x) => box.append(B.txRow(x)));
      const add = el('button', { type: 'button', className: 'btn-sm soft', textContent: '＋ เพิ่มรายการวันนี้' });
      add.onclick = () => { B.openEntry(null); $('txDate').value = selected; };
      box.append(add);
    }
  }

  $('calPrev').onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); selected = null; render(); };
  $('calNext').onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); selected = null; render(); };
  on('render', render);
})();
