# Backend Foundation Inventory

## Scope

เอกสารนี้สรุปสถานะ `Phase 1: Platform Foundation` หลังรอบที่เพิ่ม typed config, global validation/filter, และ shared actor primitives

## Inventory Summary

### Endpoints / modules ที่ยังมี `any` หรือ legacy contracts

- runtime HTTP modules ที่อยู่ใน path หลักของระบบถูกย้ายเข้า DTO + controller + service + repository pattern แล้ว
- scripts กลุ่ม maintenance เก่าควรถูกลดบทบาท ไม่ควรสร้าง/drop schema เองนอก migration flow

### จุดที่ยังมี manual validation

- `src/task/submission.controller.ts` ยัง parse multipart fields เอง เพราะ payload มาจาก mixed text/file form
- `src/imports/imports.controller.ts` ยัง validate `file` presence เอง ซึ่งเป็นพฤติกรรมที่เหมาะกับ upload endpoint
- service/policy หลายตัว เช่น `src/attendance/attendance-write.service.ts`, `src/task/task-policy.service.ts`, `src/users/users-policy.service.ts` ยังมี domain validation ที่ควรอยู่ใน service/policy ต่อไป ไม่ควรย้ายไป controller

### จุดที่ยังมี manual `HttpException` mapping

- `src/task/task.controller.ts`, `src/task/delegation.controller.ts`, `src/task/case.controller.ts`, และ `src/task/submission.controller.ts` ยัง map status เองบาง route เพราะ route contract เดิมต้องแยก `404/410/403/400` ตาม business result

### จุดที่ยังโหลด config/runtime เอง

- runtime HTTP layer ถูกย้ายเข้า typed config แล้วที่ `src/config/app.config.ts`, `src/config/email.config.ts`, และ `src/config/database.config.ts`
- scripts ใต้ `src/scripts/**` ถ้ามีเพิ่มในอนาคตควรใช้ config pattern ที่ชัดเจน และไม่ควรอ่าน secrets หรือ bootstrap schema แบบเฉพาะกิจ

### จุดที่ guard เคยแบก actor loading / permission resolution

- current state: actor loading ถูกย้ายมาที่ `src/auth/auth-actor.service.ts` แล้ว และ guard เหลือบทบาท auth/authz เป็นหลักใน `src/auth/auth.guard.ts`
- `students` module ถูกย้ายเข้า `AuthGuard + CurrentUser` แล้วที่ `src/students/students.controller.ts`

## Responsibility Rules

- `controller`
  รับผิดชอบ route binding, decorators, DTO contracts, และเรียก service เท่านั้น
- `guard`
  รับผิดชอบ authentication/authorization; ห้าม query domain data เพิ่มนอก actor loading path กลาง
- `service`
  รับผิดชอบ orchestration/use case และ domain validation ที่ต้องรู้กติกาธุรกิจ
- `repository`
  รับผิดชอบ persistence, query composition, และ transaction helpers
- `config`
  runtime config ต้องผ่าน `ConfigModule` และ typed config functions เท่านั้น

## Response Serialization / Interceptor Policy

- backend นี้มี response contract เดิมหลายรูปแบบ เช่น `data envelope`, plain array, และ task guest routes ที่มี custom error semantics
- จึงยัง `ไม่` ควรบังคับ global response envelope/interceptor กับทุก route เพราะจะเสี่ยงทำให้ frontend drift
- อนุญาต interceptor เฉพาะกรณีที่มี response mapping ซ้ำจริงใน module ใหม่หรือ module ที่กำลัง refactor อยู่
- ถ้า route เดิมมี custom status contract อยู่แล้ว ให้ controller map เฉพาะ status semantics นั้นต่อไป และปล่อย unknown errors ให้ global exception filter จัดการ

## Next Priority After Foundation

1. ทำ manual/API smoke หลัง Phase 4 กับ flows หลักที่แตะ DB read/write
2. ถ้าต้องเพิ่ม maintenance script ใหม่ ให้ระบุ owner, วิธีรัน, และเหตุผลที่ไม่ควรเป็น migration หรือ seed SQL
3. ถ้าจะยกระดับต่อ ให้เริ่มจากแปลง raw SQL บางก้อนเป็น TypeORM repository/query builder แบบค่อยเป็นค่อยไป
