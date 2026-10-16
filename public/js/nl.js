// "Type or speak it" entry: free text -> AI splits it into transactions -> review -> save all at once.
(() => {
  const B = window.Ben;
  const { $, show, S, api, el, emit, setMsg, fmtMoney } = B;
  const dlg = $('nlDialog');
  let ITEMS = [];

  // ---------- speech to text (Thai) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function attachMic(btn, onText, onEnd) {
    if (!SR) { btn.hidden = true; return; }
    let rec = null;
    btn.onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = 'th-TH'; rec.interimResults = true; rec.continuous = false;
      let said = '';
      rec.onresult = (e) => { said = [...e.results].map((r) => r[0].transcript).join(' '); onText(said); };
      rec.onerror = (e) => B.toast(e.error === 'not-allowed' ? '🎤 ยังไม่ได้อนุญาตให้ใช้ไมโครโฟน' : '🎤 ฟังเสียงไม่สำเร็จ ลองใหม่อีกครั้ง');
      rec.onend = () => { rec = null; btn.classList.remove('rec'); if (onEnd) onEnd(said.trim()); };
      btn.classList.add('rec');
      try { rec.start(); } catch { rec = null; btn.classList.remove('rec'); }
    };
  }

  // ---------- review list ----------
  const acctOptions = (selected) => [el('option', { value: '', textContent: 'ไม่ระบุบัญชี' }),
    ...S.ACCOUNTS.map((a) => el('option', { value: String(a.id), textContent: `${a.name} (${a.currency})`, selected: a.id === selected }))];

  function renderItems() {
    const root = $('nlItems');
    root.replaceChildren();
    show($('nlSaveAll'), ITEMS.length > 0);
    ITEMS.forEach((it, i) => {
      const bind = (node, key, conv = (v) => v) => { node.addEventListener('input', () => { it[key] = conv(node.value); updateTotal(); }); return node; };
      const type = el('select', {}, el('option', { value: 'expense', textContent: '💸 จ่าย', selected: it.type === 'expense' }), el('option', { value: 'income', textContent: '🤑 รับ', selected: it.type === 'income' }));
      const amount = el('input', { type: 'number', min: '0.01', step: '0.01', value: it.amount, inputMode: 'decimal', ariaLabel: 'จำนวนเงิน' });
      const cat = el('input', { value: it.category, maxLength: 60, ariaLabel: 'หมวดหมู่' });
      cat.setAttribute('list', 'catList');
      const note = el('input', { value: it.note, maxLength: 80, ariaLabel: 'โน้ต' });
      const date = el('input', { type: 'date', value: it.date, ariaLabel: 'วันที่' });
      const acct = el('select', {}, ...acctOptions(it.account_id));
      const rm = el('button', { type: 'button', className: 'row-btn', textContent: '✕', title: 'เอารายการนี้ออก' });
      rm.onclick = () => { ITEMS.splice(i, 1); renderItems(); updateTotal(); };
      bind(type, 'type'); bind(amount, 'amount', Number); bind(cat, 'category'); bind(note, 'note'); bind(date, 'date');
      bind(acct, 'account_id', (v) => (v ? Number(v) : null));
      root.append(el('div', { className: 'nl-item' },
        el('div', { className: 'nl-row1' }, type, amount, rm),
        el('div', { className: 'nl-row2' }, cat, note),
        el('div', { className: 'nl-row3' }, date, acct),
        ...(it.learned ? [el('div', { className: 'hint', textContent: `🧠 จัดหมวดจากประวัติของคุณ (${it.learned} ครั้ง)` })] : [])));
    });
    updateTotal();
  }
  function updateTotal() {
    const spend = ITEMS.filter((x) => x.type === 'expense').reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const inc = ITEMS.filter((x) => x.type === 'income').reduce((s, x) => s + (Number(x.amount) || 0), 0);
    $('nlTotal').textContent = ITEMS.length ? `${ITEMS.length} รายการ · จ่าย ${fmtMoney(spend)}${inc ? ` · รับ ${fmtMoney(inc)}` : ''}` : '';
  }

  // ---------- parse + save ----------
  async function parse() {
    const text = $('nlText').value.trim();
    if (text.length < 2) return setMsg('nlErr', 'พิมพ์หรือพูดรายการก่อน เช่น “กินข้าวแกง 50 บาท”');
    setMsg('nlErr', '');
    $('nlParse').disabled = true;
    $('nlStatus').textContent = '✨ AI กำลังแยกรายการ…';
    show($('nlStatus'), true);
    try {
      const { items } = await api('/nl/parse', { method: 'POST', body: { text, today: B.todayStr() } });
      ITEMS = items;
      renderItems();
      $('nlStatus').textContent = '✅ ตรวจและแก้ไขได้ก่อนกดบันทึก';
    } catch (err) {
      ITEMS = []; renderItems();
      show($('nlStatus'), false);
      setMsg('nlErr', err.message);
    } finally {
      $('nlParse').disabled = false;
    }
  }

  $('nlParse').onclick = parse;
  $('nlCancel').onclick = () => dlg.close();
  $('nlSaveAll').onclick = async () => {
    const items = ITEMS.map(({ type, amount, category, note, date, account_id }) => ({ type, amount, category, note, date, account_id }));
    $('nlSaveAll').disabled = true;
    try {
      const { count } = await api('/transactions/batch', { method: 'POST', body: { items } });
      dlg.close();
      $('nlInput').value = '';
      B.toast(`บันทึก ${count} รายการแล้ว ✨`);
      emit('reload');
    } catch (err) { setMsg('nlErr', err.message); }
    finally { $('nlSaveAll').disabled = false; }
  };

  function openWith(text, autoParse) {
    B.setMenu(false);
    ITEMS = []; renderItems();
    $('nlText').value = text || '';
    setMsg('nlErr', ''); show($('nlStatus'), false);
    if (!dlg.open) dlg.showModal();
    if (autoParse && text) parse();
  }

  // quick bar on the dashboard
  $('nlBar').addEventListener('submit', (e) => { e.preventDefault(); openWith($('nlInput').value.trim(), true); });
  attachMic($('nlMic'), (t) => ($('nlInput').value = t), (said) => { if (said) openWith(said, true); });
  attachMic($('nlMic2'), (t) => ($('nlText').value = t), (said) => { if (said) parse(); });
  $('nlOpenBtn').onclick = () => openWith('', false);
})();
