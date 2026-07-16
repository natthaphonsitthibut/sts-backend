import { hasPermission } from './permissions.constants';

describe('hasPermission', () => {
  it.each(['*', 'ALL'])('denies raw access to restricted executives with %s', (wildcard) => {
    expect(hasPermission(['EXECUTIVE'], [wildcard], 'students')).toBe(false);
    expect(hasPermission(['EXECUTIVE'], [wildcard], 'manage-student-observations')).toBe(false);
  });

  it('allows restricted executives to use home when granted', () => {
    expect(hasPermission(['EXECUTIVE'], ['home'], 'home')).toBe(true);
    expect(hasPermission(['EXECUTIVE'], ['*'], 'home')).toBe(true);
  });

  it.each(['export-data', 'students'])(
    'denies retired or raw permission %s to restricted executives',
    (permission) => {
      expect(hasPermission(['EXECUTIVE'], [permission], permission)).toBe(false);
      expect(hasPermission(['EXECUTIVE'], ['*'], permission)).toBe(false);
    },
  );

  it('does not restrict an executive who also has a privileged operational role', () => {
    expect(hasPermission(['EXECUTIVE', 'ADMIN'], ['*'], 'students')).toBe(true);
    expect(hasPermission(['EXECUTIVE', 'DIRECTOR'], ['students'], 'students')).toBe(true);
  });
});
