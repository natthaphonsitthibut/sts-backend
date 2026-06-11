import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from './entities';
import { LegacyNamingStrategy } from './legacy.naming-strategy';
import { getDatabaseConfigFromEnv } from '../config/database.config';

const config = getDatabaseConfigFromEnv();

const appDataSource = new DataSource({
  type: 'postgres',
  host: config.host,
  port: config.port,
  username: config.username,
  password: config.password,
  database: config.database,
  entities: DATABASE_ENTITIES,
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: false,
  namingStrategy: new LegacyNamingStrategy(),
});

export default appDataSource;
