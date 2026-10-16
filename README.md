# Ben

แดชบอร์ดจัดการเงินส่วนบุคคล — บันทึกรายรับ/รายจ่าย ดูสรุปเป็นกราฟ ตั้งงบประมาณรายเดือน และส่งออก CSV

- Backend: Cloudflare Worker (Hono) + D1
- Frontend: static HTML/JS ใน `public/` (Chart.js)
- ล็อกอินด้วย username/password ที่ตั้งเอง (PBKDF2 + คุกกี้เซ็นด้วย HMAC) รองรับผู้ใช้คนเดียว:
  เปิดเว็บครั้งแรกจะเป็นหน้า "ตั้งค่าบัญชีครั้งแรก" หลังสร้างแล้วจะสมัครเพิ่มไม่ได้

## รันในเครื่อง

```bash
npm install
echo SESSION_SECRET=ค่าสุ่มยาวๆ > .dev.vars
npm run db:migrate:local
npm run dev
```

## Deploy

```bash
npx wrangler d1 create ben-db        # แล้วใส่ database_id ใน wrangler.toml
npm run db:migrate:remote
npm run deploy
npx wrangler secret put SESSION_SECRET
```

`prototype/` คือต้นแบบ HTML เดิม (ข้อมูลจำลอง ไม่ได้ใช้งาน)
