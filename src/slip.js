// Reads a Thai bank/e-wallet slip photo with Workers AI: vision model transcribes, text model structures.
export const CATEGORIES = ['อาหาร', 'เครื่องดื่ม', 'เดินทาง', 'ช้อปปิ้ง', 'ที่อยู่อาศัย', 'บิล/สาธารณูปโภค', 'สุขภาพ', 'บันเทิง', 'การศึกษา', 'โอนเงิน', 'อื่นๆ'];

const TRANSCRIBE_PROMPT = `นี่คือภาพสลิปโอนเงิน/ชำระเงิน/ใบเสร็จ ให้คัดลอกข้อความที่เห็นทั้งหมดตามที่ปรากฏ โดยเน้น: จำนวนเงิน, วันที่และเวลา, ชื่อผู้โอน (บรรทัด "จาก") และชื่อผู้รับ/ร้านค้า (บรรทัด "ไปยัง") แยกกันให้ชัดเจน, บันทึกช่วยจำ/memo, ชื่อธนาคาร/แอป ตอบเป็นข้อความธรรมดาเท่านั้น ห้ามเดาข้อมูลที่ไม่เห็นในภาพ`;

const PARSE_PROMPT = `จากข้อความที่ได้จากสลิป ให้สกัดข้อมูลเป็น JSON เท่านั้น (ห้ามมี markdown หรือคำอธิบาย) รูปแบบ:
{"amount": จำนวนเงินที่จ่าย/โอน เป็นตัวเลข (ไม่ใช่ค่าธรรมเนียม ไม่ใช่ยอดคงเหลือ) ถ้าไม่พบเป็น null,
 "day": วันที่เป็นเลข 1-31 หรือ null,
 "month": เดือนเป็นเลข 1-12 (ม.ค.=1 ... ธ.ค.=12) หรือ null,
 "year": ปีตามที่เขียนในสลิป (เช่น 2569, 69 หรือ 2026) หรือ null,
 "merchant": ชื่อผู้รับเงิน/ร้านค้า คือคนหลังคำว่า "ไปยัง" หรือ "ผู้รับ" ไม่ใช่ผู้โอน (สั้นๆ) หรือ "",
 "memo": บันทึกช่วยจำถ้ามี หรือ "",
 "category": เลือกหนึ่งอย่างจากรายการนี้เท่านั้น: ${CATEGORIES.join(', ')}}

ข้อความจากสลิป:
{TRANSCRIPT}`;

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

const num = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(/[,฿\s]/g, '')) : Number(v);
  return Number.isFinite(n) ? n : null;
};

function toIsoDate(day, month, year) {
  let d = num(day), m = num(month), y = num(year);
  if (!d || !m || !y) return null;
  if (y < 100) y += y >= 50 ? 2500 : 2000; // "69" -> 2569 (BE), "26" -> 2026
  if (y > 2400) y -= 543; // Buddhist era -> CE
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isNaN(Date.parse(iso)) ? null : iso;
}

export async function scanSlip(imageBytes, env) {
  const vision = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
    image: [...imageBytes],
    prompt: TRANSCRIBE_PROMPT,
    max_tokens: 700,
    temperature: 0.1,
  });
  const transcript = typeof vision?.response === 'string' ? vision.response : JSON.stringify(vision?.response || '');
  if (!transcript.trim()) throw new Error('อ่านข้อความจากรูปไม่สำเร็จ ลองถ่ายให้ชัดขึ้น หรือกรอกเอง');

  const parsedRes = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
    messages: [
      { role: 'system', content: 'คุณเป็นเครื่องมือสกัดข้อมูล ตอบเป็น JSON object เดียวเท่านั้น ห้ามมีข้อความอื่น ห้ามเขียนซ้ำ' },
      { role: 'user', content: PARSE_PROMPT.replace('{TRANSCRIPT}', transcript.slice(0, 4000)) },
    ],
    max_tokens: 220,
    temperature: 0.1,
  });
  const p = extractJson(typeof parsedRes?.response === 'string' ? parsedRes.response : JSON.stringify(parsedRes?.response ?? ''));
  if (!p) throw new Error('แปลงข้อมูลจากสลิปไม่สำเร็จ ลองถ่ายใหม่ หรือกรอกเอง');

  const amount = num(p.amount);
  const merchant = String(p.merchant || '').trim().slice(0, 80);
  const memo = String(p.memo || '').trim().slice(0, 80);
  return {
    amount: amount && amount > 0 ? amount : null,
    date: toIsoDate(p.day, p.month, p.year),
    note: [merchant, memo].filter(Boolean).join(' · ').slice(0, 200),
    category: CATEGORIES.includes(p.category) ? p.category : 'อื่นๆ',
  };
}
