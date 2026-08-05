import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { getDatabaseConfigFromEnv } from '../config/database.config';
import { createTypeOrmOptions } from './typeorm.config';

const config = getDatabaseConfigFromEnv();

const appDataSource = new DataSource(createTypeOrmOptions(config));

export default appDataSource;
