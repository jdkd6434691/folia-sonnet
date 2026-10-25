package top.izuna.foliamajor;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * 本地音频流服务器。
 *
 * 三种来源：
 *   /audio/<MediaStore id>          系统媒体库里的文件
 *   /audio/imported-<file name>     通过系统文件管理器挑选后复制进 App 私有目录的文件
 *   /video-layer/<anything>         歌词后方视频层那一个视频（VideoLayerFile 的私有副本）
 *
 * WebView 的 <audio> / <video> 播不了 content:// 这种 URI，也不认 App 私有目录里的路径，
 * 所以原生起一个只监听 127.0.0.1 的小服务，把音频以 http 的形式喂回去。
 * 必须支持 Range：<audio> 拖进度、以及某些格式要先读文件尾部的元数据，都靠它。
 */
final class LocalAudioServer {
    private static final String TAG = "LocalAudioServer";
    private static final String AUDIO_PATH_PREFIX = "/audio/";
    private static final String REMOTE_AUDIO_PATH_PREFIX = "/remote-audio/";
    private static final String VIDEO_LAYER_PATH_PREFIX = "/video-layer/";
    /*
     * 媒体缓存（在线歌的本地副本）存放的那一路。
     *
     * 以前这些字节躺在 WebView 的 IndexedDB 里，取出来只能变成 blob: 地址，而原生播放器
     * 吃不下 blob: —— 于是「有缓存的歌」恰恰是原生播放接管的那些，反而整首回落到 <audio>。
     * 现在副本写进 App 私有目录，播放时拿回环地址，ExoPlayer 和 <audio> 都能读。
     */
    private static final String MEDIA_CACHE_PATH_PREFIX = "/media-cache/";
    private static final String IMPORTED_PREFIX = "imported-";
    /** 直接按绝对路径流原文件的 ref 前缀（文件系统兜底扫描出来的歌，不复制进私有目录）。 */
    private static final String FILE_PREFIX = "file-";
    /*
     * 只能代哪些主机的远端音频。
     *
     * 这个服务监听在 127.0.0.1 上，设备上任何应用都能连上来 —— 放行任意 URL 就等于
     * 开了一个「任读全网」的口子，所以按主机白名单收口。目前只有 Kuwo（波点）需要它：
     * 它的 CDN 不下发 CORS 头，而 <audio> 带 crossOrigin="anonymous"，
     * 于是播放被同源策略挡掉（表现是 MEDIA_ELEMENT_ERROR: Format error）。
     */
    private static final String[] REMOTE_AUDIO_HOST_SUFFIXES = { "kuwo.cn", "music.126.net" };
    private static final String REMOTE_AUDIO_USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
    private static final String REMOTE_AUDIO_REFERER = "https://www.kuwo.cn/";
    private static final String NETEASE_REMOTE_AUDIO_REFERER = "https://music.163.com/";
    private final Context context;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final OkHttpClient remoteAudioClient = new OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(true)
        .build();
    private final OkHttpClient credentialResourceClient = remoteAudioClient.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .build();
    private final RemoteAudioRegistry remoteAudioRegistry = new RemoteAudioRegistry();
    private ServerSocket serverSocket;
    private int port;

    LocalAudioServer(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized int start() throws IOException {
        if (serverSocket != null && !serverSocket.isClosed()) return port;
        // 端口交给系统分配（0）：写死一个的话，被别的进程占了就起不来，
        // 而每次启动拿到的端口都可能不同，所以 URL 不能持久化，播放前要重新拼（见插件的 localAudioServerPort）。
        serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        executor.execute(() -> {
            while (!serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    executor.execute(() -> handle(socket));
                } catch (IOException ignored) {
                    Log.i(TAG, "server socket closed, stopping accept loop");
                    break;
                }
            }
        });
        return port;
    }

    int getPort() {
        return port;
    }

    /**
     * 把一个远端音频地址挂到本地服务上，返回 `http://127.0.0.1:<port>/remote-audio/<token>`。
     *
     * 为什么要绕这一圈：<audio> 带 crossOrigin="anonymous"，而 Kuwo（波点）的 CDN
     * 根本不下发 Access-Control-Allow-Origin —— 请求连字节都拿不到，报出来却是
     * 一句毫无特征的 "MEDIA_ELEMENT_ERROR: Format error" / "The element has no supported sources"。
     * 本地服务回包带 ACAO: *，同源检查就过了；Range 也照样转发，拖进度条不受影响。
     */
    synchronized String registerRemoteAudio(String value) throws IOException {
        return registerRemoteAudio(value, null, false);
    }

    /**
     * 同 {@link #registerRemoteAudio(String)}，但多两个开关：转发时要附带的请求头，以及"允许任意主机"。
     *
     * 为什么要它们：飞牛（FNOS）这类自建服务的音频流只认 `Cookie: music-token=...`，
     * 而 <audio> 加不了任何请求头；它的地址又是用户在登录时自己填的局域网地址，
     * 不可能出现在 {@link #REMOTE_AUDIO_HOST_SUFFIXES} 那份白名单里。
     * 两个开关都由调用方显式打开，白名单那一路（Kuwo / 网易）行为不变。
     */
    synchronized String registerRemoteAudio(String value, Map<String, String> headers, boolean allowAnyHost) throws IOException {
        return registerRemoteAudio(value, headers, allowAnyHost, true);
    }

    private String registerRemoteAudio(String value, Map<String, String> headers, boolean allowAnyHost, boolean reusable) throws IOException {
        URL url = new URL(value);
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
        if (!("http".equals(url.getProtocol()) || "https".equals(url.getProtocol()))
            || !(allowAnyHost || isRemoteAudioHostAllowed(host))) {
            throw new IOException("Unsupported remote audio host");
        }
        int localPort = start();
        String token = reusable ? remoteAudioRegistry.registerReusable(value, headers)
            : remoteAudioRegistry.register(value, headers);
        return "http://127.0.0.1:" + localPort + REMOTE_AUDIO_PATH_PREFIX + token;
    }

    synchronized String registerScopedRemoteAudio(String value, Map<String, String> headers, String origin) throws IOException {
        RemoteAudioRegistry.validateOrigin(value, origin);
        return registerRemoteAudio(value, headers, true, false);
    }

    synchronized void unregisterRemoteAudio(String value) throws IOException {
        URL url = new URL(value);
        if (!"http".equals(url.getProtocol()) || !"127.0.0.1".equals(url.getHost())
            || url.getPort() != port || !url.getPath().startsWith(REMOTE_AUDIO_PATH_PREFIX)) return;
        remoteAudioRegistry.remove(url.getPath().substring(REMOTE_AUDIO_PATH_PREFIX.length()));
    }

    /** 有些 CDN 看 Referer 决定给不给资源：不带时回的是一段 HTML 而不是音频。 */
    private static String remoteAudioReferer(String value) {
        try {
            String host = new URL(value).getHost();
            if (host != null && (host.equals("music.126.net") || host.endsWith(".music.126.net"))) {
                return NETEASE_REMOTE_AUDIO_REFERER;
            }
        } catch (Exception ignored) {
            return REMOTE_AUDIO_REFERER;
        }
        return REMOTE_AUDIO_REFERER;
    }

    private static boolean isRemoteAudioHostAllowed(String host) {
        if (host.isEmpty()) return false;
        for (String suffix : REMOTE_AUDIO_HOST_SUFFIXES) {
            if (host.equals(suffix) || host.endsWith("." + suffix)) return true;
        }
        return false;
    }

    /** 复制进私有目录的音频存放位置。 */
    File importedAudioDirectory() {
        File dir = new File(context.getFilesDir(), "imported-audio");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    /** 媒体缓存副本存放位置（在线歌的字节，见 MEDIA_CACHE_PATH_PREFIX）。 */
    File mediaCacheDirectory() {
        File dir = new File(context.getFilesDir(), "media-cache");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    /** `{总字节数, 份数}`。设置页的「媒体缓存」那一栏读它 —— 字节搬出 IndexedDB 之后，
     *  那边按数据库算出来的占用会恒为 0，看起来像「缓存没了」。 */
    synchronized long[] mediaCacheStats() {
        File[] files = mediaCacheDirectory().listFiles();
        long size = 0;
        long count = 0;
        if (files != null) {
            for (File file : files) {
                if (!file.isFile() || file.getName().endsWith(".part")) continue;
                size += file.length();
                count += 1;
            }
        }
        return new long[] { size, count };
    }

    /** 清空整个媒体缓存目录（设置页的「清除媒体缓存」）。 */
    synchronized void clearMediaCache() {
        File[] files = mediaCacheDirectory().listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isFile()) file.delete();
        }
    }

    /**
     * 缓存副本的文件名长什么样：`<key 的 base64url>.<扩展名>`。
     *
     * key 里可能有歌名（中文、空格、斜杠），所以不能直接拿它拼路径 —— Web 侧先编码成
     * base64url，这里再用白名单收口，路径穿越（`/`、`..`）在拼路径之前就被挡掉。
     */
    private static boolean isMediaCacheNameAllowed(String name) {
        if (name == null || name.isEmpty() || name.length() > 220) return false;
        if (name.contains("/") || name.contains("\\") || name.contains("..")) return false;
        if (name.startsWith(".")) return false;
        for (int i = 0; i < name.length(); i += 1) {
            char c = name.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                || c == '-' || c == '_' || c == '.';
            if (!ok) return false;
        }
        return true;
    }

    private void handle(Socket socket) {
        try (Socket client = socket;
             BufferedInputStream input = new BufferedInputStream(client.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(client.getOutputStream())) {
            String requestLine = readLine(input);
            if (requestLine == null) return;
            String[] requestParts = requestLine.split(" ");
            if (requestParts.length < 2) return;

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(input)) != null && !line.isEmpty()) {
                int separator = line.indexOf(':');
                if (separator > 0) {
                    headers.put(
                        line.substring(0, separator).trim().toLowerCase(),
                        line.substring(separator + 1).trim()
                    );
                }
            }

            String rawPath = requestParts[1];
            int queryAt = rawPath.indexOf('?');
            String queryString = queryAt >= 0 ? rawPath.substring(queryAt + 1) : "";
            String path = queryAt >= 0 ? rawPath.substring(0, queryAt) : rawPath;
            /*
             * 预检（OPTIONS）必须自己答。
             *
             * 跨源请求只要带了 Range 之外的头、或者某些 WebView 版本对 Range 也走预检，
             * 浏览器就会先发一个 OPTIONS —— 服务不答就是 CORS 失败，
             * 而失败的表现和「文件不存在」一模一样（mediaErrorCode=4）。
             * 答一个 204 并放行 Range，探测和播放两条路都才走得通。
             */
            if ("OPTIONS".equals(requestParts[0])) {
                String response = "HTTP/1.1 204 No Content\r\n"
                    + "Access-Control-Allow-Origin: *\r\n"
                    + "Access-Control-Allow-Methods: GET, HEAD, PUT, DELETE, OPTIONS\r\n"
                    + "Access-Control-Allow-Headers: range, content-range, content-length, content-type\r\n"
                    + "Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n"
                    + "Access-Control-Max-Age: 86400\r\n"
                    + "Content-Length: 0\r\nConnection: close\r\n\r\n";
                output.write(response.getBytes(StandardCharsets.US_ASCII));
                output.flush();
                return;
            }
            if (path.startsWith(REMOTE_AUDIO_PATH_PREFIX)) {
                streamRemoteAudio(output, requestParts, headers, path.substring(REMOTE_AUDIO_PATH_PREFIX.length()));
                return;
            }
            if (path.startsWith(VIDEO_LAYER_PATH_PREFIX)) {
                streamVideoLayerFile(output, requestParts, headers);
                return;
            }
            if (path.startsWith(MEDIA_CACHE_PATH_PREFIX)) {
                String name = URLDecoder.decode(path.substring(MEDIA_CACHE_PATH_PREFIX.length()), "UTF-8");
                String method = requestParts[0];
                if ("PUT".equals(method) || "POST".equals(method)) {
                    writeMediaCacheFile(input, output, headers, name, queryString);
                } else if ("DELETE".equals(method)) {
                    deleteMediaCacheFile(output, name, queryString);
                } else {
                    streamMediaCacheFile(output, requestParts, headers, name);
                }
                return;
            }
            if (!path.startsWith(AUDIO_PATH_PREFIX)) {
                writeStatus(output, 404, "Not Found");
                return;
            }

            String token = URLDecoder.decode(path.substring(AUDIO_PATH_PREFIX.length()), "UTF-8");
            if (token.startsWith(IMPORTED_PREFIX)) {
                /*
                 * 传**完整的** token，别先剥掉 imported- 再拼路径。
                 *
                 * 磁盘上的副本名本身就是 "imported-<稳定名>"（导入那边 safeName 就是这么起的，
                 * 删副本的 resolveImportedFile 也是按完整 ref 拼的），而这里剥掉前缀之后
                 * 拼出来的是 "imported-audio/<稳定名>" —— 少了一段，永远 isFile() == false，
                 * 于是每一首手动导入的歌都回 404：<audio> 报 Format error、
                 * 导入时抓封面和内嵌歌词的那次 fetch 也一起失败（封面/歌词全空）。
                 * 表现正是「扫描导入能播，手动导入一律播不了」。
                 */
                streamImportedFile(output, requestParts, headers, token);
                return;
            }
            if (token.startsWith(FILE_PREFIX)) {
                streamExternalFile(output, requestParts, headers, token.substring(FILE_PREFIX.length()));
                return;
            }
            streamMediaStoreFile(output, requestParts, headers, token);
        } catch (Exception error) {
            // 之前这里连日志都没有：流写到一半断掉，WebView 那边只会报一句
            // Format error，原生侧连发生了什么都不知道。
            Log.w(TAG, "audio request failed", error);
        }
    }

    private void streamMediaStoreFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String mediaId
    ) throws IOException {
        Uri uri = Uri.withAppendedPath(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId);
        ContentResolver resolver = context.getContentResolver();
        long size = -1;
        String mime = "audio/*";
        try (Cursor cursor = resolver.query(uri, new String[]{
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.MIME_TYPE
        }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                size = cursor.getLong(0);
                String queriedMime = cursor.getString(1);
                if (queriedMime != null && !queriedMime.isEmpty()) mime = queriedMime;
            }
        }
        writeResponse(output, requestParts, headers, size, mime, () -> resolver.openInputStream(uri));
    }

    private void streamImportedFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String fileName
    ) throws IOException {
        // 现在传进来的是完整文件名（含 imported- 前缀）。这个服务监听在 127.0.0.1 上，
        // 设备上任何应用都能连，名字来自 URL，必须挡掉路径穿越。
        if (fileName.contains("/") || fileName.contains("\\") || fileName.contains("..")) {
            Log.w(TAG, "imported audio refused: " + fileName);
            writeStatus(output, 404, "Not Found");
            return;
        }
        File target = new File(importedAudioDirectory(), fileName);
        if (!target.isFile()) {
            Log.w(TAG, "imported audio missing: " + fileName);
            writeStatus(output, 404, "Not Found");
            return;
        }
        writeResponse(
            output,
            requestParts,
            headers,
            target.length(),
            guessMimeType(fileName),
            () -> new FileInputStream(target)
        );
    }

    /**
     * 按绝对路径流用户自己的音频（文件系统兜底扫描的歌）。
     *
     * 只放行外存根目录下的音频文件，别的一律 404 —— 这个服务监听在 127.0.0.1 上，
     * 设备上任何应用都能连上来，不能让它变成一个任读全盘的口子。
     * 走这条路的歌要求已授予「所有文件访问」，没授权时读流会自己失败。
     */
    private void streamExternalFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String encodedPath
    ) throws IOException {
        String filePath = URLDecoder.decode(encodedPath, "UTF-8");
        File target = new File(filePath);
        File root = Environment.getExternalStorageDirectory();
        boolean insideRoot = root != null && filePath.startsWith(root.getPath() + File.separator);
        if (!insideRoot || !target.isFile() || !isAudioFileName(filePath)) {
            Log.w(TAG, "external audio refused: " + filePath);
            writeStatus(output, 404, "Not Found");
            return;
        }
        writeResponse(
            output,
            requestParts,
            headers,
            target.length(),
            guessMimeType(filePath),
            () -> new FileInputStream(target)
        );
    }

    /**
     * 代转发一个远端音频（只有白名单主机能用，见 {@link #registerRemoteAudio}）。
     *
     * Range 原样往上带：拖进度条时 <audio> 会发 `bytes=xxx-`，上游回 206，
     * 我们也要回 206 并把它的 Content-Range 转给 WebView，否则播放器会认为
     * 服务端不支持拖动，重新整首下载一次。
     */
    private void streamRemoteAudio(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String token
    ) throws IOException {
        RemoteAudioRegistry.Entry entry = remoteAudioRegistry.get(token);
        if (entry == null) {
            Log.w(TAG, "remote audio token unknown: " + token);
            writeStatus(output, 404, "Not Found");
            return;
        }

        String target = entry.url;
        Map<String, String> extraHeaders = entry.headers;
        Request.Builder request = new Request.Builder().url(target);
        // 有些 CDN 看 UA / Referer 决定给不给资源，不带的话会回一段 HTML 而不是音频
        // —— 那种回包喂进 <audio> 正是「Format error」的经典来源。
        request.header("User-Agent", REMOTE_AUDIO_USER_AGENT);
        request.header("Referer", remoteAudioReferer(target));
        // 调用方带来的头（飞牛的 music-token）最后写：同名的以它为准。
        if (extraHeaders != null) {
            for (Map.Entry<String, String> header : extraHeaders.entrySet()) {
                request.header(header.getKey(), header.getValue());
            }
        }
        String range = headers.get("range");
        if (range != null && range.startsWith("bytes=")) request.header("Range", range);

        OkHttpClient client = entry.allowsRedirects() ? remoteAudioClient : credentialResourceClient;
        Response upstream = client.newCall(request.build()).execute();
        try {
            ResponseBody body = upstream.body();
            if (!upstream.isSuccessful() || body == null) {
                Log.w(TAG, "remote audio upstream " + upstream.code() + " for " + target);
                writeStatus(output, 502, "Upstream Error");
                return;
            }
            String contentType = body.contentType() != null ? body.contentType().toString() : "audio/mpeg";
            String contentRange = upstream.header("Content-Range");
            long size = body.contentLength();
            // 上游不给长度（chunked）时，拿 Content-Range 里的 total 兜底。
            if (size < 0 && contentRange != null) {
                int slash = contentRange.indexOf('/');
                if (slash >= 0 && slash + 1 < contentRange.length()) {
                    try {
                        size = Long.parseLong(contentRange.substring(slash + 1).trim());
                    } catch (NumberFormatException ignored) {
                        size = -1;
                    }
                }
            }
            boolean partial = upstream.code() == 206 || contentRange != null;

            Log.i(TAG, "remote " + target + " -> " + upstream.code()
                + " type=" + contentType + " size=" + size + " range=" + (contentRange == null ? "-" : contentRange));

            StringBuilder response = new StringBuilder();
            response.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
            response.append("Content-Type: ").append(contentType).append("\r\n");
            response.append("Accept-Ranges: bytes\r\n");
            // 这一整条链路存在的唯一理由就是同源：没有这两行，<audio crossOrigin="anonymous">
            // 依然会被 CORS 挡在门外，和直连 CDN 没区别。
            response.append("Access-Control-Allow-Origin: *\r\n");
            response.append("Access-Control-Allow-Headers: range, content-range, content-length\r\n");
            response.append("Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n");
            response.append("Connection: close\r\n");
            if (size >= 0) {
                response.append("Content-Length: ").append(size).append("\r\n");
                if (contentRange != null) {
                    response.append("Content-Range: ").append(contentRange).append("\r\n");
                }
            }
            response.append("\r\n");
            output.write(response.toString().getBytes(StandardCharsets.US_ASCII));

            if ("GET".equals(requestParts[0])) {
                try (InputStream audio = body.byteStream()) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = audio.read(buffer)) != -1) {
                        output.write(buffer, 0, read);
                    }
                }
            }
            output.flush();
        } finally {
            upstream.close();
        }
    }

    /**
     * 歌词后方视频层那一个视频（私有目录里的副本，见 VideoLayerFile）。
     *
     * 不像音频那样拿 URL 里的名字去拼路径：这一层永远只有一份，名字不作数 ——
     * 这个服务监听在 127.0.0.1 上，设备上任何应用都能连，名字来自 URL 就别拿它拼路径。
     * <video> 一样吃 Range 与 CORS，所以走的是与音频同一条 writeResponse。
     */
    private void streamVideoLayerFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers
    ) throws IOException {
        File target = VideoLayerFile.file(context);
        if (target == null || !target.isFile() || target.length() <= 0) {
            Log.w(TAG, "video layer file missing");
            writeStatus(output, 404, "Not Found");
            return;
        }
        writeResponse(
            output,
            requestParts,
            headers,
            target.length(),
            VideoLayerFile.mimeType(context),
            () -> new FileInputStream(target)
        );
    }

    /**
     * 读一份媒体缓存副本。原生播放器与 <audio> 都从这里取字节，所以 Range 与 CORS
     * 一样都不能少 —— 复用 writeResponse 就是为了这两件事只写一遍。
     */
    private void streamMediaCacheFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String fileName
    ) throws IOException {
        File target = mediaCacheFile(fileName);
        if (target == null) {
            // 不存在与「名字不合法」都走 404：名字来自 URL，不给它区别对待的理由。
            Log.w(TAG, "media cache copy missing: " + fileName);
            writeStatus(output, 404, "Not Found");
            return;
        }
        writeResponse(
            output,
            requestParts,
            headers,
            target.length(),
            guessMimeType(fileName),
            () -> new FileInputStream(target)
        );
    }

    /**
     * 定位一份副本。
     *
     * 名字是 key 的 base64url，**不带扩展名**：读的时候（播放）调用方并不知道那份副本
     * 当初是什么格式，只有写的时候知道。所以这里按 `<名字>.` 前缀找，找到谁就是谁 ——
     * 同一个 key 永远只有一份（写入时会清掉同 base 的别的格式）。
     */
    private File mediaCacheFile(String fileName) {
        if (!isMediaCacheNameAllowed(fileName)) return null;
        File dir = mediaCacheDirectory();
        File direct = new File(dir, fileName);
        if (direct.isFile()) return direct;
        if (fileName.indexOf('.') >= 0) return null;
        File[] files = dir.listFiles();
        if (files == null) return null;
        for (File file : files) {
            if (file.isFile() && file.getName().startsWith(fileName + ".")) return file;
        }
        return null;
    }

    /** 按 Content-Type 决定扩展名，只为让 writeResponse 能给出像样的 Content-Type。 */
    private static String extensionForMime(String mime) {
        String lower = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        if (lower.contains("flac")) return "flac";
        if (lower.contains("mp4") || lower.contains("m4a") || lower.contains("aac")) return "m4a";
        if (lower.contains("wav")) return "wav";
        if (lower.contains("ogg") || lower.contains("opus")) return "ogg";
        if (lower.contains("ape")) return "ape";
        if (lower.contains("wma")) return "wma";
        return "mp3";
    }

    /**
     * 存一份媒体缓存副本。
     *
     * 字节走 HTTP 请求体而不是 Capacitor 桥：桥只有一条，几 MB 的 base64 压上去，
     * 别的平台会集体超时（本地导入那边的拷贝也是因此被挪到别的线程上做的）。
     *
     * 先写 `.part` 再 rename：写一半被杀不能留下一份坏的副本，而坏副本正是下一次播放
     * 会读到的那份 —— 症状是「这首歌播到一半断了，之后永远播不了」。
     */
    private void writeMediaCacheFile(
        BufferedInputStream input,
        BufferedOutputStream output,
        Map<String, String> headers,
        String fileName,
        String queryString
    ) throws IOException {
        // 名字只认 key 的 base64url（无点）：扩展名由 Content-Type 决定，不给调用方拼的机会。
        if (!isMediaCacheNameAllowed(fileName) || fileName.indexOf('.') >= 0) {
            Log.w(TAG, "media cache name refused: " + fileName);
            writeStatus(output, 404, "Not Found");
            return;
        }
        long declared = parseLongOr(headers.get("content-length"), -1);
        if (declared <= 0) {
            writeStatus(output, 411, "Length Required");
            return;
        }
        String storedName = fileName + "." + extensionForMime(headers.get("content-type"));
        File dir = mediaCacheDirectory();
        File target = new File(dir, storedName);
        File temp = new File(dir, storedName + ".part");
        long written = 0;
        try (OutputStream fileOut = new BufferedOutputStream(new FileOutputStream(temp))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while (written < declared
                && (read = input.read(buffer, 0, (int) Math.min(buffer.length, declared - written))) != -1) {
                fileOut.write(buffer, 0, read);
                written += read;
            }
        }
        if (written != declared) {
            temp.delete();
            Log.w(TAG, "media cache write short: " + written + "/" + declared);
            writeStatus(output, 400, "Incomplete Body");
            return;
        }
        if (!temp.renameTo(target)) {
            temp.delete();
            Log.w(TAG, "media cache rename failed: " + fileName);
            writeStatus(output, 500, "Store Failed");
            return;
        }
        // 同一首歌换了个格式（扩展名不同）时旧的那一份要一起走，否则它永远占着地方，
        // 而且读的时候按 `<名字>.` 前缀找，找错的那一份就是它。
        maintainMediaCache(dir, storedName, queryParam(queryString, "limit", -1));
        Log.i(TAG, "media cache stored " + storedName + " (" + written + " bytes)");
        writeStatus(output, 200, "OK");
    }

    /**
     * 删一份副本。带 `size` 时只在这个长度上才删：调用方要删的是它读到的那一份，
     * 期间被写进来的新副本不是（见 Web 侧 removeAudioBlob 的 size 校验）。
     */
    private void deleteMediaCacheFile(
        BufferedOutputStream output,
        String fileName,
        String queryString
    ) throws IOException {
        File target = mediaCacheFile(fileName);
        if (target == null) {
            writeStatus(output, 404, "Not Found");
            return;
        }
        long size = queryParam(queryString, "size", -1);
        if (size > 0 && target.length() != size) {
            writeStatus(output, 409, "Conflict");
            return;
        }
        boolean removed = target.delete();
        writeStatus(output, removed ? 200 : 500, removed ? "OK" : "Delete Failed");
    }

    /** 裁剪最多这么久做一次。清兄弟文件不受这个限制 —— 那个必须当场清。 */
    private static final long PRUNE_INTERVAL_MS = 30_000L;
    private long lastPruneAtMs = 0L;

    /**
     * 写完一份副本之后的收尾，只做一次遍历。
     *
     * ⚠️ 原来这里跑了两遍目录：`removeSiblingCopies` 一遍、`pruneMediaCache` 一遍，
     * 而后者还要**排序 + 删文件**。缓存里攒到几百份时，每写完一首歌就要做一次
     * 全目录排序 —— 界面上正是「过一段时间卡一下」（一首歌播完写一次缓存）。
     *
     * 现在一次遍历里把三件事办完：清上次写一半的残骸、清同 base 的旧格式、累计总大小；
     * 只有**确实超了上限**才去排序删最旧的那几份，而且最多 30 秒做一次。
     */
    private synchronized void maintainMediaCache(File dir, String storedName, long limit) {
        File[] files = dir.listFiles();
        if (files == null) return;
        String base = storedName.substring(0, storedName.lastIndexOf('.'));
        List<File> kept = new ArrayList<>();
        long total = 0;
        for (File file : files) {
            String name = file.getName();
            if (!file.isFile()) continue;
            // 写一半留下的残骸，永远不会被读，顺手清掉。
            if (name.endsWith(".part")) {
                file.delete();
                continue;
            }
            // 同一首歌的旧格式：留着会让「按前缀找」找错那一份。
            if (!name.equals(storedName) && name.startsWith(base + ".")) {
                file.delete();
                continue;
            }
            kept.add(file);
            total += file.length();
        }
        if (limit <= 0 || total <= limit) return;
        long now = System.currentTimeMillis();
        if (now - lastPruneAtMs < PRUNE_INTERVAL_MS) return;
        lastPruneAtMs = now;
        kept.sort((a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File file : kept) {
            if (total <= limit) break;
            long size = file.length();
            if (file.delete()) total -= size;
        }
    }

    private static long parseLongOr(String raw, long fallback) {
        if (raw == null) return fallback;
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    /** 从 `a=1&b=2` 里取一个数；没有或不是数就给 fallback。 */
    private static long queryParam(String queryString, String key, long fallback) {
        if (queryString == null || queryString.isEmpty()) return fallback;
        for (String pair : queryString.split("&")) {
            int at = pair.indexOf('=');
            if (at <= 0 || !key.equals(pair.substring(0, at))) continue;
            return parseLongOr(pair.substring(at + 1), fallback);
        }
        return fallback;
    }

    private interface StreamSupplier {
        InputStream open() throws IOException;
    }

    private void writeResponse(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        long size,
        String mime,
        StreamSupplier supplier
    ) throws IOException {
        // 空文件喂给 <audio> 只会换来一句莫名的 MEDIA_ELEMENT_ERROR: Format error；
        // 这里直接 404 并把原因写进日志，下次一眼就能看出是"文件是空的"。
        if (size <= 0) {
            Log.w(TAG, "audio source is empty or unreadable (size=" + size + "): " + requestParts[1]);
            writeStatus(output, 404, "Empty Audio");
            return;
        }
        long start = 0;
        long end = size > 0 ? size - 1 : -1;
        String range = headers.get("range");
        boolean partial = false;
        if (range != null && range.startsWith("bytes=")) {
            String[] parts = range.substring(6).split("-", -1);
            try {
                if (!parts[0].isEmpty()) start = Long.parseLong(parts[0]);
                if (parts.length > 1 && !parts[1].isEmpty()) end = Long.parseLong(parts[1]);
                if (size > 0) end = Math.min(end, size - 1);
                partial = true;
            } catch (NumberFormatException ignored) {
                start = 0;
                end = size > 0 ? size - 1 : -1;
                partial = false;
            }
        }

        long contentLength = end >= start ? end - start + 1 : -1;
        Log.i(TAG, requestParts[0] + " " + requestParts[1]
            + " range=" + (range == null ? "-" : range)
            + " size=" + size + " partial=" + partial
            + (partial ? " bytes=" + start + "-" + end : ""));
        StringBuilder response = new StringBuilder();
        response.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        response.append("Content-Type: ").append(mime).append("\r\n");
        response.append("Accept-Ranges: bytes\r\n");
        response.append("Access-Control-Allow-Origin: *\r\n");
        // crossOrigin="anonymous" 的 <audio> 会带 CORS 语义，把 Range 相关头暴露出来，
        // 拖进度条（发 Range、读 Content-Range）才不会在 CORS 检查上被拦。
        response.append("Access-Control-Allow-Headers: range, content-range, content-length\r\n");
        response.append("Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n");
        response.append("Connection: close\r\n");
        if (size > 0) {
            response.append("Content-Length: ").append(contentLength).append("\r\n");
            if (partial) {
                response.append("Content-Range: bytes ")
                    .append(start).append('-').append(end).append('/').append(size).append("\r\n");
            }
        }
        response.append("\r\n");
        output.write(response.toString().getBytes(StandardCharsets.US_ASCII));

        // HEAD 只回头部：<audio> 在真正下载前会先探一次，那时不能把整首歌读一遍。
        if ("GET".equals(requestParts[0])) {
            try (InputStream audio = supplier.open()) {
                if (audio != null) {
                    skipFully(audio, start);
                    byte[] buffer = new byte[64 * 1024];
                    long remaining = contentLength;
                    int read;
                    while ((read = audio.read(buffer)) != -1 && (remaining < 0 || remaining > 0)) {
                        int writeLength = remaining < 0 ? read : (int) Math.min(read, remaining);
                        output.write(buffer, 0, writeLength);
                        if (remaining > 0) remaining -= writeLength;
                    }
                }
            }
        }
        output.flush();
    }

    /**
     * InputStream.skip 不保证一次跳够（它爱跳多少跳多少），文件流上偶尔也会短跳。
     * 之前直接一个 skip 了事，短跳时从错误的位置开始发 —— 解码器读到的就是一段
     * 被错位的数据，表现正是「MEDIA_ELEMENT_ERROR: Format error」这类莫名失败。
     */
    private static void skipFully(InputStream audio, long bytes) throws IOException {
        long remaining = bytes;
        while (remaining > 0) {
            long skipped = audio.skip(remaining);
            if (skipped <= 0) {
                // skip 返回 0 只能靠读来推进（可能已经到头）。
                if (audio.read() == -1) return;
                skipped = 1;
            }
            remaining -= skipped;
        }
    }

    /** 路径是不是设备上常见的音频扩展名（文件系统兜底扫描与 file- 路由共用）。 */
    static boolean isAudioFileName(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase();
        return lower.endsWith(".mp3") || lower.endsWith(".flac") || lower.endsWith(".wav")
            || lower.endsWith(".m4a") || lower.endsWith(".aac") || lower.endsWith(".ogg")
            || lower.endsWith(".opus") || lower.endsWith(".ape") || lower.endsWith(".wma");
    }

    static String guessMimeType(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase();
        if (lower.endsWith(".flac")) return "audio/flac";
        if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
        if (lower.endsWith(".opus")) return "audio/opus";
        if (lower.endsWith(".aac")) return "audio/aac";
        if (lower.endsWith(".ape")) return "audio/ape";
        if (lower.endsWith(".wma")) return "audio/x-ms-wma";
        return "audio/mpeg";
    }

    private static String readLine(InputStream input) throws IOException {
        StringBuilder line = new StringBuilder();
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') break;
            if (value != '\r') line.append((char) value);
        }
        return value == -1 && line.length() == 0 ? null : line.toString();
    }

    /**
     * 错误响应也一定要带 CORS 头。
     *
     * <audio> 带 crossOrigin="anonymous"，响应缺 Access-Control-Allow-Origin 时，
     * 浏览器把「CORS 被拒」和「文件不存在 / 空文件」报成一模一样的东西：
     * networkState=3、mediaErrorCode=4（MEDIA_ERR_SRC_NOT_SUPPORTED）——
     * 也就是那句毫无特征的 MEDIA_ELEMENT_ERROR: Format error。
     * 带上 ACAO 之后，上层用 fetch 探一次就能读到真实的 404/502，不用再猜。
     */
    private static void writeStatus(OutputStream output, int status, String message) throws IOException {
        String response = "HTTP/1.1 " + status + " " + message + "\r\n"
            + "Content-Type: text/plain\r\n"
            + "Content-Length: 0\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Access-Control-Allow-Headers: range, content-range, content-length\r\n"
            + "Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n"
            + "Connection: close\r\n\r\n";
        output.write(response.getBytes(StandardCharsets.US_ASCII));
        output.flush();
    }
}
