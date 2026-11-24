package com.kaappi.biller;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.TimeZone;

/**
 * Runs the whole Kaappi Biller server inside the app ("Main device" mode):
 * PostgreSQL + the Node.js backend, which also serves the web UI.
 *
 * Same order as the Windows desktop launcher
 * (windows/msix/Launcher/ServerSupervisor.cs):
 *   unpack runtime → initdb (first run) → start postgres → createdb →
 *   backend env with a random JWT secret (first run) → migrations →
 *   start node → wait for /api/health.
 *
 * Everything lives in the app's private files dir. The runtime binaries are
 * executed from there, which Android permits for apps targeting API 28
 * (the Termux model) — see build.sh.
 */
final class Supervisor {
    static final int WEB_PORT = 1995;
    static final int PG_PORT = 55432;
    private static final String TAG = "KaappiServer";
    private static final String DB_USER = "kaappi";
    private static final String DB_NAME = "kaappi";

    interface Listener {
        void onStatus(String message);
    }

    private final Context context;
    private final Listener listener;
    private final File files;
    private final File usr;
    private final File appDir;
    private final File pgData;
    private final File tmp;
    private final File logs;
    private final File state;
    private Process postgres;
    private Process backend;

    Supervisor(Context context, Listener listener) {
        this.context = context;
        this.listener = listener;
        files = context.getFilesDir();
        usr = new File(files, "rt/usr");
        appDir = new File(files, "app");
        pgData = new File(files, "pgdata");
        tmp = new File(files, "tmp");
        logs = new File(files, "logs");
        state = new File(files, "state");
    }

    /** Blocking: returns once the backend answers /api/health, or throws. */
    void start() throws Exception {
        tmp.mkdirs();
        logs.mkdirs();
        state.mkdirs();
        new File(files, "uploads").mkdirs();

        unpackIfNeeded();

        if (!new File(pgData, "PG_VERSION").exists()) {
            status("Creating the database (first start only)…");
            run(60, null, bin("initdb"), "-D", pgData.getPath(), "-U", DB_USER, "-A", "trust",
                "-E", "UTF8", "--no-locale");
        }

        if (portOpen(PG_PORT)) {
            Log.i(TAG, "postgres already running, reusing it");
        } else {
            status("Starting the database…");
            // A postmaster.pid left by a killed app is handled by postgres itself.
            postgres = spawn("postgres.log", bin("postgres"), "-D", pgData.getPath(),
                "-h", "127.0.0.1", "-p", String.valueOf(PG_PORT), "-k", tmp.getPath(),
                "-c", "max_connections=30", "-c", "shared_buffers=48MB");
            waitForPort(PG_PORT, 60, "database");
        }
        waitForDatabaseReady(90);
        ensureDatabase();

        status("Updating the database…");
        run(180, backendEnv(), bin("node"), new File(appDir, "backend/prisma/apply-migrations.js").getPath());

        status("Starting Kaappi Biller…");
        backend = spawn("backend.log", backendEnv(), bin("node"), new File(appDir, "backend/dist/src/main.js").getPath());
        waitForHealth(120);
        status("Ready");
    }

    void stop() {
        if (backend != null) {
            backend.destroy();
            backend = null;
        }
        try {
            run(30, null, bin("pg_ctl"), "stop", "-D", pgData.getPath(), "-m", "fast");
        } catch (Exception e) {
            Log.w(TAG, "pg_ctl stop failed", e);
            if (postgres != null) postgres.destroy();
        }
        postgres = null;
    }

    boolean isRunning() {
        return backend != null && backend.isAlive();
    }

    // ── first start: unpack the runtime, backend and web UI from the APK ───

    private void unpackIfNeeded() throws Exception {
        String version = readAsset("bundle-version.txt").trim();
        File marker = new File(files, "bundle-version.txt");
        String installed = marker.exists() ? readFile(marker).trim() : "";
        if (version.equals(installed) && new File(usr, "bin/node").exists()) return;

        status("Preparing Kaappi Biller (first start: about a minute)…");
        deleteTree(new File(files, "rt"));
        deleteTree(appDir);
        new File(files, "rt").mkdirs();
        appDir.mkdirs();
        String abi = readAsset("abi.txt").trim();
        extract("runtime-" + abi + ".tar.gz", new File(files, "rt"));
        extract("backend.tar.gz", appDir);
        extract("web.tar.gz", appDir);
        writeFile(marker, version);
    }

    private void extract(String asset, File dest) throws Exception {
        File archive = new File(context.getCacheDir(), asset);
        try (InputStream in = context.getAssets().open(asset, AssetManager.ACCESS_STREAMING);
             OutputStream out = new FileOutputStream(archive)) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        try {
            // Android's own tar (toybox) keeps file modes and symlinks.
            run(300, null, "/system/bin/tar", "-xzf", archive.getPath(), "-C", dest.getPath());
        } finally {
            //noinspection ResultOfMethodCallIgnored
            archive.delete();
        }
    }

    // ── database ───────────────────────────────────────────────────────────

    private void ensureDatabase() throws Exception {
        String out = runCapture(30, null, bin("psql"), "-h", "127.0.0.1", "-p", String.valueOf(PG_PORT),
            "-U", DB_USER, "-d", "postgres", "-Atc",
            "SELECT 1 FROM pg_database WHERE datname = '" + DB_NAME + "'");
        if (!out.trim().equals("1")) {
            run(30, null, bin("createdb"), "-h", "127.0.0.1", "-p", String.valueOf(PG_PORT), "-U", DB_USER, DB_NAME);
        }
    }

    // ── backend environment (secret generated once, kept in private storage) ──

    private List<String> backendEnv() throws IOException {
        File envFile = new File(state, "backend.properties");
        Properties p = new Properties();
        if (envFile.exists()) {
            try (InputStream in = new FileInputStream(envFile)) {
                p.load(in);
            }
        }
        if (p.getProperty("JWT_SECRET", "").length() < 32) {
            byte[] b = new byte[32];
            new SecureRandom().nextBytes(b);
            StringBuilder hex = new StringBuilder();
            for (byte x : b) hex.append(String.format("%02x", x));
            p.setProperty("JWT_SECRET", hex.toString());
            try (OutputStream out = new FileOutputStream(envFile)) {
                p.store(out, "Kaappi Biller embedded server (generated on first start)");
            }
        }
        List<String> env = new ArrayList<>();
        env.add("DATABASE_URL=postgresql://" + DB_USER + "@127.0.0.1:" + PG_PORT + "/" + DB_NAME);
        env.add("DATABASE_POOL_MAX=8");
        env.add("JWT_SECRET=" + p.getProperty("JWT_SECRET"));
        env.add("JWT_SECRET_STATE_FILE=" + new File(state, "jwt-secret").getPath());
        env.add("PORT=" + WEB_PORT);
        env.add("NODE_ENV=production");
        env.add("COOKIE_SECURE=false");
        env.add("UPLOADS_DIR=" + new File(files, "uploads").getPath());
        env.add("WEB_ROOT=" + new File(appDir, "web").getPath());
        env.add("TZ=" + TimeZone.getDefault().getID());
        env.add("SSL_CERT_FILE=" + new File(usr, "etc/tls/cert.pem").getPath());
        env.add("HOME=" + files.getPath());
        try {
            env.add("APP_VERSION=" + context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName);
        } catch (Exception ignored) {
            // version is informational only
        }
        return env;
    }

    // ── process helpers ────────────────────────────────────────────────────

    private String bin(String name) {
        return new File(usr, "bin/" + name).getPath();
    }

    private ProcessBuilder builder(List<String> extraEnv, String... cmd) {
        ProcessBuilder pb = new ProcessBuilder(cmd);
        Map<String, String> env = pb.environment();
        env.put("LD_LIBRARY_PATH", new File(usr, "lib").getPath());
        env.put("TMPDIR", tmp.getPath());
        env.put("PGDATA", pgData.getPath());
        if (extraEnv != null) {
            for (String kv : extraEnv) {
                int i = kv.indexOf('=');
                env.put(kv.substring(0, i), kv.substring(i + 1));
            }
        }
        pb.directory(files);
        return pb;
    }

    private Process spawn(String logName, String... cmd) throws IOException {
        return spawn(logName, null, cmd);
    }

    private Process spawn(String logName, List<String> env, String... cmd) throws IOException {
        File log = new File(logs, logName);
        ProcessBuilder pb = builder(env, cmd);
        pb.redirectErrorStream(true);
        pb.redirectOutput(ProcessBuilder.Redirect.appendTo(log));
        Log.i(TAG, "spawn " + cmd[0]);
        return pb.start();
    }

    private void run(int timeoutSec, List<String> env, String... cmd) throws Exception {
        runCapture(timeoutSec, env, cmd);
    }

    private String runCapture(int timeoutSec, List<String> env, String... cmd) throws Exception {
        File out = File.createTempFile("cmd", ".log", tmp);
        try {
            ProcessBuilder pb = builder(env, cmd);
            pb.redirectErrorStream(true);
            pb.redirectOutput(out);
            Process p = pb.start();
            if (!p.waitFor(timeoutSec, java.util.concurrent.TimeUnit.SECONDS)) {
                p.destroyForcibly();
                throw new IOException(new File(cmd[0]).getName() + " timed out");
            }
            String text = readFile(out);
            if (p.exitValue() != 0) {
                throw new IOException(new File(cmd[0]).getName() + " failed (" + p.exitValue() + "): " + tail(text));
            }
            return text;
        } finally {
            //noinspection ResultOfMethodCallIgnored
            out.delete();
        }
    }

    private static boolean portOpen(int port) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", port), 500);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    private void waitForPort(int port, int timeoutSec, String what) throws Exception {
        long end = System.currentTimeMillis() + timeoutSec * 1000L;
        while (System.currentTimeMillis() < end) {
            if (portOpen(port)) return;
            if (postgres != null && !postgres.isAlive()) {
                throw new IOException("The " + what + " stopped while starting: " + tail(readFile(new File(logs, "postgres.log"))));
            }
            Thread.sleep(300);
        }
        throw new IOException("The " + what + " did not start in " + timeoutSec + " s");
    }

    /**
     * The port opens before postgres accepts queries; after an unclean stop
     * (Android killed the app) it first replays its log ("rejecting
     * connections" meanwhile). Poll pg_isready until it says yes.
     */
    private void waitForDatabaseReady(int timeoutSec) throws Exception {
        long end = System.currentTimeMillis() + timeoutSec * 1000L;
        String last = "";
        while (System.currentTimeMillis() < end) {
            try {
                run(10, null, bin("pg_isready"), "-h", "127.0.0.1", "-p", String.valueOf(PG_PORT));
                return;
            } catch (IOException notYet) {
                last = notYet.getMessage();
            }
            if (postgres != null && !postgres.isAlive()) {
                throw new IOException("The database stopped while starting: " + tail(readFile(new File(logs, "postgres.log"))));
            }
            status("Starting the database (checking it after the last stop)…");
            Thread.sleep(500);
        }
        throw new IOException("The database did not become ready in " + timeoutSec + " s: " + last);
    }

    private void waitForHealth(int timeoutSec) throws Exception {
        long end = System.currentTimeMillis() + timeoutSec * 1000L;
        while (System.currentTimeMillis() < end) {
            if (backend != null && !backend.isAlive()) {
                throw new IOException("Kaappi Biller stopped while starting: " + tail(readFile(new File(logs, "backend.log"))));
            }
            try {
                HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + WEB_PORT + "/api/health").openConnection();
                c.setConnectTimeout(1000);
                c.setReadTimeout(2000);
                if (c.getResponseCode() == 200) return;
            } catch (IOException ignored) {
                // not up yet
            }
            Thread.sleep(500);
        }
        throw new IOException("Kaappi Biller did not start in " + timeoutSec + " s");
    }

    private void status(String message) {
        Log.i(TAG, message);
        if (listener != null) listener.onStatus(message);
    }

    // ── small file helpers ─────────────────────────────────────────────────

    private String readAsset(String name) throws IOException {
        try (InputStream in = context.getAssets().open(name)) {
            return new String(readAll(in), StandardCharsets.UTF_8);
        }
    }

    private static String readFile(File f) throws IOException {
        if (!f.exists()) return "";
        try (InputStream in = new FileInputStream(f)) {
            return new String(readAll(in), StandardCharsets.UTF_8);
        }
    }

    private static void writeFile(File f, String text) throws IOException {
        try (OutputStream out = new FileOutputStream(f)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }

    private static String tail(String text) {
        String t = text.trim();
        return t.length() > 600 ? "…" + t.substring(t.length() - 600) : t;
    }

    private static void deleteTree(File f) {
        if (!f.exists()) return;
        // Don't follow symlinks out of the tree (the runtime contains library links).
        try {
            if (f.isDirectory() && f.getCanonicalPath().equals(f.getAbsolutePath())) {
                File[] children = f.listFiles();
                if (children != null) for (File c : children) deleteTree(c);
            }
        } catch (IOException ignored) {
            // fall through to delete
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
