# TypeORM Transition Strategy

## Scope

เอกสารนี้ล็อกแนวทางหลัง cutover ไป `TypeORM` สำหรับ runtime backend ปัจจุบัน

## Current Baseline

- baseline migration ถูกสร้างไว้ที่ `src/database/migrations/20260328145500-CreateBaselineSchema.ts`
- shared SQL source of truth อยู่ที่ `src/database/bootstrap-sql.ts`
- runtime HTTP path ใช้ `TypeORM DataSource/QueryRunner` แล้ว ไม่มี `DatabaseService` และไม่มี `pg.Pool` ฝั่ง app runtime แล้ว
- parity check แบบไม่แตะ DB รันได้ด้วย `pnpm bootstrap:verify-parity`
- app startup จะ `ไม่` สร้าง schema/seed ให้อีกต่อไป ต้องรัน migration ก่อน start เอง

## Query Policy

- simple CRUD และ table access ทั่วไป:
  ใช้ `TypeORM repository`
- aggregate/read model ที่ยังซับซ้อน:
  ใช้ `DataSource` หรือ `QueryRunner` พร้อม raw SQL
- reporting/query ที่อิง CTE, lateral join, หรือ migration query เดิม:
  raw SQL ยังอนุญาต แต่ต้องวิ่งผ่าน `TypeORM DataSource/QueryRunner`

## Transaction Boundary

- `task create / delegate / submission`
  1 use case = 1 transaction
- `attendance batch write`
  1 save batch = 1 transaction
- `user create / update / delete`
  1 action = 1 transaction
- `automation absence sweep`
  1 scheduler run = 1 transaction

## Runtime Bootstrap Policy

- local/staging/prod ต้องรัน `pnpm migration:run` ก่อน `pnpm start:dev` หรือ `pnpm start`
- ถ้าต้อง verify source of truth ก่อนรัน migration ใช้ `pnpm bootstrap:verify-parity`
- schema/seed baseline ถูกนิยามโดย migration + shared bootstrap definitions เท่านั้น
- ห้ามเพิ่ม schema bootstrap logic กลับเข้า app startup

## Safety Rules

- `synchronize = false` เสมอ
- migration ใหม่ต้อง deterministic และ reviewable
- schema change ใหม่ให้เข้า migration ก่อน runtime code
- raw SQL runtime ต้องผ่าน `TypeORM QueryRunner` หรือ `DataSource`
