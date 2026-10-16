// "Ben" the finance chatbot. The server grounds every answer in the user's own numbers.
(() => {
  const B = window.Ben;
  const { $, api, el } = B;
  const dlg = $('chatDialog');
  const history = []; // {role, content}, kept in memory only
  const SUGGEST = ['เดือนนี้ใช้จ่ายอะไรมากที่สุด?', 'เดือนนี้หมดเงินกับค่ากาแฟไปเท่าไหร่แล้ว?', 'ทำไมเดือนนี้เงินเก็บถึงลดลง?', 'ขอคำแนะนำในการออมเงินหน่อย'];

  function bubble(role, text, cls = '') {
    const b = el('div', { className: `chat-msg ${role} ${cls}`, textContent: text });
    $('chatLog').append(b);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    return b;
  }

  async function send(text) {
    text = text.trim();
    if (!text) return;
    $('chatSuggest').hidden = true;
    bubble('user', text);
    history.push({ role: 'user', content: text });
    $('chatInput').value = '';
    $('chatSend').disabled = true;
    const wait = bubble('bot', '💭 กำลังคิด…', 'wait');
    try {
      const { reply } = await api('/chat', { method: 'POST', body: { messages: history, today: B.todayStr() } });
      wait.remove();
      bubble('bot', reply);
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      wait.remove();
      bubble('bot', '😅 ' + err.message, 'err');
      history.pop(); // let the user retry the same question
    } finally {
      $('chatSend').disabled = false;
      $('chatInput').focus();
    }
  }

  $('chatSuggest').replaceChildren(...SUGGEST.map((q) => {
    const b = el('button', { type: 'button', className: 'chip', textContent: q });
    b.onclick = () => send(q);
    return b;
  }));
  $('chatForm').addEventListener('submit', (e) => { e.preventDefault(); send($('chatInput').value); });

  function open() {
    B.setMenu(false);
    if (!$('chatLog').children.length) bubble('bot', 'สวัสดี ผมเบน 👋 ถามอะไรเกี่ยวกับเงินของคุณได้เลย เช่น ใช้จ่ายหมวดไหนเยอะ หรือขอคำแนะนำการออม (ตอบจากข้อมูลที่คุณจดไว้เท่านั้น)');
    dlg.showModal();
    $('chatInput').focus();
  }
  $('chatBtn').onclick = open;
  $('chatMenuBtn').onclick = open;
  $('chatClose').onclick = () => dlg.close();
})();
