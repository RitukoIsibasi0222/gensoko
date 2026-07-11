import { describe, expect, it } from 'vitest';
import type { AdminUserSummary } from '$lib/api/admin';
import { createAdminConfirmationAction, getAdminActionBlockReason } from './actions';

const USER: AdminUserSummary = {
  id: 'user-1',
  username: 'taro',
  email: 'taro@example.com',
  role: 'USER',
  emailVerified: true,
  isActive: true,
  deletedAt: null,
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-10T10:00:00.000Z'
};

describe('admin actions', () => {
  it('自分自身と退会済みユーザーの全管理操作を禁止する', () => {
    for (const action of ['status', 'role', 'delete'] as const) {
      expect(getAdminActionBlockReason(USER, action, USER.id)).toBe(
        '自分自身には管理操作を実行できません'
      );
      expect(
        getAdminActionBlockReason(
          { ...USER, deletedAt: '2026-07-11T00:00:00.000Z' },
          action,
          'admin-1'
        )
      ).toBe('退会済みユーザーは変更できません');
    }
  });

  it('停止中またはメール未確認USERのrole変更だけを禁止する', () => {
    expect(getAdminActionBlockReason({ ...USER, isActive: false }, 'role', 'admin-1')).toBe(
      '停止中のユーザーはロール変更できません'
    );
    expect(getAdminActionBlockReason({ ...USER, emailVerified: false }, 'role', 'admin-1')).toBe(
      'メール未確認のユーザーは管理者にできません'
    );
    expect(
      getAdminActionBlockReason({ ...USER, emailVerified: false }, 'status', 'admin-1')
    ).toBeNull();
  });

  it('最新user状態から明示的な変更先を生成する', () => {
    expect(createAdminConfirmationAction(USER, 'status')).toEqual({
      type: 'status',
      nextIsActive: false
    });
    expect(createAdminConfirmationAction({ ...USER, isActive: false }, 'status')).toEqual({
      type: 'status',
      nextIsActive: true
    });
    expect(createAdminConfirmationAction(USER, 'role')).toEqual({
      type: 'role',
      nextRole: 'ADMIN'
    });
  });
});
