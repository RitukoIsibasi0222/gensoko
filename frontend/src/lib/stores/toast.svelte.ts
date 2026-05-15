import { ApiError } from '$lib/api/errors';

/**
 * トーストの種類。
 * - success: 成功メッセージ（緑）
 * - error: エラーメッセージ（赤）
 * - info: 情報メッセージ（青）
 * - warning: 警告メッセージ（黄）
 */
export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

/**
 * スタック表示用の 1 件分のトーストデータ（読み取り専用）。
 */
export type Toast = {
    /** トーストの一意識別子（crypto.randomUUID() で発番） */
    readonly id: string;
    /** トーストの種類 */
    readonly variant: ToastVariant;
    /** 表示するメッセージ本文 */
    readonly message: string;
    /**
     * 表示時間（ミリ秒）。
     * - 0 の場合は自動消去しない（手動 dismiss 専用）
     * - 正の値の場合は duration 経過後に自動削除される
     */
    readonly duration: number;
};

/**
 * show() / 各ショートカットで指定できるオプション。
 */
export type ToastOptions = {
    /**
     * 表示時間（ミリ秒）。
     * - 省略時は variant ごとのデフォルト値が使用される
     * - 0 を指定すると自動消去されない
     */
    duration?: number;
};

/**
 * 内部でタイマーハンドルを保持するための拡張型。
 * 外部には公開しない。
 */
type InternalToast = Toast & {
    timerId: ReturnType<typeof setTimeout> | null;
};

/** variant ごとのデフォルト表示時間（ミリ秒） */
const DEFAULT_DURATION: Record<ToastVariant, number> = {
    success: 4000,
    info: 4000,
    warning: 4000,
    error: 6000
};

/** スタックの最大件数 */
const MAX_TOASTS = 5;

/**
 * トースト通知の singleton store。
 * - Svelte 5 Runes（$state）でリアクティブな toasts 配列を保持する
 * - タイマー（setTimeout）は store 内で管理し、dismiss 時に clearTimeout する
 * - 最大 5 件まで保持し、超過時は最も古い 1 件を押し出す
 */
class ToastStore {
    /**
     * 内部状態。タイマーハンドルも含めて管理する。
     */
    #toasts = $state<InternalToast[]>([]);

    /**
     * 現在表示中のトースト一覧（古い順）。
     * 外部には timerId を含まない読み取り専用の Toast[] として公開する。
     */
    get toasts(): readonly Toast[] {
        return this.#toasts;
    }

    /**
     * トーストを追加する。返り値は追加されたトーストの id。
     *
     * @param variant - トーストの種類
     * @param message - 表示するメッセージ
     * @param options - 表示オプション（duration 等）
     * @returns 追加されたトーストの id
     */
    show(variant: ToastVariant, message: string, options?: ToastOptions): string {
        const id = crypto.randomUUID();
        const duration = options?.duration ?? DEFAULT_DURATION[variant];

        const toast: InternalToast = {
            id,
            variant,
            message,
            duration,
            timerId: null
        };

        // スタックに追加
        this.#toasts.push(toast);

        // 最大件数を超えたら最古の 1 件を押し出す
        if (this.#toasts.length > MAX_TOASTS) {
            const removed = this.#toasts.shift();
            if (removed && removed.timerId !== null) {
                clearTimeout(removed.timerId);
            }
        }

        // duration > 0 の場合はタイマーを設定（ブラウザ環境のみ）
        if (duration > 0 && typeof window !== 'undefined') {
            toast.timerId = setTimeout(() => {
                this.dismiss(id);
            }, duration);
        }

        return id;
    }

    /**
     * success トーストを表示（duration デフォルト 4000ms）。
     */
    success(message: string, options?: ToastOptions): string {
        return this.show('success', message, options);
    }

    /**
     * info トーストを表示（duration デフォルト 4000ms）。
     */
    info(message: string, options?: ToastOptions): string {
        return this.show('info', message, options);
    }

    /**
     * warning トーストを表示（duration デフォルト 4000ms）。
     */
    warning(message: string, options?: ToastOptions): string {
        return this.show('warning', message, options);
    }

    /**
     * error トーストを表示（duration デフォルト 6000ms）。
     */
    error(message: string, options?: ToastOptions): string {
        return this.show('error', message, options);
    }

    /**
     * ApiError から error トーストを表示する。
     * message に error.message を使う。
     *
     * @param error - ApiError インスタンス
     * @param options - 表示オプション（duration 等）
     * @returns 追加されたトーストの id
     */
    fromApiError(error: ApiError, options?: ToastOptions): string {
        return this.error(error.message, options);
    }

    /**
     * 指定 ID のトーストを即時削除する（タイマーも clearTimeout する）。
     *
     * @param id - 削除するトーストの id
     */
    dismiss(id: string): void {
        const index = this.#toasts.findIndex((t) => t.id === id);
        if (index === -1) return;

        const [removed] = this.#toasts.splice(index, 1);
        if (removed.timerId !== null) {
            clearTimeout(removed.timerId);
        }
    }

    /**
     * すべてのトーストを削除する（タイマーも全 clearTimeout する）。
     */
    clear(): void {
        // 配列を変更しながら走査すると添字がずれるため、コピーしてからループ
        const toastsCopy = [...this.#toasts];
        for (const toast of toastsCopy) {
            if (toast.timerId !== null) {
                clearTimeout(toast.timerId);
            }
        }
        this.#toasts = [];
    }
}

/**
 * トースト通知 store のシングルトンインスタンス。
 * 全コンポーネントから同じインスタンスを参照する。
 */
export const toastStore = new ToastStore();
