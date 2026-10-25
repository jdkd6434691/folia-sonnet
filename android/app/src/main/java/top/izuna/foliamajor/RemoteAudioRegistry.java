package top.izuna.foliamajor;

import java.io.IOException;
import java.net.URL;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

// 远端资源注册表：凭据绑定精确 origin，回环 token 不包含 URL/凭据，也不跨注册复用。
final class RemoteAudioRegistry {
    static final class Entry {
        final String url;
        final Map<String, String> headers;

        Entry(String url, Map<String, String> headers) {
            this.url = url;
            this.headers = headers == null ? Collections.emptyMap()
                : Collections.unmodifiableMap(new HashMap<>(headers));
        }

        boolean allowsRedirects() {
            // 不让带自定义头的请求由 HTTP 客户端自动把凭据带往重定向目标。
            return headers.isEmpty();
        }
    }

    private final Map<String, Entry> entries = new LinkedHashMap<>();

    static void validateOrigin(String value, String credentialOrigin) throws IOException {
        URL target = new URL(value);
        URL origin = new URL(credentialOrigin);
        if (!("http".equals(target.getProtocol()) || "https".equals(target.getProtocol()))
            || target.getHost().isEmpty() || target.getUserInfo() != null || origin.getUserInfo() != null
            || !target.getProtocol().equals(origin.getProtocol())
            || !target.getHost().equalsIgnoreCase(origin.getHost())
            || effectivePort(target) != effectivePort(origin)
            || !(origin.getPath().isEmpty() || "/".equals(origin.getPath()))
            || origin.getQuery() != null || origin.getRef() != null) {
            throw new IOException("Remote resource origin mismatch");
        }
    }

    private static int effectivePort(URL url) {
        return url.getPort() == -1 ? url.getDefaultPort() : url.getPort();
    }

    synchronized String register(String url, Map<String, String> headers) {
        String token = UUID.randomUUID().toString();
        entries.put(token, new Entry(url, headers));
        while (entries.size() > 128) entries.remove(entries.keySet().iterator().next());
        return token;
    }

    synchronized String registerReusable(String url, Map<String, String> headers) {
        Map<String, String> snapshot = headers == null ? Collections.emptyMap() : headers;
        String existing = null;
        for (Map.Entry<String, Entry> registered : entries.entrySet()) {
            Entry entry = registered.getValue();
            if (entry.url.equals(url) && entry.headers.equals(snapshot)) {
                existing = registered.getKey();
                break;
            }
        }
        if (existing != null) {
            Entry entry = entries.remove(existing);
            entries.put(existing, entry);
            return existing;
        }
        return register(url, headers);
    }

    synchronized Entry get(String token) {
        return entries.get(token);
    }

    synchronized void remove(String token) {
        entries.remove(token);
    }
}
