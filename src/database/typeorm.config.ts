import { join } from 'path';
import type { ConfigType } from '@nestjs/config';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { databaseConfig } from '../config/database.config';
import { DATABASE_ENTITIES } from './entities';
import { LegacyNamingStrategy } from './legacy.naming-strategy';

export function createTypeOrmOptions(
  config: ConfigType<typeof databaseConfig>,
): PostgresConnectionOptions {
  return {
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    database: config.database,
    entities: DATABASE_ENTITIES,
    migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
    synchronize: false,
    migrationsRun: false,
    logging: false,
    namingStrategy: new LegacyNamingStrategy(),
  };
}
