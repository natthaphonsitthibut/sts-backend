# sts-backend

Backend ของระบบติดตามนักเรียน พัฒนาด้วย NestJS + TypeScript โดยโครงสร้างปัจจุบันเป็นแบบ `controller + dto + focused services + repository/data layer` และใช้ TypeORM `DataSource` + migrations เป็นฐาน runtime

## Current Stack

- NestJS 11
- TypeScript
- TypeORM 0.3
- PostgreSQL
- class-validator
- class-transformer
- Jest
- ESLint
- Prettier
- Nodemailer
- @nestjs/schedule
- better-sqlite3
- xlsx

## Current Architecture

ปัจจุบัน backend ไม่ได้ใช้โครง `controller + service ก้อนเดียว` แล้ว แต่เน้นแยก responsibility ตามนี้:

- `controller`
  รับ request, map DTO, เรียก use case/service
- `dto`
  request contracts และ validation
- `focused services`
  จัด orchestration / domain logic
- `repository`
  query และ persistence ผ่าน `DataSource`
- `common`
  cross-cutting concerns เช่น auth helpers, filters, validation, utils

## Current Structure

โครงสร้างหลักใต้ `src/`

```text
src/
  attendance/      attendance domain
  auth/            auth actor loading, mock student auth, auth controllers
  automation/      absence monitor / scheduler / automation services
  common/          filters, validation, shared utils
  config/          typed app config
  database/        TypeORM config, entities, migrations, SQL helpers
  imports/         import/upload domain
  master-data/     master-data CRUD domain
  settings/        system settings domain
  students/        students read model and self-access boundary
  task/            task, login-link, case, delegation, dashboard domains
  users/           users, roles, auth-related user management
  scripts/         maintenance / verification scripts
```

โฟลเดอร์ย่อยที่สำคัญ:

- `src/*/dto`
- `src/database/entities`
- `src/database/migrations`
- `src/common/filters`
- `src/common/validation`

## Data Layer Policy

runtime ตอนนี้:

- ใช้ TypeORM `DataSource`
- ใช้ migrations เป็นทางเดียวสำหรับ schema setup
- ไม่ใช้ runtime schema bootstrap แล้ว
- ไม่ใช้ `DatabaseService` เดิมแล้ว
- ไม่ใช้ runtime direct `pg` usage ในโมดูลหลักแล้ว

หมายเหตุ:

- Maintenance scripts ต้องไม่สร้าง/drop schema เอง ให้ใช้ SQL seed และ TypeORM migrations เป็น flow หลัก

## Module Pattern

โมดูลที่ refactor แล้วจะมี pattern ประมาณนี้:

```text
module/
  dto/
  *.controller.ts
  *.service.ts
  *.repository.ts
  *.module.ts
```

บางโมดูลอาจมี service แยกหลายตัว เช่น:

- read service
- write service
- policy service
- lifecycle service
- access service

เหตุผลคือ domain นี้มี business rule ค่อนข้างเยอะ และตั้งใจหลีกเลี่ยง service ก้อนเดียว

## Auth Model

auth ปัจจุบันรองรับหลาย source:

- normal login จาก `users`
- magic login ผ่าน login links
- Mock ThaID student login ผ่าน virtual session

รายละเอียดสำคัญ:

- actor loading อยู่ใน auth layer กลาง
- normal login ใช้ `x-user-id`
- magic login ใช้ `x-magic-link-token` และ `x-magic-session`
- mock student session ใช้ `x-virtual-auth`

`AuthGuard` ตอนนี้ควรเหลือบทบาท auth/authz เป็นหลัก ไม่ควรไปถือ business logic หรือ query เอง

## Student Auth Notes

student login ตอนนี้รองรับ `Mock ThaID`

- endpoint: `POST /api/auth/thaid/mock/login`
- match ผ่าน `student_term.PersonID_Onec`
- ออก signed `virtual_auth_token`
- student actor ถูก hydrate เป็น own-only session

ดังนั้น flow `/my-attendance` ใช้งานได้โดยไม่ต้องสร้าง `users` row สำหรับนักเรียน

## Database Setup

ติดตั้ง dependencies:

```bash
pnpm install
```

เริ่ม PostgreSQL ผ่าน Docker Compose เฉพาะฐานข้อมูล:

```bash
docker compose up -d db
```

การบูต DB ครั้งแรกจะ import mock seed จาก:

```text
data/backups/sts_backup.sql
```

ตรวจ parity ของ shared bootstrap definitions:

```bash
pnpm bootstrap:verify-parity
```

apply migrations:

```bash
pnpm migration:run
```

หรือใช้ alias:

```bash
pnpm db:migrate
```

เริ่ม backend:

```bash
pnpm start:dev
```

หรือ:

```bash
pnpm start
```

production:

```bash
pnpm start:prod
```

## Important Commands

build:

```bash
pnpm build
```

lint:

```bash
pnpm lint
```

tests:

```bash
pnpm test
pnpm test:e2e
pnpm test:cov
```

TypeORM commands:

```bash
pnpm db:migrate
pnpm migration:show
pnpm migration:run
pnpm migration:revert
```

## Current Tools And Utilities

สิ่งที่ใช้จริงใน codebase ตอนนี้:

- global `ValidationPipe`
- global exception filter
- typed config layer
- shared SQL helper ผ่าน `src/database/sql-query.ts`
- parity verification script สำหรับ migration/bootstrap
- Jest tests สำหรับ unit regression บางส่วน

## Development Guidelines

### 1. Controllers

controller ควร:

- รับ DTO
- ใช้ guard/decorator กลาง
- เรียก service
- ไม่ query DB ตรง

### 2. Services

service ควร:

- ถือ orchestration
- ถือ domain rule
- แยกตาม concern ถ้า logic เริ่มหนา

### 3. Repository / Data Layer

repository ควร:

- ถือ query/persistence
- เป็น boundary ระหว่าง domain logic กับ DB
- ใช้ `DataSource` / query helpers ที่มีอยู่แล้ว

### 4. DTO / Validation

endpoint ใหม่ควร:

- มี DTO ชัดเจน
- ใช้ class-validator เท่าที่เหมาะสม
- ไม่ปล่อย `any` ใหม่ใน controller contracts

### 5. Migrations

การเปลี่ยน schema ใหม่ควร:

- ทำผ่าน migration
- ไม่เพิ่ม runtime schema bootstrap กลับมา
- ยึด naming convention ของ migration ให้ชัด

## Recommended Workflow

เวลาพัฒนา backend เพิ่ม แนะนำลำดับนี้:

1. นิยาม DTO/contracts
2. เพิ่มหรือแก้ repository/data query
3. เพิ่ม/แก้ focused service
4. ให้ controller เรียก use case ให้บางที่สุด
5. ถ้าเปลี่ยน schema ให้เพิ่ม migration
6. รัน `build`, `lint`, และ tests/smoke ที่เกี่ยวข้อง

## Current Direction

แนวทางปัจจุบันของ backend คือ:

- คง API contract เดิมให้มากที่สุดระหว่าง refactor
- แยก domain logic ออกจาก controller และ data access
- ใช้ migration-first database workflow
- ลด legacy coupling
- เปิดทางให้ maintain ง่ายขึ้นในระยะยาว

## Notes

- ถ้าฐานข้อมูลยังไม่ apply migration จะ start app อย่างเดียวไม่พอ
- ก่อน debug ปัญหา backend ใหม่ ควรเช็ก `bootstrap:verify-parity` และ `migration:run` ก่อน
- ถ้าจะเพิ่ม module ใหม่ ให้ยึด pattern เดียวกับโมดูลที่ refactor แล้ว เช่น `users`, `task`, `attendance`, `settings`
