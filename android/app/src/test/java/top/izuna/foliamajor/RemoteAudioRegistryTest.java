package top.izuna.foliamajor;

import org.junit.Test;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import static org.junit.Assert.*;

// 纯 JVM 合成测试，不启动 Android、不创建 socket。
public class RemoteAudioRegistryTest {
    @Test public void acceptsOnlyExactHttpOrigin() throws Exception {
        RemoteAudioRegistry.validateOrigin("https://nas.synthetic.test:443/image", "https://NAS.synthetic.test");
        RemoteAudioRegistry.validateOrigin("http://nas.synthetic.test:5666/image", "http://nas.synthetic.test:5666");
        String[] rejected = {
            "https://other.synthetic.test/image", "http://nas.synthetic.test/image",
            "https://nas.synthetic.test:8443/image", "https://synthetic@nas.synthetic.test/image",
            "https://nas.synthetic.test.other.test/image", "file:///image"
        };
        for (String target : rejected) {
            try {
                RemoteAudioRegistry.validateOrigin(target, "https://nas.synthetic.test");
                fail("Origin mismatch accepted");
            } catch (IOException expected) { }
        }
    }

    @Test public void rejectsAnOriginContainingPathOrCredentials() throws Exception {
        for (String origin : new String[] {
            "https://nas.synthetic.test/path", "https://synthetic@nas.synthetic.test",
            "https://nas.synthetic.test?synthetic", "https://nas.synthetic.test#synthetic"
        }) {
            try {
                RemoteAudioRegistry.validateOrigin("https://nas.synthetic.test/image", origin);
                fail("Non-origin accepted");
            } catch (IOException expected) { }
        }
    }

    @Test public void usesDistinctOpaqueTokensAndImmutableHeaderSnapshots() {
        RemoteAudioRegistry registry = new RemoteAudioRegistry();
        Map<String, String> headers = new HashMap<>();
        headers.put("Cookie", "SYNTHETIC_A");
        String first = registry.register("https://nas.synthetic.test/image", headers);
        headers.put("Cookie", "SYNTHETIC_B");
        String second = registry.register("https://nas.synthetic.test/image", headers);
        assertNotEquals(first, second);
        assertEquals("SYNTHETIC_A", registry.get(first).headers.get("Cookie"));
        assertEquals("SYNTHETIC_B", registry.get(second).headers.get("Cookie"));
        assertFalse(registry.get(first).allowsRedirects());
        registry.remove(first);
        assertNull(registry.get(first));
        assertNotNull(registry.get(second));
    }

    @Test public void boundsCapacityAndKeepsPlainCdnRedirects() {
        RemoteAudioRegistry registry = new RemoteAudioRegistry();
        String oldest = registry.register("https://cdn.synthetic.test/audio", null);
        for (int index = 0; index < 128; index++) registry.register("https://cdn.synthetic.test/audio", null);
        assertNull(registry.get(oldest));
        String latest = registry.register("https://cdn.synthetic.test/audio", null);
        assertTrue(registry.get(latest).allowsRedirects());
    }

    @Test public void repeatedAudioRegistrationDoesNotExhaustCapacityOrRebindCredentials() {
        RemoteAudioRegistry registry = new RemoteAudioRegistry();
        Map<String, String> firstHeaders = new HashMap<>();
        firstHeaders.put("Cookie", "SYNTHETIC_A");
        String playing = registry.registerReusable("https://nas.synthetic.test/audio", firstHeaders);
        for (int i = 0; i < 1000; i++) {
            assertEquals(playing, registry.registerReusable("https://nas.synthetic.test/audio", firstHeaders));
        }
        Map<String, String> nextHeaders = new HashMap<>();
        nextHeaders.put("Cookie", "SYNTHETIC_B");
        String next = registry.registerReusable("https://nas.synthetic.test/audio", nextHeaders);
        assertNotEquals(playing, next);
        assertEquals("SYNTHETIC_A", registry.get(playing).headers.get("Cookie"));
        assertEquals("SYNTHETIC_B", registry.get(next).headers.get("Cookie"));
    }

    @Test public void reusingAudioRefreshesItsEvictionOrder() {
        RemoteAudioRegistry registry = new RemoteAudioRegistry();
        String playing = registry.registerReusable("https://cdn.synthetic.test/playing", null);
        String oldestUnused = registry.registerReusable("https://cdn.synthetic.test/oldest-unused", null);
        for (int i = 0; i < 126; i++) registry.registerReusable("https://cdn.synthetic.test/unique-" + i, null);
        assertEquals(playing, registry.registerReusable("https://cdn.synthetic.test/playing", null));
        registry.registerReusable("https://cdn.synthetic.test/new", null);
        assertNotNull(registry.get(playing));
        assertNull(registry.get(oldestUnused));
    }

    @Test public void revokingAnOldRegistrationNeverRevokesItsReplacement() throws Exception {
        RemoteAudioRegistry registry = new RemoteAudioRegistry();
        String old = registry.register("https://nas.synthetic.test/image", null);
        Thread revoke = new Thread(() -> { for (int i = 0; i < 1000; i++) registry.remove(old); });
        revoke.start();
        String replacement = registry.register("https://nas.synthetic.test/image", null);
        revoke.join();
        assertNull(registry.get(old));
        assertNotNull(registry.get(replacement));
    }
}
