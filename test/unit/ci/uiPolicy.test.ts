// test/unit/ci/uiPolicy.test.ts
// UI 门禁的两条规则：手写控件与 800 行上限。CI 的 ui-gates job 跑的是同一份实现。

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { MAX_LINES, countControlsIn, countLines, scanControls, scanSizes } from '../../../ci/uiPolicy.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('手写控件计数', () => {
    it('只数真实标签，大小写与相似标签不算', () => {
        const counts = countControlsIn('<button/><Button /><buttonish /><input /><select></select><textarea />');
        expect(counts).toEqual({ button: 1, input: 1, select: 1, textarea: 1 });
    });

    it('多行标签也算', () => {
        const counts = countControlsIn('<button\n  type="button"\n  onClick={f}\n>');
        expect(counts.button).toBe(1);
    });
});

describe('门禁阈值', () => {
    it('行数上限是 800', () => {
        expect(MAX_LINES).toBe(800);
    });

    it('行数不把文件末尾的换行算成一行', () => {
        expect(countLines('a\nb\n')).toBe(2);
        expect(countLines('a\nb')).toBe(2);
        expect(countLines('')).toBe(0);
    });
});

describe('仓库当前状态', () => {
    it('没有新增手写控件', () => {
        expect(scanControls(repoRoot)).toEqual([]);
    });

    it('没有超过 800 行且不在基线里的文件', () => {
        expect(scanSizes(repoRoot)).toEqual([]);
    });
});
