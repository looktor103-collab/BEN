// Add / edit one transaction: category chips, account + currency, photo attachment, slip scanning, learned categories.
(() => {
  const B = window.Ben;
  const { $, show, S, api, el, on, emit, ymd, emojiFor, acctById, fmtMoney, fmtTHB, SAVING_CATS, SPEND_CHIPS, INCOME_CHIPS } = B;
  const dlg = $('txDialog');
  let editingId = null;

  // ---------- images ----------
  const MAX_SIDE = 1400;
  async function shrink(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    return new Promise((res, rej) => cv.toBlob((bl) => (bl ? res(bl) : rej(new Error('ย่อรูปไม่สำเร็จ'))), 'image/jpeg', 0.85));
  }

  // image state of the open dialog: key currently attached, and keys uploaded during this session (deleted if never saved)
  let imageKey = null, sessionKeys = new Set();
  function setImage(key) {
    imageKey = key;
    show($('preview'), !!key);
    if (key) $('previewImg').src = '/api/uploads/' + key;
  }
  const dropUnsaved = (keep) => {
    sessionKeys.forEach((k) => { if (k !== keep) api('/uploads/' + k, { method: 'DELETE' }).catch(() => {}); });
    sessionKeys = new Set();
  };
  async function attach(blob) {
    const { key } = await B.postFile('/uploads', blob);
    sessionKeys.add(key);
    setImage(key);
  }
  const scanMsg = (t, err) => { const e = $('scanStatus'); e.textContent = t || ''; e.style.color = err ? 'var(--expense)' : ''; show(e, !!t); };

  // ---------- smart category (learned from the user's own history) ----------
  let catTouched = false, hintTimer = null;
  const catHint = (node) => { const h = $('catHint'); h.replaceChildren(...(node ? [node] : [])); show(h, !!node); };
  const currentType = () => document.querySelector('input[name=type]:checked').value;

  async function suggest() {
    const note = $('txNote').value.trim();
    if (note.length < 2) return catHint(null);
    try {
      const { suggestion: s } = await api(`/suggest?type=${currentType()}&q=${encodeURIComponent(note)}`);
      if (!s || $('txNote').value.trim() !== note) return catHint(null);
      if (s.count >= 2 && !catTouched) {
        $('txCat').value = s.category; renderChips();
        catHint(el('span', { textContent: `🧠 เรียนรู้จากประวัติ: ใช้หมวด “${s.category}” มา ${s.count} ครั้ง` }));
      } else if ($('txCat').value.trim() !== s.category) {
        const b = el('button', { type: 'button', className: 'link-btn', textContent: `💡 เคยใช้หมวด “${s.category}” — แตะเพื่อใช้` });
        b.onclick = () => { $('txCat').value = s.category; catTouched = true; renderChips(); catHint(null); };
        catHint(b);
      } else catHint(null);
    } catch { catHint(null); }
  }
  $('txNote').addEventListener('input', () => { clearTimeout(hintTimer); hintTimer = setTimeout(suggest, 400); });

  // ---------- slip scan ----------
  async function handleSlip(file) {
    if (!file) return;
    const btns = [$('dlgScan'), $('dlgAttach'), $('txSave')];
    btns.forEach((x) => (x.disabled = true));
    scanMsg('✨ กำลังอ่านสลิป… (อาจใช้เวลา 5–15 วินาที)');
    try {
      const blob = await shrink(file);
      const [scan] = await Promise.all([
        B.postFile('/slip/scan', blob).catch((e) => ({ _err: e.message })),
        attach(blob).catch(() => {}),
      ]);
      document.querySelector('input[name=type][value=expense]').checked = true;
      if (scan._err) { scanMsg('😅 ' + scan._err + ' (แนบรูปไว้ให้แล้ว กรอกเองได้เลย)', true); renderChips(); return; }
      if (scan.amount) $('txAmount').value = scan.amount;
      if (scan.category) $('txCat').value = scan.category;
      if (scan.date) $('txDate').value = scan.date;
      if (scan.note) $('txNote').value = scan.note;
      renderChips(); updateFx();
      const missing = [!scan.amount && 'จำนวนเงิน', !scan.date && 'วันที่'].filter(Boolean);
      scanMsg(missing.length ? `🧐 อ่านได้บางส่วน ช่วยกรอก${missing.join(' และ ')}เพิ่มนะ` : '✅ อ่านสลิปแล้ว ตรวจความถูกต้องก่อนบันทึกนะ');
      if (scan.learned) catHint(el('span', { textContent: `🧠 เรียนรู้จากประวัติ: ใช้หมวด “${scan.category}” มา ${scan.learned} ครั้ง` }));
    } catch (err) {
      scanMsg('😅 ' + err.message, true);
    } finally {
      btns.forEach((x) => (x.disabled = false));
    }
  }
  $('slipInput').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; handleSlip(f); };
  $('dlgScan').onclick = () => $('slipInput').click();
  $('dlgAttach').onclick = () => $('attachInput').click();
  $('attachInput').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { scanMsg('⏳ กำลังอัปโหลดรูป…'); await attach(await shrink(f)); scanMsg(''); }
    catch (err) { scanMsg('😅 ' + err.message, true); }
  };
  $('removeImg').onclick = () => {
    const k = imageKey;
    setImage(null);
    if (k && sessionKeys.has(k)) { sessionKeys.delete(k); api('/uploads/' + k, { method: 'DELETE' }).catch(() => {}); }
  };
  $('previewImg').onclick = () => imageKey && B.openLightbox('/api/uploads/' + imageKey);

  // ---------- category chips ----------
  function renderChips() {
    const isIncome = currentType() === 'income';
    const names = isIncome ? INCOME_CHIPS : [...SAVING_CATS, ...SPEND_CHIPS];
    const cur = $('txCat').value.trim();
    $('catChips').replaceChildren(...names.map((n) => {
      const b = el('button', { type: 'button', className: 'chip' + (!isIncome && SAVING_CATS.includes(n) ? ' saving' : '') + (n === cur ? ' on' : ''), textContent: emojiFor(n, isIncome ? 'income' : 'expense') + ' ' + n });
      b.onclick = () => { $('txCat').value = n; catTouched = true; catHint(null); renderChips(); };
      return b;
    }));
  }
  document.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', () => { renderChips(); suggest(); }));
  $('txCat').addEventListener('input', () => { catTouched = true; renderChips(); });

  // ---------- account + currency ----------
  function fillAccountSelect(selected) {
    const sel = $('txAccount');
    sel.replaceChildren(el('option', { value: '', textContent: '— ไม่ระบุบัญชี —' }),
      ...S.ACCOUNTS.map((a) => el('option', { value: String(a.id), textContent: `${a.name} (${a.currency})` })));
    sel.value = selected == null ? '' : String(selected);
    if (sel.value !== (selected == null ? '' : String(selected))) sel.value = '';
  }
  function updateFx() {
    const a = acctById($('txAccount').value ? Number($('txAccount').value) : null);
    const cur = a ? a.currency : 'THB';
    $('txAmountLabel').textContent = `จำนวนเงิน (${cur})`;
    const amt = Number($('txAmount').value);
    const note = $('fxHint');
    show(note, cur !== 'THB' && amt > 0);
    if (cur !== 'THB' && amt > 0) note.textContent = `≈ ${fmtTHB(amt * a.rate_to_thb)} (1 ${cur} = ฿${a.rate_to_thb})`;
  }
  $('txAccount').addEventListener('change', updateFx);
  $('txAmount').addEventListener('input', updateFx);
  // Default to the last-used account, but only a baht one: a foreign-currency account must be picked on purpose
  const lastAccount = () => {
    try {
      const id = Number(localStorage.getItem('ben_last_account')) || null;
      const a = acctById(id);
      return a && a.currency === 'THB' ? id : null;
    } catch { return null; }
  };

  // ---------- dialog ----------
  function openEntry(x) {
    editingId = x ? x.id : null;
    catTouched = !!x;
    $('txTitle').textContent = x ? '✏️ แก้ไขรายการ' : '➕ เพิ่มรายการ';
    document.querySelector(`input[name=type][value=${x ? x.type : 'expense'}]`).checked = true;
    $('txAmount').value = x ? x.amount : '';
    $('txCat').value = x ? x.category : '';
    $('txDate').value = x ? x.date : B.todayStr();
    $('txNote').value = x ? x.note : '';
    fillAccountSelect(x ? x.account_id : (S.ACCOUNTS.some((a) => a.id === lastAccount()) ? lastAccount() : null));
    sessionKeys = new Set();
    setImage(x ? x.image_key || null : null);
    scanMsg(''); catHint(null);
    renderChips(); updateFx();
    show($('txError'), false);
    dlg.showModal();
  }
  const closeDialog = () => { dropUnsaved(null); dlg.close(); };
  $('txCancel').onclick = closeDialog;
  dlg.addEventListener('cancel', () => dropUnsaved(null)); // Esc key

  $('txForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const accountId = $('txAccount').value ? Number($('txAccount').value) : null;
    const body = {
      type: currentType(), amount: $('txAmount').value, category: $('txCat').value, date: $('txDate').value,
      note: $('txNote').value, image_key: imageKey, account_id: accountId,
    };
    try {
      await (editingId ? api('/transactions/' + editingId, { method: 'PUT', body }) : api('/transactions', { method: 'POST', body }));
      dropUnsaved(imageKey);
      try { if (accountId) localStorage.setItem('ben_last_account', accountId); else localStorage.removeItem('ben_last_account'); } catch { /* ignore */ }
      dlg.close();
      B.toast(editingId ? 'แก้ไขแล้ว ✏️' : 'บันทึกแล้ว ✨');
      emit('reload');
    } catch (err) { $('txError').textContent = err.message; show($('txError'), true); }
  });

  $('addBtn').onclick = () => { B.setMenu(false); openEntry(null); };
  $('scanBtn').onclick = () => { B.setMenu(false); openEntry(null); $('slipInput').click(); };
  $('fabBtn').onclick = () => openEntry(null);
  on('edit-tx', openEntry);
  on('open-entry', () => openEntry(null));
  B.openEntry = openEntry;
})();
