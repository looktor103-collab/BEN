// Theme, mobile drawer, account settings, privacy (PDPA) tools, and PWA install.
(() => {
  const B = window.Ben;
  const { $, show, api, emit, setMsg, setMenu } = B;

  // ---------- theme ----------
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try { theme = localStorage.getItem('ben_theme') || theme; } catch { /* private mode */ }
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('themeBtn').textContent = t === 'light' ? '🌙' : '☀️';
    document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#faf7f2' : '#15131b';
    emit('theme', t);
  }
  $('themeBtn').onclick = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('ben_theme', theme); } catch { /* ignore */ }
    applyTheme(theme);
  };
  applyTheme(theme);

  // ---------- mobile drawer ----------
  $('menuBtn').onclick = () => setMenu(true);
  $('closeMenu').onclick = $('scrim').onclick = () => setMenu(false);

  // ---------- account settings ----------
  const acct = $('accountDialog');
  $('accountBtn').onclick = () => {
    setMenu(false);
    ['usernameForm', 'passwordForm', 'deleteForm'].forEach((f) => $(f).reset());
    ['userErr', 'pwErr', 'delErr'].forEach((id) => setMsg(id, ''));
    $('acctNewUser').value = $('userName').textContent;
    acct.showModal();
  };
  $('acctDone').onclick = () => acct.close();

  $('usernameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/account/username', { method: 'POST', body: { current_password: $('acctUserPw').value, new_username: $('acctNewUser').value.trim() } });
      $('userName').textContent = r.username;
      $('acctUserPw').value = '';
      setMsg('userErr', '✅ เปลี่ยน username แล้ว ครั้งหน้าเข้าสู่ระบบด้วยชื่อใหม่', true);
    } catch (err) { setMsg('userErr', err.message); }
  });
  $('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('acctNewPw').value !== $('acctNewPw2').value) return setMsg('pwErr', 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
    try {
      await api('/account/password', { method: 'POST', body: { current_password: $('acctOldPw').value, new_password: $('acctNewPw').value } });
      $('passwordForm').reset();
      setMsg('pwErr', '✅ เปลี่ยนรหัสผ่านแล้ว', true);
    } catch (err) { setMsg('pwErr', err.message); }
  });

  // ---------- privacy: download / erase ----------
  $('privacyBtn').onclick = () => $('privacyDialog').showModal();
  $('privacyClose').onclick = () => $('privacyDialog').close();
  $('exportDataBtn').onclick = async () => {
    try {
      const data = await api('/privacy/export');
      const a = B.el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `ben-my-data-${B.todayStr()}.json` });
      a.click();
      URL.revokeObjectURL(a.href);
      B.toast('ดาวน์โหลดข้อมูลของคุณแล้ว 📦');
    } catch (err) { alert(err.message); }
  };
  $('deleteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('ลบบัญชีและข้อมูลทั้งหมดถาวร? (รายการ งบ เป้าหมาย บัญชี และรูปทั้งหมด) กู้คืนไม่ได้')) return;
    try {
      await api('/privacy/delete', { method: 'POST', body: { current_password: $('delPw').value, confirm: $('delConfirm').value.trim() } });
      alert('ลบข้อมูลทั้งหมดแล้ว');
      location.reload();
    } catch (err) { setMsg('delErr', err.message); }
  });

  // ---------- PWA ----------
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; show($('installBtn'), true); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; show($('installBtn'), false); });
  $('installBtn').onclick = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null;
    show($('installBtn'), false);
  };
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) show($('iosHint'), true);
})();
