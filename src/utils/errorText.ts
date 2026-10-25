// src/utils/errorText.ts
// 抛出的错要拆成字段或者一句话的时候（放进一个对象、一条记录、界面上的一行字），从这里取：名字、那句话、
// 代号和调用栈，都是原文——只有凭据的值不是。日志能直接交 Error 本身的就直接交
// （console.warn('[模块] ...', error)）：开发者面板的会话日志和 DevTools 都会记下它的调用栈。

/** 凭据的值不进日志行：换成的占位符。 */
const REDACTED = '[redacted]';

// 键名像凭据的样子：apiKey / api_key / SOME_SERVICE_KEY / token / password …
const CREDENTIAL_NAME = '[A-Za-z0-9_-]*(?:api[\\s_-]?key|token|secret|password|passwd|pwd|credential|cookie|authorization|key)';

const REDACTION_RULES: [RegExp, string][] = [
    // 没有键名的 Bearer token。
    [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1' + REDACTED],
    // 常见服务签发的明文密钥形态：一眼能认出来的，值不会在日志里留全。
    [/\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g, REDACTED],
    // 带引号的整段值：JSON 里的字段、单引号参数里的串。
    [new RegExp('\\b(' + CREDENTIAL_NAME + ')(["\']?\\s*[:=]\\s*(?:bearer\\s+)?)(["\'])(?:(?!\\3).)*\\3', 'gi'), `$1$2$3${REDACTED}$3`],
    // 没有引号的值：到空格、引号、逗号、分号、& 或 } 为止（URL 的 ?token=…、环境变量式的 API_KEY=…）。
    // true/false/null/undefined 是开关不是凭据，留着。
    [new RegExp('\\b(' + CREDENTIAL_NAME + ')(["\']?\\s*[:=]\\s*(?:bearer\\s+)?)(?!(?:true|false|null|undefined)(?![A-Za-z0-9_-]))(?=[^\\s"\',;&}])[^\\s"\',;&}]+', 'gi'), '$1$2' + REDACTED],
];

/** 把一句话里凭据的值换成占位符；别的字一个不动。errorMessage 与 errorFields 交出去的文本都先过这里。 */
export const redactSecretValues = (text: string): string => REDACTION_RULES.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text,
);

/**
 * 抛出来的东西的原话。一个错自己没有话（AggregateError）：是它里面第一个错的话，或者 cause 的话。
 * 抛的不是错而是一个对象（一个 adapter 把平台的回答原样抛了）：是它的 JSON。
 */
const rawErrorMessage = (thrown: unknown): string => {
    if (thrown instanceof Error) {
        if (thrown.message) return thrown.message;
        const { errors, cause } = thrown as { errors?: unknown; cause?: unknown };
        const inside = Array.isArray(errors) ? errors[0] : cause;
        return inside instanceof Error ? inside.message : '';
    }
    if (typeof thrown !== 'object' || thrown === null) return String(thrown);
    try {
        return JSON.stringify(thrown) ?? Object.prototype.toString.call(thrown);
    } catch {
        return Object.prototype.toString.call(thrown);
    }
};

/** 抛出来的东西的那句话，凭据的值已隐去。 */
export const errorMessage = (thrown: unknown): string => redactSecretValues(rawErrorMessage(thrown));

/** 一个代号或者状态码：字符串原样，数转成字符串，别的没有。 */
export const codeText = (value: unknown): string | undefined => (
    typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
);

/**
 * 一个抛出的错拆成字段：名字、那句话、代号和调用栈（后两样有才带）。放进一个对象里打日志时用它：
 * 对象里的 Error 本身在会话日志里会被 JSON 化成 {}。那句话里的凭据已经隐去，名字、代号、调用栈是原文。
 */
export const errorFields = (thrown: unknown): { name: string; message: string; code?: string; stack?: string } => {
    const { name, code, stack } = (thrown instanceof Error ? thrown : {}) as { name?: unknown; code?: unknown; stack?: unknown };
    const held = codeText(code);
    return {
        name: typeof name === 'string' && name ? name : 'Error',
        message: errorMessage(thrown),
        ...(held !== undefined ? { code: held } : {}),
        ...(typeof stack === 'string' && stack ? { stack } : {}),
    };
};
