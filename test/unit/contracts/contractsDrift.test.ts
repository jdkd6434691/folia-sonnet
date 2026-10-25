// test/unit/contracts/contractsDrift.test.ts
// 契约漂移：preload 暴露面、sync-server 路由、omni provider 注册表改了而 docs/contracts/manifest 没跟上时，
// 这里先红。确认改动后跑 node ci/contracts/extract.ts --update，把 manifest 的 diff 一起提交。
// CI 的 test-unit 会跑到本文件，所以新增契约不需要再改 workflow。

import { describe, expect, it } from 'vitest';
import {
    buildOmniProvidersManifest,
    buildPreloadManifest,
    buildSyncServerRoutesManifest,
    manifestFile,
    readManifest,
} from '../../../ci/contracts/extract.ts';

type ManifestName = 'preload' | 'sync-server-routes' | 'omni-providers';

const hint = (name: ManifestName): string => (
    `已提交的 ${manifestFile(name)} 与当前实现不一致。确认改动后跑 node ci/contracts/extract.ts --update，并把 manifest 的 diff 一起提交。`
);

describe('契约 manifest 与当前实现一致', () => {
    it('preload 暴露面', () => {
        expect(buildPreloadManifest(), hint('preload')).toEqual(readManifest('preload'));
    });

    it('sync-server 路由', () => {
        expect(buildSyncServerRoutesManifest(), hint('sync-server-routes')).toEqual(readManifest('sync-server-routes'));
    });

    it('omni provider 注册表', () => {
        expect(buildOmniProvidersManifest(), hint('omni-providers')).toEqual(readManifest('omni-providers'));
    });
});
