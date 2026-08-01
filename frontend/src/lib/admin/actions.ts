import type { AdminUserRole, AdminUserSummary } from '$lib/api/admin';

export type AdminListAction = 'status' | 'role' | 'delete';

export type AdminConfirmationAction =
  | { type: 'status'; nextIsActive: boolean }
  | { type: 'role'; nextRole: AdminUserRole }
  | { type: 'delete' };

export function getAdminActionBlockReason(
  user: AdminUserSummary,
  action: AdminListAction,
  currentUserId?: string
): string | null {
  if (user.id === currentUserId) {
    return '自分自身には管理操作を実行できません';
  }
  if (action === 'role') {
    if (!user.isActive) {
      return '停止中のユーザーはロール変更できません';
    }
    if (user.role === 'USER' && !user.emailVerified) {
      return 'メール未確認のユーザーは管理者にできません';
    }
  }
  return null;
}

export function createAdminConfirmationAction(
  user: AdminUserSummary,
  action: AdminListAction
): AdminConfirmationAction {
  if (action === 'status') {
    return { type: 'status', nextIsActive: !user.isActive };
  }
  if (action === 'role') {
    return { type: 'role', nextRole: user.role === 'USER' ? 'ADMIN' : 'USER' };
  }
  return { type: 'delete' };
}
