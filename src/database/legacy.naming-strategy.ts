import { DefaultNamingStrategy, type NamingStrategyInterface } from 'typeorm';
import { snakeCase } from 'typeorm/util/StringUtils';

export class LegacyNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  tableName(targetName: string, userSpecifiedName?: string): string {
    return userSpecifiedName || snakeCase(targetName);
  }

  columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    return snakeCase([...embeddedPrefixes, customName || propertyName].join('_'));
  }

  relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }
}
