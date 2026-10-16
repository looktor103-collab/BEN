// Wallets / bank accounts / credit cards, each with its own currency.
(() => {
  const B = window.Ben;
  const { $, show, S, api, el, on, emit, fmtMoney, fmtTHB, setMsg } = B;
  const ICON = { cash: '💵', bank: '🏦', credit: '💳', ewallet: '📱', other: '👛' };
  const PRESETS = [
    ['💵 เงินสด', 'เงินสด', 'cash', 'THB'], ['💳 บัตรเครดิต', 'บัตรเครดิต', 'credit', 'THB'],
    ['🏦 ธนาคาร A', 'ธนาคาร A', 'bank', 'THB'], ['🏦 ธนาคาร B', 'ธนาคาร B', 'bank', 'THB'],
    ['📱 พร้อมเพย์/อีวอลเล็ต', 'อีวอลเล็ต', 'ewallet', 'THB'], ['🌏 บัญชี USD', 'บัญชี USD', 'bank', 'USD'],
  ];
  let editingId = null;

  // ---------- dashboard card ----------
  function renderCard() {
    const root = $('acctSummary');
    root.replaceChildren();
    if (!S.ACCOUNTS.length) {
      root.append(el('div', { className: 'empty-state', textContent: '💳 ยังไม่มีบัญชี กด “จัดการบัญชี” เพื่อเพิ่ม เงินสด / ธนาคาร / บัตรเครดิต' }));
      $('acctTotal').textContent = '';
      return;
    }
    let total = 0;
    S.ACCOUNTS.forEach((a) => {
      total += a.balance * a.rate_to_thb;
      const amt = el('div', { className: 'amt ' + (a.balance < 0 ? 'neg' : 'pos'), textContent: fmtMoney(a.balance, a.currency) });
      if (a.currency !== 'THB') amt.append(el('small', { textContent: '≈ ' + fmtTHB(a.balance * a.rate_to_thb) }));
      root.append(el('div', { className: 'acct-row' }, el('div', { className: 'bubble', textContent: ICON[a.type] || '👛' }),
        el('div', { className: 'info' }, el('div', { className: 'title', textContent: a.name }), el('div', { className: 'meta', textContent: a.currency })), amt));
    });
    $('acctTotal').textContent = `รวมทุกบัญชี ≈ ${total < 0 ? '−' : ''}${fmtTHB(Math.abs(total))}`;
  }
  on('render', renderCard);

  // ---------- manager dialog ----------
  const dlg = $('accountsDialog');
  function syncRateField() {
    const cur = $('acctCurrency').value.trim().toUpperCase();
    show($('acctRateWrap'), cur !== 'THB' && cur.length === 3);
    $('acctRateLabel').textContent = `1 ${cur} = กี่บาท`;
  }
  function resetForm() {
    editingId = null;
    $('acctForm').reset();
    $('acctCurrency').value = 'THB';
    $('acctRate').value = '';
    $('acctSave').textContent = '＋ เพิ่มบัญชี';
    show($('acctCancelEdit'), false);
    setMsg('acctErr', '');
    syncRateField();
  }
  function fillForm(a) {
    editingId = a.id;
    $('acctName').value = a.name; $('acctType').value = a.type; $('acctCurrency').value = a.currency;
    $('acctRate').value = a.currency === 'THB' ? '' : a.rate_to_thb;
    $('acctSave').textContent = 'บันทึกการแก้ไข';
    show($('acctCancelEdit'), true);
    syncRateField();
    $('acctName').focus();
  }

  function renderManager() {
    const root = $('acctList');
    root.replaceChildren();
    if (!S.ACCOUNTS.length) root.append(el('div', { className: 'hint', textContent: 'ยังไม่มีบัญชี เลือกแบบสำเร็จรูปด้านล่างหรือกรอกเอง' }));
    S.ACCOUNTS.forEach((a) => {
      const edit = el('button', { className: 'row-btn', textContent: '✏️', title: 'แก้ไข', type: 'button' });
      edit.onclick = () => fillForm(a);
      const del = el('button', { className: 'row-btn', textContent: '🗑️', title: 'ลบ', type: 'button' });
      del.onclick = async () => {
        if (!confirm(`ลบบัญชี "${a.name}"?\nรายการเดิมยังอยู่ แต่จะกลายเป็น “ไม่ระบุบัญชี”`)) return;
        try { await api('/accounts/' + a.id, { method: 'DELETE' }); if (editingId === a.id) resetForm(); emit('reload'); } catch (e) { setMsg('acctErr', e.message); }
      };
      root.append(el('div', { className: 'acct-row' }, el('div', { className: 'bubble', textContent: ICON[a.type] || '👛' }),
        el('div', { className: 'info' }, el('div', { className: 'title', textContent: a.name }),
          el('div', { className: 'meta', textContent: `${a.currency}${a.currency !== 'THB' ? ` · 1 ${a.currency} = ฿${a.rate_to_thb}` : ''} · คงเหลือ ${fmtMoney(a.balance, a.currency)}` })),
        el('div', { className: 'acts' }, edit, del)));
    });
  }
  on('render', () => { if (dlg.open) renderManager(); });

  $('acctPresets').replaceChildren(...PRESETS.map(([label, name, type, cur]) => {
    const b = el('button', { className: 'chip', type: 'button', textContent: label });
    b.onclick = () => { resetForm(); $('acctName').value = name; $('acctType').value = type; $('acctCurrency').value = cur; syncRateField(); $('acctName').focus(); };
    return b;
  }));

  const open = () => { B.setMenu(false); resetForm(); renderManager(); dlg.showModal(); };
  $('acctManageBtn').onclick = open;
  $('accountsBtn').onclick = open;
  $('acctClose').onclick = () => dlg.close();
  $('acctCancelEdit').onclick = resetForm;
  $('acctCurrency').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); syncRateField(); });

  $('acctForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = $('acctCurrency').value.trim().toUpperCase();
    const body = { name: $('acctName').value, type: $('acctType').value, currency: cur, rate_to_thb: cur === 'THB' ? 1 : $('acctRate').value };
    if (cur !== 'THB' && !(Number($('acctRate').value) > 0)) return setMsg('acctErr', 'ใส่อัตราแลกเปลี่ยนเป็นบาท เช่น 35');
    try {
      await (editingId ? api('/accounts/' + editingId, { method: 'PUT', body }) : api('/accounts', { method: 'POST', body }));
      resetForm();
      B.toast('บันทึกบัญชีแล้ว 💳');
      emit('reload');
    } catch (err) { setMsg('acctErr', err.message); }
  });
})();
