package com.kaappi.biller;

import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.Settings;
import android.util.Base64;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * window.KaappiAndroid.printUrl(url, jobName) for the web app (apps/web/lib/print.ts).
 *
 * Android's WebView ignores window.print(), so bills and kitchen tickets never
 * printed in the app. This loads the receipt page in an off-screen WebView
 * (same cookie store, so the signed-in session applies) and hands it to
 * Android's print framework: any installed printer service (Wi-Fi/Bluetooth
 * printer apps, Mopria) or "Save as PDF" to download the bill.
 *
 * Bluetooth thermal printers (app 1.2.0+): the server renders the ESC/POS
 * bytes (Settings › General › Thermal printer › Bluetooth) and the page hands them to
 * printEscpos(); this sends them to the printer paired with THIS device over
 * Bluetooth serial (SPP) and reports back through
 * window.__kaappiPrintDone(id, error). The chosen printer is kept per device.
 * targetSdk 28, so the install-time BLUETOOTH/BLUETOOTH_ADMIN permissions are
 * enough, also on Android 12+.
 */
final class PrintBridge {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String PREFS = "kaappi_bluetooth_printer";

    private final Activity activity;
    private final ServerOrigin origin;
    private final WebView pageView;
    // One job at a time: a printer takes one Bluetooth connection.
    private final ExecutorService printQueue = Executors.newSingleThreadExecutor();
    private WebView printView; // kept referenced until the print job is created

    interface ServerOrigin {
        String current();
    }

    PrintBridge(Activity activity, ServerOrigin origin, WebView pageView) {
        this.activity = activity;
        this.origin = origin;
        this.pageView = pageView;
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

    // ── Bluetooth thermal printer ───────────────────────────────────────────

    private SharedPreferences prefs() {
        return activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @SuppressWarnings("deprecation")
    private static BluetoothAdapter adapter() {
        return BluetoothAdapter.getDefaultAdapter();
    }

    /** Devices paired in Android's Bluetooth settings, printers first, as JSON [{name, address}]. */
    @JavascriptInterface
    public String listBluetoothPrinters() {
        JSONArray out = new JSONArray();
        try {
            BluetoothAdapter bt = adapter();
            Set<BluetoothDevice> bonded = bt == null ? null : bt.getBondedDevices();
            if (bonded == null) return out.toString();
            List<BluetoothDevice> printers = new ArrayList<>();
            List<BluetoothDevice> others = new ArrayList<>();
            for (BluetoothDevice d : bonded) {
                boolean imaging = d.getBluetoothClass() != null
                    && d.getBluetoothClass().getMajorDeviceClass() == android.bluetooth.BluetoothClass.Device.Major.IMAGING;
                (imaging ? printers : others).add(d);
            }
            printers.addAll(others);
            for (BluetoothDevice d : printers) {
                JSONObject o = new JSONObject();
                o.put("name", d.getName() == null ? "" : d.getName());
                o.put("address", d.getAddress());
                out.put(o);
            }
        } catch (Exception ignored) {
            // Bluetooth off or unavailable: an empty list.
        }
        return out.toString();
    }

    @JavascriptInterface
    public String getBluetoothPrinter() {
        String address = prefs().getString("address", null);
        if (address == null) return "";
        try {
            JSONObject o = new JSONObject();
            o.put("address", address);
            o.put("name", prefs().getString("name", ""));
            return o.toString();
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public void setBluetoothPrinter(String address, String name) {
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address.toUpperCase())) return;
        prefs().edit().putString("address", address.toUpperCase()).putString("name", name == null ? "" : name).apply();
    }

    @JavascriptInterface
    public void openBluetoothSettings() {
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS));
            } catch (Exception e) {
                Toast.makeText(activity, "Open Bluetooth in the phone's Settings", Toast.LENGTH_LONG).show();
            }
        });
    }

    /** Send ESC/POS bytes (base64) to this device's chosen printer; answers via window.__kaappiPrintDone. */
    @JavascriptInterface
    public void printEscpos(String base64, String callbackId) {
        final byte[] data;
        try {
            data = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            done(callbackId, "The print job was damaged. Try again.");
            return;
        }
        printQueue.execute(() -> done(callbackId, sendToPrinter(data)));
    }

    /** null when the printer took the data, otherwise a reason a cashier can act on. */
    private String sendToPrinter(byte[] data) {
        BluetoothAdapter bt = adapter();
        if (bt == null) return "This phone has no Bluetooth.";
        if (!bt.isEnabled()) {
            activity.runOnUiThread(() -> {
                try {
                    activity.startActivity(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE));
                } catch (Exception ignored) {
                    // the message below still tells the cashier
                }
            });
            return "Bluetooth is off. Turn it on and print again.";
        }
        String address = prefs().getString("address", null);
        if (address == null) return "No Bluetooth printer chosen on this phone. Choose one in Settings › General › Thermal printer.";
        BluetoothDevice device;
        try {
            device = bt.getRemoteDevice(address);
        } catch (IllegalArgumentException e) {
            return "The saved printer address is not valid. Choose the printer again.";
        }
        try {
            bt.cancelDiscovery(); // discovery slows a connection down badly
        } catch (Exception ignored) {
            // not fatal
        }
        BluetoothSocket socket = null;
        try {
            socket = connect(device);
            OutputStream out = socket.getOutputStream();
            // Small chunks: cheap printers have small receive buffers.
            for (int off = 0; off < data.length; off += 512) {
                out.write(data, off, Math.min(512, data.length - off));
                out.flush();
                Thread.sleep(15);
            }
            // Closing at once can cut off the end of the bill on some printers.
            Thread.sleep(Math.min(4000, 400 + data.length / 8));
            return null;
        } catch (Exception e) {
            String name = prefs().getString("name", "");
            return "Could not print to " + (name.isEmpty() ? "the printer" : name)
                + ". Check it is on, has paper and is near this phone.";
        } finally {
            if (socket != null) {
                try {
                    socket.close();
                } catch (Exception ignored) {
                    // already closed
                }
            }
        }
    }

    /** Standard SPP connection, then the insecure one, then channel 1 (many cheap printers need it). */
    private static BluetoothSocket connect(BluetoothDevice device) throws Exception {
        Exception last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            BluetoothSocket socket = null;
            try {
                if (attempt == 0) {
                    socket = device.createRfcommSocketToServiceRecord(SPP);
                } else if (attempt == 1) {
                    socket = device.createInsecureRfcommSocketToServiceRecord(SPP);
                } else {
                    Method m = device.getClass().getMethod("createRfcommSocket", int.class);
                    socket = (BluetoothSocket) m.invoke(device, 1);
                }
                socket.connect();
                return socket;
            } catch (Exception e) {
                last = e;
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {
                        // next attempt
                    }
                }
            }
        }
        throw last;
    }

    private void done(String callbackId, String error) {
        String js = "window.__kaappiPrintDone && window.__kaappiPrintDone("
            + JSONObject.quote(callbackId == null ? "" : callbackId) + ","
            + JSONObject.quote(error == null ? "" : error) + ")";
        pageView.post(() -> pageView.evaluateJavascript(js, null));
    }
}
