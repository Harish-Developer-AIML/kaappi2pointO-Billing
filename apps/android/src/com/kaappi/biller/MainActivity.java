package com.kaappi.biller;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Kaappi Biller for Android: a full-screen WebView around the Kaappi Biller
 * web app. Two modes, chosen on first launch:
 *
 *  - Main device: the whole system (database + backend + UI) runs inside this
 *    app (ServerService / Supervisor), fully offline. Other devices in the shop
 *    connect to it over Wi-Fi or this phone's hotspot.
 *  - Join a shop: this device only shows the app served by a main device (or
 *    any Kaappi Biller server). Its address is asked for, and asked again
 *    whenever it cannot be reached.
 */
public class MainActivity extends Activity implements ServerService.Observer {
    private static final String PREFS = "kaappi";
    private static final String KEY_SERVER = "server";
    private static final String KEY_MODE = "mode";
    private static final String MODE_MAIN = "main";
    private static final String MODE_JOIN = "join";
    private static final String MAIN_URL = "http://127.0.0.1:" + Supervisor.WEB_PORT;
    private static final int FILE_CHOOSER_REQUEST = 1;
    private static final int BROWN = Color.parseColor("#6F4E37");

    private FrameLayout root;
    private WebView webView;
    private ProgressBar progress;
    private View setupView;
    private View statusView;
    private TextView statusText;
    private boolean mainLoaded;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        setContentView(root);

        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(BROWN));
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP));
        configureWebView();

        String mode = prefs().getString(KEY_MODE, null);
        if (mode == null) {
            showModeChoice();
        } else if (MODE_MAIN.equals(mode)) {
            startMainDevice();
        } else {
            String saved = prefs().getString(KEY_SERVER, null);
            if (saved == null) {
                showSetup(defaultServer(), null);
            } else if (savedInstanceState != null) {
                webView.restoreState(savedInstanceState);
            } else {
                webView.loadUrl(saved);
            }
        }
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " KaappiBillerAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                Uri server = Uri.parse(currentServer());
                // Stay inside the app for the Kaappi Biller server; open anything
                // else (GitHub, WhatsApp, tel:, mailto:) in the matching phone app.
                if (sameOrigin(url, server)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this, "No app can open " + url, Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progress.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                if (isMainDevice()) {
                    showStatus("Kaappi Biller is not responding",
                        "The server inside this app stopped (" + error.getDescription() + ").", true);
                } else {
                    showSetup(currentServer(),
                        "Can't reach the shop's main device (" + error.getDescription() + ").\n"
                            + "Check that the main device's Kaappi Biller app is open and that this device is on the same Wi-Fi or hotspot.");
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
            }

            // <input type="file"> (e.g. uploading the restaurant logo or a menu photo).
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "No file picker available", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        // Backups, Excel/CSV reports and other downloads go to the phone's
        // Downloads folder, sent with the signed-in session cookie.
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            try {
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                req.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
                req.addRequestHeader("User-Agent", userAgent);
                req.setMimeType(mimeType);
                req.setTitle(name);
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(req);
                Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    /** The "Server address" screen: first launch, unreachable server, or chosen from Back. */
    private void showSetup(String address, String problem) {
        if (setupView != null) root.removeView(setupView);
        progress.setVisibility(View.GONE);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(28), dp(56), dp(28), dp(28));
        box.setBackgroundColor(Color.parseColor("#FBF9F8"));
        box.setClickable(true); // swallow touches meant for the WebView underneath

        TextView title = new TextView(this);
        title.setText("Kaappi Biller");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.parseColor("#111827"));
        box.addView(title);

        TextView help = new TextView(this);
        help.setText(problem != null ? problem
            : "Enter the address of the computer running Kaappi Biller. "
                + "This phone must be on the same Wi-Fi.");
        help.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        help.setTextColor(problem != null ? Color.parseColor("#B91C1C") : Color.parseColor("#4B5563"));
        help.setGravity(Gravity.CENTER);
        help.setPadding(0, dp(12), 0, dp(20));
        box.addView(help);

        TextView label = new TextView(this);
        label.setText("Server address");
        label.setTextColor(Color.parseColor("#374151"));
        label.setTypeface(Typeface.DEFAULT_BOLD);
        box.addView(label, new LinearLayout.LayoutParams(-1, -2));

        EditText input = new EditText(this);
        input.setText(address);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setImeOptions(EditorInfo.IME_ACTION_GO);
        input.setSelection(input.getText().length());
        box.addView(input, new LinearLayout.LayoutParams(-1, -2));

        Button connect = new Button(this);
        connect.setText("Connect");
        connect.setTextColor(Color.WHITE);
        connect.setBackgroundTintList(android.content.res.ColorStateList.valueOf(BROWN));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(52));
        lp.topMargin = dp(16);
        box.addView(connect, lp);

        TextView hint = new TextView(this);
        hint.setText("Tip: on the main device, press Back and choose \"Address for other devices\" to see the address to type here.");
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        hint.setTextColor(Color.parseColor("#6B7280"));
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, dp(20), 0, 0);
        box.addView(hint);

        Runnable go = () -> {
            String url = normalize(input.getText().toString());
            if (url == null) {
                input.setError("Enter an address like 192.168.1.20");
                return;
            }
            prefs().edit().putString(KEY_SERVER, url).apply();
            root.removeView(box);
            setupView = null;
            webView.loadUrl(url);
        };
        connect.setOnClickListener(v -> go.run());
        input.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) { go.run(); return true; }
            return false;
        });

        setupView = box;
        root.addView(box, new FrameLayout.LayoutParams(-1, -1));
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (setupView != null && prefs().getString(KEY_SERVER, null) != null) {
                root.removeView(setupView);
                setupView = null;
                return true;
            }
            if (statusView != null) {
                // Main device still starting: leave it running in the background.
                moveTaskToBack(true);
                return true;
            }
            if (setupView == null && webView.canGoBack()) {
                webView.goBack();
                return true;
            }
            if (setupView == null && isMainDevice()) {
                new AlertDialog.Builder(this)
                    .setTitle("Kaappi Biller (main device)")
                    .setItems(new CharSequence[] {"Address for other devices", "Reload", "Leave running in background"}, (d, which) -> {
                        if (which == 0) showJoinAddress();
                        else if (which == 1) webView.reload();
                        else moveTaskToBack(true);
                    })
                    .show();
                return true;
            }
            if (setupView == null) {
                new AlertDialog.Builder(this)
                    .setTitle("Kaappi Biller")
                    .setItems(new CharSequence[] {"Change server address", "Reload", "Exit app"}, (d, which) -> {
                        if (which == 0) showSetup(currentServer(), null);
                        else if (which == 1) webView.reload();
                        else finish();
                    })
                    .show();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    // ── first launch: main device or join ──────────────────────────────────

    private void showModeChoice() {
        LinearLayout box = screen();
        box.addView(title("Welcome to Kaappi Biller"));
        box.addView(body("How will this device be used?"));

        Button main = brownButton("This is the main device");
        box.addView(main, buttonParams());
        box.addView(small("Billing runs inside this phone or tablet, even with no internet. "
            + "Keep it at the counter, on the charger. Other devices connect to it."));

        Button join = outlineButton("Join a shop");
        box.addView(join, buttonParams());
        box.addView(small("Waiter phones and kitchen tablets: connect to the shop's main device over Wi-Fi."));

        main.setOnClickListener(v -> {
            prefs().edit().putString(KEY_MODE, MODE_MAIN).apply();
            root.removeView(box);
            startMainDevice();
        });
        join.setOnClickListener(v -> {
            prefs().edit().putString(KEY_MODE, MODE_JOIN).apply();
            root.removeView(box);
            showSetup(defaultServer(), null);
        });
        root.addView(box, new FrameLayout.LayoutParams(-1, -1));
    }

    // ── main device: the embedded server ───────────────────────────────────

    private void startMainDevice() {
        mainLoaded = false;
        showStatus("Starting Kaappi Biller", "Getting ready…", false);
        startForegroundService(new Intent(this, ServerService.class));
        ServerService.setObserver(this);
    }

    @Override
    public void onServerState(ServerService.State state, String message) {
        switch (state) {
            case READY:
                if (!mainLoaded) {
                    mainLoaded = true;
                    openMainDeviceApp();
                }
                break;
            case FAILED:
                showStatus("Kaappi Biller could not start", message, true);
                break;
            default:
                if (statusText != null) statusText.setText(message);
                break;
        }
    }

    /**
     * A brand-new shop goes straight to sign-up; an existing one to the POS
     * (which itself sends a signed-out user to the login page). Decided by the
     * backend's /auth/setup-status, checked off the main thread.
     */
    private void openMainDeviceApp() {
        new Thread(() -> {
            String path = "/pos/";
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection)
                    new java.net.URL(MAIN_URL + "/api/v1/auth/setup-status").openConnection();
                c.setConnectTimeout(3000);
                c.setReadTimeout(5000);
                try (java.io.InputStream in = c.getInputStream()) {
                    java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                    byte[] buf = new byte[1024];
                    int n;
                    while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                    String body = new String(bo.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
                    if (body.replace(" ", "").contains("\"isSetup\":false")) path = "/signup/";
                }
            } catch (Exception ignored) {
                // fall back to the POS, which redirects to login if needed
            }
            String target = MAIN_URL + path;
            runOnUiThread(() -> {
                hideStatus();
                webView.loadUrl(target);
            });
        }, "kaappi-open").start();
    }

    /** Full-screen status (starting / failed); `retry` adds a Try again button. */
    private void showStatus(String heading, String message, boolean retry) {
        hideStatus();
        LinearLayout box = screen();
        box.addView(title(heading));
        if (!retry) {
            ProgressBar spinner = new ProgressBar(this);
            spinner.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(BROWN));
            LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(dp(48), dp(48));
            sp.topMargin = dp(24);
            box.addView(spinner, sp);
        }
        statusText = body(message);
        box.addView(statusText);
        if (retry) {
            Button again = brownButton("Try again");
            again.setOnClickListener(v -> {
                stopService(new Intent(this, ServerService.class));
                startMainDevice();
            });
            box.addView(again, buttonParams());
        }
        statusView = box;
        root.addView(box, new FrameLayout.LayoutParams(-1, -1));
    }

    private void hideStatus() {
        if (statusView != null) root.removeView(statusView);
        statusView = null;
        statusText = null;
    }

    /** What other devices type in "Join a shop" to reach this main device. */
    private void showJoinAddress() {
        List<String> addrs = localAddresses();
        String text = addrs.isEmpty()
            ? "This device is not connected to Wi-Fi and has no hotspot on.\n\nConnect it to the shop Wi-Fi, or turn on its hotspot and connect the other devices to it."
            : "On the other devices, choose \"Join a shop\" and type:\n\n" + String.join("\n", addrs)
                + "\n\nAll devices must be on the same Wi-Fi, or on this device's hotspot.";
        new AlertDialog.Builder(this)
            .setTitle("Address for other devices")
            .setMessage(text)
            .setPositiveButton("OK", null)
            .show();
    }

    private static List<String> localAddresses() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) out.add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) {
            // no network
        }
        return out;
    }

    @Override
    protected void onDestroy() {
        ServerService.setObserver(null);
        super.onDestroy();
    }

    // ── small view builders ────────────────────────────────────────────────

    private LinearLayout screen() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(28), dp(72), dp(28), dp(28));
        box.setBackgroundColor(Color.parseColor("#FBF9F8"));
        box.setClickable(true);
        return box;
    }

    private TextView title(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextColor(Color.parseColor("#111827"));
        t.setGravity(Gravity.CENTER);
        return t;
    }

    private TextView body(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        t.setTextColor(Color.parseColor("#4B5563"));
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(16), 0, dp(8));
        return t;
    }

    private TextView small(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        t.setTextColor(Color.parseColor("#6B7280"));
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(8), dp(8), dp(8), dp(8));
        return t;
    }

    private Button brownButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextColor(Color.WHITE);
        b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(BROWN));
        return b;
    }

    private Button outlineButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextColor(BROWN);
        return b;
    }

    private LinearLayout.LayoutParams buttonParams() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(56));
        lp.topMargin = dp(24);
        return lp;
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private String defaultServer() {
        return getString(R.string.default_server);
    }

    private String currentServer() {
        if (isMainDevice()) return MAIN_URL;
        return prefs().getString(KEY_SERVER, defaultServer());
    }

    private boolean isMainDevice() {
        return MODE_MAIN.equals(prefs().getString(KEY_MODE, null));
    }

    /**
     * "192.168.1.20" → "http://192.168.1.20:1995". A bare local address (an IP,
     * localhost or a .local name) without a port gets a main device's :1995;
     * a real domain is left alone. Returns null for something that isn't a URL.
     */
    static String normalize(String raw) {
        String s = raw.trim();
        if (s.isEmpty()) return null;
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        Uri u = Uri.parse(s);
        String host = u.getHost();
        if (host == null || host.isEmpty()) return null;
        boolean local = host.matches("[0-9.]+") || host.equals("localhost") || host.endsWith(".local");
        if (u.getPort() == -1 && "http".equals(u.getScheme()) && local) {
            s = "http://" + host + ":" + Supervisor.WEB_PORT + (u.getPath() == null ? "" : u.getPath());
        }
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    private static boolean sameOrigin(Uri a, Uri b) {
        return a.getScheme() != null && a.getScheme().equals(b.getScheme())
            && a.getHost() != null && a.getHost().equalsIgnoreCase(b.getHost())
            && a.getPort() == b.getPort();
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }
}
