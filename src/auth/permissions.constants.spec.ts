import { hasPermission } from './permissions.constants';

describe('hasPermission', () => {
  it.each(['*', 'ALL'])('denies raw access to aggregate-only executives with %s', (wildcard) => {
    expect(hasPermission(['EXECUTIVE'], [wildcard], 'students')).toBe(false);
    expect(hasPermission(['EXECUTIVE'], [wildcard], 'manage-student-observations')).toBe(false);
  });

  it.each(['home', 'executive-report', 'export-data'])(
    'allows aggregate-only executives to use %s when granted',
    (permission) => {
      expect(hasPermission(['EXECUTIVE'], [permission], permission)).toBe(true);
      expect(hasPermission(['EXECUTIVE'], ['*'], permission)).toBe(true);
    },
  );

  it('does not restrict an executive who also has a privileged operational role', () => {
    expect(hasPermission(['EXECUTIVE', 'ADMIN'], ['*'], 'students')).toBe(true);
    expect(hasPermission(['EXECUTIVE', 'DIRECTOR'], ['students'], 'students')).toBe(true);
  });
});
