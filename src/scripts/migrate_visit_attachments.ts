import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { appConfig } from '../config/app.config';
import { storageConfig } from '../config/storage.config';
import { FileStorageModule } from '../files/storage/file-storage.module';
import { FILE_STORAGE_ADAPTER, type FileStorageAdapter } from '../files/storage/file-storage.types';
import appDataSource from '../database/typeorm.datasource';

const VISIT_ATTACHMENTS_DIRECTORY = 'visit-attachments';
const LEGACY_VISIT_FILENAME = /^[0-9a-f]{32}\.(?:jpe?g|png|gif|webp|pdf|docx?)$/i;

type SubmissionRow = {
  id: string;
  photo_paths: string;
};

type PendingMove = {
  id: string;
  previousPaths: string;
  nextPaths: string;
  storageKeys: string[];
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, storageConfig],
    }),
    FileStorageModule,
  ],
})
class VisitAttachmentMigrationModule {}

function legacyStorageKey(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith('/uploads/')) return null;
  const storageKey = path.slice('/uploads/'.length);
  return LEGACY_VISIT_FILENAME.test(storageKey) ? storageKey : null;
}

function buildPendingMove(row: SubmissionRow): PendingMove | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.photo_paths);
  } catch {
    throw new Error(`Submission ${row.id} has invalid photo_paths JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Submission ${row.id} has non-array photo_paths`);
  }

  const parsedPaths: unknown[] = parsed;
  const storageKeys = [
    ...new Set(parsedPaths.map(legacyStorageKey).filter((key): key is string => !!key)),
  ];
  if (storageKeys.length === 0) return null;

  const nextPaths = parsedPaths.map((path) => {
    const storageKey = legacyStorageKey(path);
    return storageKey ? `/uploads/${VISIT_ATTACHMENTS_DIRECTORY}/${storageKey}` : path;
  });
  return {
    id: row.id,
    previousPaths: row.photo_paths,
    nextPaths: JSON.stringify(nextPaths),
    storageKeys,
  };
}

async function copyObject(
  storage: FileStorageAdapter,
  sourceKey: string,
  destinationKey: string,
): Promise<void> {
  const source = await storage.open(sourceKey);
  if (!source) {
    throw new Error(`Missing legacy visit attachment: ${sourceKey}`);
  }
  await storage.saveStream(source, destinationKey);
}

async function migrate(apply: boolean): Promise<void> {
  const app = await NestFactory.createApplicationContext(VisitAttachmentMigrationModule, {
    logger: false,
  });
  try {
    await appDataSource.initialize();
    const storage = app.get<FileStorageAdapter>(FILE_STORAGE_ADAPTER);
    const rows = await appDataSource.query<SubmissionRow[]>(
      `
        SELECT id::text, photo_paths
        FROM task_submissions
        WHERE photo_paths IS NOT NULL AND BTRIM(photo_paths) <> ''
      `,
    );
    const pending = rows.map(buildPendingMove).filter((item): item is PendingMove => !!item);
    const files = new Set(pending.flatMap((item) => item.storageKeys));

    if (!apply) {
      console.log(
        `Dry run: ${pending.length} reports, ${files.size} files would move to ${VISIT_ATTACHMENTS_DIRECTORY}/.`,
      );
      return;
    }

    for (const sourceKey of files) {
      await copyObject(storage, sourceKey, `${VISIT_ATTACHMENTS_DIRECTORY}/${sourceKey}`);
    }

    await appDataSource.transaction(async (manager) => {
      for (const item of pending) {
        const updated = await manager.query<Array<{ id: string }>>(
          `
            UPDATE task_submissions
            SET photo_paths = $1
            WHERE id = $2 AND photo_paths = $3
            RETURNING id::text AS id
          `,
          [item.nextPaths, item.id, item.previousPaths],
        );
        if (updated.length !== 1) {
          throw new Error(
            `Submission ${item.id} changed while migrating; no legacy file was deleted`,
          );
        }
      }
    });

    for (const sourceKey of files) {
      await storage.delete(sourceKey);
    }
    console.log(`Migrated ${pending.length} reports and removed ${files.size} legacy root files.`);
  } finally {
    if (appDataSource.isInitialized) await appDataSource.destroy();
    await app.close();
  }
}

void migrate(process.argv.includes('--apply')).catch((error: unknown) => {
  const message = error instanceof Error ? error.message.trim() : '';
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  const safeDetail = [errorName, errorCode, message].filter(Boolean).join(': ');
  console.error(`Visit attachment migration failed: ${safeDetail}`);
  process.exitCode = 1;
});
