import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn, Loader2 } from 'lucide-react';
import type { LibraryPasswordLoginError } from '../../../library/core/account/account.contract';
import type { LoginPasswordField, PasswordLoginCredentials } from '../../../types/onlineMusic';
import { FIELD_CLASS } from '../../modal/settings/kit/TextField';
import { Button, TextField } from '../../ui';

// src/components/login/window/PasswordLoginForm.tsx
// 密码登录的表单（没有二维码的自建服务：地址 + 用户名 + 密码）。
// 第一栏问什么由选中的登录方式说（`field` 是它给的两个 i18n key）：有的要知道整条地址，
// 有的只要一个 ID。这一层不认得任何一种方式，只是照着翻译。
// 三个框自己持有状态：提交失败时用户改过的东西必须还在，而登录快照一变整个表单都会重渲染。
// 提交走账户 controller 的 submitPasswordLogin，失败原因由快照的 `passwordForm.error` 带回来，
// 界面按它给一句能照做的提示（不是统一的「登录失败」）。

/** 提交失败的那一种 → 说哪一句。 */
const ERROR_KEY: Record<LibraryPasswordLoginError, string> = {
    'invalid-credentials': 'home.loginPasswordInvalidCredentials',
    network: 'home.loginPasswordNetwork',
    unavailable: 'home.loginPasswordUnavailable',
    'web-login-required': 'home.loginPasswordWebLoginRequired',
    refresh: 'home.loginPasswordRefreshFailed',
    unknown: 'home.loginPasswordFailed',
};

export type PasswordLoginFormProps = {
    /** 表单要先填服务器地址：自建服务每家地址不同，写不进构建期配置。 */
    needsServerUrl: boolean;
    /**
     * 那一栏要问什么（标签与占位符的 i18n key）：多方式登录时由选中的那一种给 —— 同一张表单上，
     * 「只要一个 ID」与「要整条地址」是两种问法。没有时用共用的那两句。界面不知道哪一种是哪一家。
     */
    field?: LoginPasswordField | null;
    /** 上次填过的服务器地址（登出不清地址，重登时少填一项）。 */
    serverUrl: string;
    /** 上一次提交失败的原因；还没提交过或上次成功了为 null。 */
    error: LibraryPasswordLoginError | null;
    /** 这一次提交正在路上：按钮转圈，三个框锁住。 */
    busy: boolean;
    onSubmit: (credentials: PasswordLoginCredentials) => void;
};

export const PasswordLoginForm: React.FC<PasswordLoginFormProps> = ({ needsServerUrl, field, serverUrl, error, busy, onSubmit }) => {
    const { t } = useTranslation();
    const [url, setUrl] = useState(serverUrl);
    const [username, setUsername] = useState('');
    const [secret, setSecret] = useState('');
    const usernameRef = useRef<HTMLInputElement | null>(null);
    // 每次打开都是新的一次登录：焦点落在第一个要填的框上。
    useEffect(() => { usernameRef.current?.focus({ preventScroll: true }); }, []);

    const canSubmit = !busy && username.trim().length > 0 && secret.length > 0
        && (!needsServerUrl || url.trim().length > 0);
    const submit = () => {
        if (!canSubmit) return;
        onSubmit({
            ...(needsServerUrl ? { serverUrl: url.trim() } : {}),
            username: username.trim(),
            password: secret,
        });
    };

    return (
        <form
            className="login-password flex min-w-0 flex-col gap-2"
            data-folia-login-password="true"
            onSubmit={event => { event.preventDefault(); submit(); }}
        >
            {needsServerUrl && (
                <label className="flex flex-col gap-1">
                    <span className="text-xs text-[color:var(--st-t2)]">{t(field?.labelKey ?? 'home.loginServerUrl')}</span>
                    <TextField
                        type="text"
                        className={`${FIELD_CLASS} w-full px-2.5`}
                        value={url}
                        disabled={busy}
                        onChange={event => setUrl(event.target.value)}
                        placeholder={field?.placeholderKey ? t(field.placeholderKey) : t('home.loginServerUrlPlaceholder')}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                </label>
            )}
            <label className="flex flex-col gap-1">
                <span className="text-xs text-[color:var(--st-t2)]">{t('home.loginUsername')}</span>
                <TextField
                    ref={usernameRef}
                    type="text"
                    className={`${FIELD_CLASS} w-full px-2.5`}
                    value={username}
                    disabled={busy}
                    onChange={event => setUsername(event.target.value)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            </label>
            <label className="flex flex-col gap-1">
                <span className="text-xs text-[color:var(--st-t2)]">{t('home.loginPassword')}</span>
                <TextField
                    type="password"
                    className={`${FIELD_CLASS} w-full px-2.5`}
                    value={secret}
                    disabled={busy}
                    onChange={event => setSecret(event.target.value)}
                />
            </label>
            {error && (
                <p className="text-xs leading-[18px] text-[color:var(--st-err)]" role="alert">{t(ERROR_KEY[error])}</p>
            )}
            {/* 原生的 submit：回车（手机上键盘的「前往」）也能提交，不只是点一下。 */}
            <Button
                type="submit"
                disabled={!canSubmit}
                className="st-t-fast mt-0.5 inline-flex h-8 shrink-0 items-center justify-center gap-1.5 self-start whitespace-nowrap rounded-lg bg-[var(--st-accent)] px-3 text-[13px] text-[color:var(--st-on-accent)] transition-[background-color,color,opacity,scale] enabled:active:scale-[0.97] enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
                {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <LogIn size={14} aria-hidden />}
                {t(busy ? 'home.loggingIn' : 'home.loginSubmit')}
            </Button>
        </form>
    );
};

export default PasswordLoginForm;
