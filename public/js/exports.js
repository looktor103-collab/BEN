// CSV, Excel (.xlsx) and PDF (print-to-PDF) exports of whatever the period picker currently shows.
(() => {
  const B = window.Ben;
  const { $, S, el, ymd, thDate, thLong, fmtTHB, fmtMoney, emojiFor, isSaving, thb, currencyOf, acctById, money } = B;

  const typeLabel = (x) => (x.type === 'income' ? 'รายรับ' : isSaving(x) ? 'ออมเงิน' : 'รายจ่าย');
  const acctName = (x) => (acctById(x.account_id) || {}).name || '';
  const stamp = () => ymd(new Date());

  function download(blob, name) {
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- CSV ----------
  $('exportBtn').onclick = () => {
    B.setMenu(false);
    const esc = (s) => {
      s = String(s);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [['วันที่', 'ประเภท', 'หมวดหมู่', 'โน้ต', 'บัญชี', 'สกุลเงิน', 'จำนวน', 'จำนวน (บาท)'],
      ...S.TX.map((x) => [x.date, typeLabel(x), x.category, x.note, acctName(x), currencyOf(x), x.amount, Math.round(thb(x) * 100) / 100])];
    download(new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), `ben-${stamp()}.csv`);
  };

  // ---------- Excel ----------
  let xlsxLoading;
  const loadXlsx = () => (window.XLSX ? Promise.resolve() : (xlsxLoading ||= new Promise((res, rej) => {
    const s = el('script', { src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js' });
    s.onload = res; s.onerror = () => { xlsxLoading = null; rej(new Error('โหลดตัวสร้าง Excel ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต')); };
    document.head.append(s);
  })));

  $('xlsxBtn').onclick = async () => {
    B.setMenu(false);
    try {
      B.toast('📊 กำลังสร้างไฟล์ Excel…');
      await loadXlsx();
      const { utils } = window.XLSX;
      const sheet = (rows, widths) => { const ws = utils.aoa_to_sheet(rows); ws['!cols'] = widths.map((w) => ({ wch: w })); return ws; };
      const t = B.totals(S.TX);
      const byCat = {};
      S.TX.forEach((x) => { if (x.type === 'income') return; const k = x.category; (byCat[k] ??= { type: isSaving(x) ? 'ออมเงิน' : 'รายจ่าย', total: 0, n: 0 }); byCat[k].total += thb(x); byCat[k].n++; });
      const wb = utils.book_new();
      utils.book_append_sheet(wb, sheet([['วันที่', 'ประเภท', 'หมวดหมู่', 'โน้ต', 'บัญชี', 'สกุลเงิน', 'จำนวน', 'จำนวน (บาท)'],
        ...S.TX.map((x) => [x.date, typeLabel(x), x.category, x.note, acctName(x), currencyOf(x), x.amount, Math.round(thb(x) * 100) / 100])], [12, 10, 18, 28, 16, 9, 12, 14]), 'รายการ');
      utils.book_append_sheet(wb, sheet([['สรุป (บาท)', ''], ['รายรับ', t.inc], ['รายจ่าย (ไม่รวมออม)', t.exp], ['ออมไว้', t.saved], ['คงเหลือสุทธิ', t.net], [],
        ['หมวดหมู่', 'ประเภท', 'รายการ', 'รวม (บาท)'],
        ...Object.entries(byCat).sort((a, b) => b[1].total - a[1].total).map(([c, v]) => [c, v.type, v.n, Math.round(v.total * 100) / 100])], [26, 12, 10, 16]), 'สรุป');
      utils.book_append_sheet(wb, sheet([['บัญชี', 'ประเภท', 'สกุลเงิน', 'คงเหลือ', 'อัตรา→บาท', 'คงเหลือ (บาท)'],
        ...S.ACCOUNTS.map((a) => [a.name, a.type, a.currency, a.balance, a.rate_to_thb, Math.round(a.balance * a.rate_to_thb * 100) / 100])], [20, 10, 10, 14, 12, 16]), 'บัญชี');
      window.XLSX.writeFile(wb, `ben-${stamp()}.xlsx`);
    } catch (err) { alert(err.message); }
  };

  // ---------- PDF ----------
  function buildReport() {
    const root = $('report');
    const { from } = B.range();
    const label = $('period').selectedOptions[0].textContent.replace(/^\S+\s/, '');
    const list = [...S.TX];
    const { inc, exp, saved, net } = B.totals(list);
    const sum = (l, v, cls) => el('div', {}, el('small', { textContent: l }), el('b', { textContent: v, className: cls || '' }));

    const byCat = {}, bySave = {};
    list.filter((x) => x.type === 'expense').forEach((x) => { const m = isSaving(x) ? bySave : byCat; m[x.category] = (m[x.category] || 0) + thb(x); });
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const saves = Object.entries(bySave).sort((a, b) => b[1] - a[1]);
    const catTbl = (entries, total) => el('table', {}, el('thead', {}, el('tr', {}, el('th', { textContent: 'หมวดหมู่' }), el('th', { className: 'num', textContent: 'จำนวน' }), el('th', { className: 'num', textContent: 'สัดส่วน' }))),
      el('tbody', {}, ...entries.map(([c, v]) => el('tr', {}, el('td', { textContent: emojiFor(c, 'expense') + ' ' + c }), el('td', { className: 'num', textContent: fmtTHB(v) }), el('td', { className: 'num', textContent: total ? ((v / total) * 100).toFixed(1) + '%' : '–' })))));
    const txTable = el('table', {}, el('thead', {}, el('tr', {}, ...['วันที่', 'หมวดหมู่', 'โน้ต', 'บัญชี'].map((t) => el('th', { textContent: t })), el('th', { className: 'num', textContent: 'จำนวน' }))),
      el('tbody', {}, ...list.map((x) => el('tr', {}, el('td', { textContent: thDate(x.date) }), el('td', { textContent: x.category }), el('td', { textContent: x.note }), el('td', { textContent: acctName(x) }),
        el('td', { className: 'num ' + (x.type === 'income' ? 'in' : 'out'), textContent: (x.type === 'income' ? '+' : '−') + money(x) })))));
    const foreign = list.some((x) => currencyOf(x) !== 'THB');

    root.replaceChildren(
      el('h1', { textContent: '🪙 Ben · รายงานการเงิน' }),
      el('div', { className: 'r-sub', textContent: `${label}${from ? ' (ตั้งแต่ ' + thLong(new Date(from + 'T00:00:00')) + ')' : ''} · สร้างเมื่อ ${thLong(new Date())} · ${$('userName').textContent}` }),
      el('div', { className: 'r-sum' }, sum('รายรับ', fmtTHB(inc), 'in'), sum('รายจ่าย', fmtTHB(exp), 'out'),
        sum('ออมไว้แล้ว', fmtTHB(saved) + (inc ? ` (${(((inc - exp) / inc) * 100).toFixed(1)}%)` : '')),
        sum('คงเหลือสุทธิ', (net >= 0 ? '+' : '−') + fmtTHB(Math.abs(net)), net >= 0 ? 'in' : 'out')),
      ...(cats.length ? [el('h2', { textContent: 'รายจ่ายตามหมวดหมู่' }), catTbl(cats, exp)] : []),
      ...(saves.length ? [el('h2', { textContent: '🐷 ออมเงินตามหมวดหมู่' }), catTbl(saves, saved)] : []),
      el('h2', { textContent: `รายการทั้งหมด (${list.length.toLocaleString('th-TH')} รายการ)` }),
      list.length ? txTable : el('div', { className: 'r-sub', textContent: 'ไม่มีรายการในช่วงนี้' }),
      ...(foreign ? [el('div', { className: 'r-sub', textContent: 'หมายเหตุ: ยอดรวมแปลงเป็นบาทตามอัตราแลกเปลี่ยนที่ตั้งไว้ในแต่ละบัญชี' })] : []),
      el('div', { className: 'r-foot', textContent: 'สร้างจากแอป Ben' }));
  }

  $('pdfBtn').onclick = () => {
    B.setMenu(false);
    buildReport();
    const oldTitle = document.title;
    document.title = 'Ben-รายงาน-' + stamp(); // becomes the default PDF file name
    window.addEventListener('afterprint', () => { document.title = oldTitle; $('report').replaceChildren(); }, { once: true });
    setTimeout(() => window.print(), 150);
  };
})();
