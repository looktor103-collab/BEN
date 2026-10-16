// Login / first-time setup / sign out, and the boot sequence.
(() => {
  const { $, show, api, S, emit } = window.Ben;

  let setupMode = false;
  function setAuthMode(setup) {
    setupMode = setup;
    $('authTitle').textContent = setup ? 'ตั้งค่าบัญชีครั้งแรก' : 'เข้าสู่ระบบ';
    $('authSub').textContent = setup ? 'ตั้ง username และรหัสผ่านของคุณเอง' : 'Ben · แดชบอร์ดการเงินส่วนบุคคล';
    $('authSubmit').textContent = setup ? 'สร้างบัญชี' : 'เข้าสู่ระบบ';
    $('password').autocomplete = setup ? 'new-password' : 'current-password';
    show($('confirmField'), setup);
    show($('pwHint'), setup);
    $('password2').required = setup;
  }
  const authError = (m) => { $('authError').textContent = m || ''; show($('authError'), !!m); };

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    authError('');
    const username = $('username').value.trim();
    const password = $('password').value;
    if (setupMode && password !== $('password2').value) return authError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    try {
      await api(setupMode ? '/auth/setup' : '/auth/login', { method: 'POST', body: { username, password } });
      $('password').value = $('password2').value = '';
      await boot();
    } catch (err) { authError(err.message); }
  });

  $('signOutBtn').onclick = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  };

  async function boot() {
    try {
      const me = await api('/me');
      show($('loadingView'), false);
      if (!me.user) {
        setAuthMode(me.needsSetup);
        show($('appView'), false);
        show($('loginView'), true);
        return;
      }
      S.user = me.user;
      show($('loginView'), false);
      show($('appView'), true);
      $('userName').textContent = me.user.username;
      await window.Ben.load();
      emit('booted');
      if (new URLSearchParams(location.search).get('add')) { history.replaceState(null, '', '/'); emit('open-entry'); }
    } catch (err) {
      $('loadingView').textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ' + err.message;
    }
  }
  window.Ben.boot = boot;
})();
