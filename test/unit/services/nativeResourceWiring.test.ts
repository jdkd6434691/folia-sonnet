import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 不启动 Android；核对纯 Java 策略确实接到生产 OkHttp/插件出口。
const javaRoot = new URL('../../../android/app/src/main/java/top/izuna/foliamajor/', import.meta.url);
const server = readFileSync(new URL('LocalAudioServer.java', javaRoot), 'utf8');
const plugin = readFileSync(new URL('FoliaNativePlugin.java', javaRoot), 'utf8');

describe('native resource policy wiring (static)', () => {
    it('disables both redirect modes for credential requests, retaining normal CDN redirects', () => {
        expect(server).toMatch(/credentialResourceClient = remoteAudioClient\.newBuilder\(\)\s*\.followRedirects\(false\)\s*\.followSslRedirects\(false\)/);
        expect(server).toContain('entry.allowsRedirects() ? remoteAudioClient : credentialResourceClient');
        expect(server).toContain('Response upstream = client.newCall(request.build()).execute()');
    });

    it('validates origin before scoped registration and exposes explicit revoke support', () => {
        expect(server).toMatch(/RemoteAudioRegistry\.validateOrigin\(value, origin\);\s*return registerRemoteAudio\(value, headers, true, false\)/);
        expect(server).toContain('remoteAudioRegistry.remove(');
        expect(plugin).toContain('public void registerScopedRemoteAudio(PluginCall call)');
        expect(plugin).toContain('public void unregisterRemoteAudio(PluginCall call)');
        expect(plugin).toContain('localAudioServer.registerScopedRemoteAudio(url, headers, credentialOrigin)');
    });
});
