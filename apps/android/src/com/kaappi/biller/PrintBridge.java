package com.kaappi.biller;

import android.app.Activity;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * window.KaappiAndroid.printUrl(url, jobName) for the web app (apps/web/lib/print.ts).
 *
 * Android's WebView ignores window.print(), so bills and kitchen tickets never
 * printed in the app. This loads the receipt page in an off-screen WebView
 * (same cookie store, so the signed-in session applies) and hands it to
 * Android's print framework: any installed printer service (Wi-Fi/Bluetooth
 * printer apps, Mopria) or "Save as PDF" to download the bill.
 */
final class PrintBridge {
    private final Activity activity;
    private final ServerOrigin origin;
    private WebView printView; // kept referenced until the print job is created

    interface ServerOrigin {
        String current();
    }

    PrintBridge(Activity activity, ServerOrigin origin) {
        this.activity = activity;
        this.origin = origin;
    }

    @JavascriptInterface
    public void printUrl(String url, String jobName) {
        Uri target = Uri.parse(url);
        Uri server = Uri.parse(origin.current());
        // Only the shop's own server, never an arbitrary page.
        if (target.getHost() == null || !target.getHost().equalsIgnoreCase(server.getHost())
            || target.getPort() != server.getPort() || !"http".equalsIgnoreCase(target.getScheme())
                && !"https".equalsIgnoreCase(target.getScheme())) {
            return;
        }
        String name = (jobName == null || jobName.trim().isEmpty()) ? "Kaappi Biller" : jobName.trim();
        activity.runOnUiThread(() -> {
            Toast.makeText(activity, "Preparing to print…", Toast.LENGTH_SHORT).show();
            WebView view = new WebView(activity);
            view.getSettings().setJavaScriptEnabled(false); // the receipt's own auto-print script isn't needed
            view.setWebViewClient(new WebViewClient() {
                private boolean done;

                @Override
                public void onPageFinished(WebView v, String loaded) {
                    if (done) return;
                    done = true;
                    PrintManager pm = (PrintManager) activity.getSystemService(Activity.PRINT_SERVICE);
                    PrintAttributes attrs = new PrintAttributes.Builder()
                        .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                        .build();
                    pm.print(name, v.createPrintDocumentAdapter(name), attrs);
                }
            });
            printView = view;
            view.loadUrl(url);
        });
    }
}
