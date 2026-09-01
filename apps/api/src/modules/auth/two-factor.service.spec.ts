import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { TwoFactorService } from './two-factor.service';

/**
 * Targeted tests for the C-04 fix:
 *   2FA disable MUST reject a wrong password BEFORE consulting TOTP.
 *   Pre-fix: `password` was an unused `_password` parameter — anyone with
 *   a single valid TOTP could turn 2FA off. Post-fix: bcrypt.compare on
 *   the password must succeed before the TOTP code is even checked.
 */

const USER_ID = 'user-1';

type StoredUser = {
  id: string;
  passwordHash: string;
  twoFactorSecret: string | null;
  twoFactorEnabled: boolean;
};

function buildPrismaStub(user: StoredUser) {
  return {
    user: {
      findUnique: jest.fn(async (): Promise<StoredUser | null> => user),
      update: jest.fn(async ({ where, data }) => {
        if (where.id === user.id) {
          Object.assign(user, data);
        }
        return user;
      }),
    },
  };
}

describe('TwoFactorService.disable (C-04)', () => {
  const PASSWORD = 'correct horse battery staple';
  const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

  let user: StoredUser;
  let prisma: ReturnType<typeof buildPrismaStub>;
  let service: TwoFactorService;

  beforeEach(async () => {
    user = {
      id: USER_ID,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      twoFactorSecret: TOTP_SECRET,
      twoFactorEnabled: true,
    };
    prisma = buildPrismaStub(user);
    service = new TwoFactorService(
      prisma as any,
      { get: () => undefined } as any,
    );
    jest.restoreAllMocks();
  });

  it('rejects when password is wrong — BEFORE touching TOTP', async () => {
    // Spy on verifyToken to PROVE it is never called when password is wrong.
    const verifyTokenSpy = jest
      .spyOn(service, 'verifyToken')
      .mockReturnValue(true);

    await expect(
      service.disable(USER_ID, 'definitely-wrong', '123456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(verifyTokenSpy).not.toHaveBeenCalled();
    // And no update — user still has 2FA enabled.
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(user.twoFactorEnabled).toBe(true);
  });

  it('rejects when password is correct but TOTP is wrong', async () => {
    const verifyTokenSpy = jest
      .spyOn(service, 'verifyToken')
      .mockReturnValue(false);

    await expect(
      service.disable(USER_ID, PASSWORD, '000000'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(verifyTokenSpy).toHaveBeenCalledWith(TOTP_SECRET, '000000');
    expect(user.twoFactorEnabled).toBe(true);
  });

  it('disables 2FA when both password and TOTP are correct', async () => {
    const verifyTokenSpy = jest
      .spyOn(service, 'verifyToken')
      .mockReturnValue(true);

    const out = await service.disable(USER_ID, PASSWORD, '123456');

    expect(out).toEqual({ disabled: true });
    expect(verifyTokenSpy).toHaveBeenCalledWith(TOTP_SECRET, '123456');
    expect(user.twoFactorEnabled).toBe(false);
    expect(user.twoFactorSecret).toBeNull();
  });

  it('rejects when 2FA is not enabled on the user', async () => {
    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;

    await expect(
      service.disable(USER_ID, PASSWORD, '123456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(user.twoFactorEnabled).toBe(false);
  });

  it('rejects when user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null as unknown as StoredUser);
    await expect(
      service.disable('missing', PASSWORD, '123456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});