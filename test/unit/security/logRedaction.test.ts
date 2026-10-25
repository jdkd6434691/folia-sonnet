import { describe, expect, it } from 'vitest';
import { errorFields, errorMessage } from '@/utils/errorText';

// test/unit/security/logRedaction.test.ts
// 日志里不能出现凭据的值：errorMessage / errorFields 交出去的那句话要先把 key/token 一类的值隐去，
// 别的字（错误原文、代号、路径、开关）保持原样，排查靠的正是它们。

const HIDDEN = '[redacted]';

describe('errorMessage 里的凭据', () => {
    it('隐去键名像凭据的字段的值，键名和别的字段留着', () => {
        expect(errorMessage({ apiKey: 'sk-live-abcdefghijklmnopqrstuvwxyz', model: 'gpt-5' }))
            .toBe('{"apiKey":"' + HIDDEN + '","model":"gpt-5"}');
        expect(errorMessage({ OPENAI_API_KEY: 'abcdefgh12345678', size: 2 }))
            .toBe('{"OPENAI_API_KEY":"' + HIDDEN + '","size":2}');
        expect(errorMessage('{"password":"hunter2","user":"a"}')).toBe('{"password":"' + HIDDEN + '","user":"a"}');
    });

    it('隐去 URL 查询串里的 token 与 Authorization 里的 Bearer 值', () => {
        expect(errorMessage(new Error('GET https://api.example.com/v1?token=abc123&page=2 failed')))
            .toBe('GET https://api.example.com/v1?token=' + HIDDEN + '&page=2 failed');
        expect(errorMessage(new Error('Authorization: Bearer abcdefghijklmnop.qrstuv')))
            .toBe('Authorization: Bearer ' + HIDDEN);
        expect(errorMessage(new Error('rejected with Bearer abcdefghijklmnop'))).toBe('rejected with Bearer ' + HIDDEN);
    });

    it('隐去常见形态的明文密钥', () => {
        expect(errorMessage(new Error('Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuvwxyz')))
            .toBe('Incorrect API key provided: ' + HIDDEN);
        expect(errorMessage('GEMINI_API_KEY=AIzaSyabcdefghijklmnopqrstuvwxyz012345')).toBe('GEMINI_API_KEY=' + HIDDEN);
        expect(errorMessage(new Error('bad token ghp_abcdefghijklmnopqrstuvwxyz0123456789'))).toBe('bad token ' + HIDDEN);
    });

    it('别的字一个不动：路径、代号、开关、长文本', () => {
        const said = "EPERM: operation not permitted, open 'C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\key'";
        expect(errorMessage(new Error(said))).toBe(said);
        expect(errorMessage({ code: 301, msg: 'need login', hasToken: false })).toBe('{"code":301,"msg":"need login","hasToken":false}');
        expect(errorMessage({ hasPassword: null })).toBe('{"hasPassword":null}');
        expect(errorMessage(new Error('x'.repeat(1000)))).toHaveLength(1000);
    });
});

describe('errorFields 里的凭据', () => {
    it('隐去那句话里的凭据，名字、代号、调用栈是原文', () => {
        const error = Object.assign(new TypeError('bad answer for token=abc123'), { code: 'ECONNRESET' });
        const fields = errorFields(error);
        expect(fields).toEqual({ name: 'TypeError', message: 'bad answer for token=' + HIDDEN, code: 'ECONNRESET', stack: error.stack });
    });

    it('抛出的对象（平台原样抛回来的回答）同样隐去', () => {
        expect(errorFields({ apiKey: 'sk-live-abcdefghijklmnopqrstuvwxyz' }))
            .toEqual({ name: 'Error', message: '{"apiKey":"' + HIDDEN + '"}' });
    });
});
