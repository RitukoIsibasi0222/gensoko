import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toastStore } from './toast.svelte';
import { ApiError } from '$lib/api/errors';

describe('ToastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // 各テスト前に store をクリアして状態をリセット
    toastStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('基本機能', () => {
    it('success("OK") で 1 件追加される', () => {
      const id = toastStore.success('OK');
      expect(toastStore.toasts).toHaveLength(1);
      expect(toastStore.toasts[0].variant).toBe('success');
      expect(toastStore.toasts[0].message).toBe('OK');
      expect(toastStore.toasts[0].id).toBe(id);
    });

    it('error("NG") の duration デフォルトが 6000ms', () => {
      toastStore.error('NG');
      expect(toastStore.toasts[0].duration).toBe(6000);
    });

    it('success / info / warning のデフォルトが 4000ms', () => {
      toastStore.success('S');
      toastStore.info('I');
      toastStore.warning('W');
      expect(toastStore.toasts[0].duration).toBe(4000); // success
      expect(toastStore.toasts[1].duration).toBe(4000); // info
      expect(toastStore.toasts[2].duration).toBe(4000); // warning
    });

    it('show() のオプションで duration 上書き', () => {
      toastStore.show('success', 'Test', { duration: 9999 });
      expect(toastStore.toasts[0].duration).toBe(9999);
    });

    it('show() 戻り値の id が追加されたトーストの id と一致', () => {
      const id = toastStore.success('Test');
      expect(toastStore.toasts.at(-1)?.id).toBe(id);
    });
  });

  describe('自動消去', () => {
    it('duration 経過後に自動削除される', () => {
      toastStore.success('Test'); // duration = 4000ms
      expect(toastStore.toasts).toHaveLength(1);

      vi.advanceTimersByTime(4000);
      expect(toastStore.toasts).toHaveLength(0);
    });

    it('duration: 0 指定時は自動消去されない', () => {
      toastStore.success('Persistent', { duration: 0 });
      expect(toastStore.toasts).toHaveLength(1);

      // 十分な時間を進めても削除されない
      vi.advanceTimersByTime(100000);
      expect(toastStore.toasts).toHaveLength(1);
    });
  });

  describe('手動削除', () => {
    it('dismiss(id) で該当トースト削除', () => {
      const id1 = toastStore.success('First');
      const id2 = toastStore.success('Second');
      expect(toastStore.toasts).toHaveLength(2);

      toastStore.dismiss(id1);
      expect(toastStore.toasts).toHaveLength(1);
      expect(toastStore.toasts[0].id).toBe(id2);
    });

    it('dismiss(id) で対応する setTimeout も clear される', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      const id = toastStore.success('Test');

      toastStore.dismiss(id);
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('clear() で全件削除 + 全タイマー破棄', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      toastStore.success('A');
      toastStore.error('B');
      toastStore.info('C');
      expect(toastStore.toasts).toHaveLength(3);

      toastStore.clear();
      expect(toastStore.toasts).toHaveLength(0);
      // 3 件のタイマーが clearTimeout された
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('スタック上限（最大 5 件）', () => {
    it('6 件目追加時に最古 1 件が押し出される', () => {
      const id1 = toastStore.success('1');
      toastStore.success('2');
      toastStore.success('3');
      toastStore.success('4');
      toastStore.success('5');
      expect(toastStore.toasts).toHaveLength(5);

      toastStore.success('6');
      expect(toastStore.toasts).toHaveLength(5);
      // 最古の id1 が消えている
      expect(toastStore.toasts.find((t) => t.id === id1)).toBeUndefined();
    });

    it('押し出された 1 件のタイマーも破棄される', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      toastStore.success('1');
      toastStore.success('2');
      toastStore.success('3');
      toastStore.success('4');
      toastStore.success('5');
      clearTimeoutSpy.mockClear(); // ここまでの呼び出しをクリア

      // 6 件目追加で押し出しが発生
      toastStore.success('6');
      // 押し出された 1 件のタイマーが clearTimeout された
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('fromApiError()', () => {
    it('ApiError から error トースト表示', () => {
      const error = new ApiError(400, 'Bad Request');
      toastStore.fromApiError(error);

      expect(toastStore.toasts).toHaveLength(1);
      expect(toastStore.toasts[0].variant).toBe('error');
      expect(toastStore.toasts[0].message).toBe('Bad Request');
      expect(toastStore.toasts[0].duration).toBe(6000); // error のデフォルト
    });

    it('ネットワークエラー（status=0）でも動作', () => {
      const error = new ApiError(0, 'Network Error');
      toastStore.fromApiError(error);

      expect(toastStore.toasts).toHaveLength(1);
      expect(toastStore.toasts[0].variant).toBe('error');
      expect(toastStore.toasts[0].message).toBe('Network Error');
    });

    it('fromApiError() でも duration オプションを上書き可能', () => {
      const error = new ApiError(500, 'Server Error');
      toastStore.fromApiError(error, { duration: 3000 });

      expect(toastStore.toasts[0].duration).toBe(3000);
    });
  });

  describe('ID のユニーク性', () => {
    it('連続 show() で発番される ID が全件ユニーク', () => {
      const ids: string[] = [];
      // 最大 5 件までしか保持されないが、発番自体は連続で行える
      // ここでは clear() しながら 100 件発番して確認する
      for (let i = 0; i < 100; i++) {
        const id = toastStore.success(`Test ${i}`);
        ids.push(id);
        if (i % 10 === 9) {
          toastStore.clear(); // 定期的にクリア
        }
      }
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(100);
    });
  });

  describe('ショートカットメソッド', () => {
    it('success() は variant="success" で追加', () => {
      toastStore.success('Success message');
      expect(toastStore.toasts[0].variant).toBe('success');
    });

    it('info() は variant="info" で追加', () => {
      toastStore.info('Info message');
      expect(toastStore.toasts[0].variant).toBe('info');
    });

    it('warning() は variant="warning" で追加', () => {
      toastStore.warning('Warning message');
      expect(toastStore.toasts[0].variant).toBe('warning');
    });

    it('error() は variant="error" で追加', () => {
      toastStore.error('Error message');
      expect(toastStore.toasts[0].variant).toBe('error');
    });
  });
});
