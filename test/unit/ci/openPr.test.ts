// test/unit/ci/openPr.test.ts
// 提 PR 脚本里唯一值得单测的纯逻辑：从 origin 的 URL 认出 GitHub 的 owner/repo（HTTPS / SSH 都认）。

import { describe, expect, it } from 'vitest';
import { githubRepoFromRemote } from '../../../ci/openPr.ts';

describe('从 origin URL 解析 GitHub 仓库', () => {
    it('HTTPS 写法', () => {
        expect(githubRepoFromRemote('https://github.com/maimai993/folia-sonnet.git')).toEqual({ owner: 'maimai993', repo: 'folia-sonnet' });
        expect(githubRepoFromRemote('https://github.com/maimai993/folia-sonnet')).toEqual({ owner: 'maimai993', repo: 'folia-sonnet' });
    });

    it('SSH 写法（git@ 与 ssh:// 都认）', () => {
        expect(githubRepoFromRemote('git@github.com:maimai993/folia-sonnet.git')).toEqual({ owner: 'maimai993', repo: 'folia-sonnet' });
        expect(githubRepoFromRemote('ssh://git@github.com/maimai993/folia-sonnet.git')).toEqual({ owner: 'maimai993', repo: 'folia-sonnet' });
    });

    it('不是 GitHub 就返回 null', () => {
        expect(githubRepoFromRemote('https://gitlab.com/o/r.git')).toBeNull();
        expect(githubRepoFromRemote('/local/path/repo')).toBeNull();
    });
});
