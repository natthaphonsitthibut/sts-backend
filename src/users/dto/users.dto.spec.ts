import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto, CreateUserDto, LoginDto } from './users.dto';

async function messagesFor<T extends object>(
  type: new () => T,
  body: Record<string, unknown>,
  property: string,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, body));
  return Object.values(errors.find((error) => error.property === property)?.constraints ?? {});
}

const createBody = { FirstName: 'ครู', LastName: 'ทดสอบ', PersonID_Onec: '1234567890123' };

describe('credential rules', () => {
  it('accepts English letters, digits and symbols', async () => {
    expect(
      await messagesFor(CreateUserDto, { ...createBody, username: 'burapha.admin_01' }, 'username'),
    ).toEqual([]);
    expect(
      await messagesFor(CreateUserDto, { ...createBody, password: 'Pa$$w0rd!' }, 'password'),
    ).toEqual([]);
  });

  it('refuses Thai and spaces with a Thai explanation', async () => {
    expect(
      await messagesFor(CreateUserDto, { ...createBody, username: 'ผู้ดูแลระบบ' }, 'username'),
    ).toEqual([expect.stringContaining('ใช้ได้เฉพาะภาษาอังกฤษ')]);
    expect(
      await messagesFor(CreateUserDto, { ...createBody, password: 'pass word1' }, 'password'),
    ).toEqual([expect.stringContaining('ห้ามเว้นวรรค')]);
  });

  it('keeps passwords between 8 and 50 characters', async () => {
    expect(
      await messagesFor(CreateUserDto, { ...createBody, password: 'short1' }, 'password'),
    ).toEqual(['รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร']);
    expect(
      await messagesFor(
        ChangePasswordDto,
        { currentPassword: 'x', newPassword: 'a'.repeat(51) },
        'newPassword',
      ),
    ).toEqual(['รหัสผ่านต้องไม่เกิน 50 ตัวอักษร']);
  });

  it('caps sign-in at 50 characters without imposing the new-account rules', async () => {
    expect(await messagesFor(LoginDto, { username: 'Tha', password: 'x' }, 'username')).toEqual([]);
    expect(
      await messagesFor(LoginDto, { username: 'a'.repeat(51), password: 'x' }, 'username'),
    ).toEqual(['ชื่อผู้ใช้งานต้องไม่เกิน 50 ตัวอักษร']);
  });
});
