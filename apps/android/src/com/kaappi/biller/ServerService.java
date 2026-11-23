package com.kaappi.biller;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

/**
 * Foreground service that keeps the embedded Kaappi Biller server (database +
 * backend) running while the app is in the background or the screen is off,
 * so other devices in the shop can keep using it. Shows a permanent
 * "Kaappi Biller is running" notification, as Android requires.
 */
public class ServerService extends Service {
    static final String ACTION_STOP = "com.kaappi.biller.STOP";
    private static final String CHANNEL = "server";
    private static final int NOTIFICATION_ID = 1;

    /** Latest state, read by MainActivity (same process). */
    enum State { STARTING, READY, FAILED, STOPPED }

    interface Observer {
        void onServerState(State state, String message);
    }

    private static volatile State state = State.STOPPED;
    private static volatile String message = "";
    private static Observer observer;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private Supervisor supervisor;
    private Thread worker;

    static State state() {
        return state;
    }

    static String message() {
        return message;
    }

    static void setObserver(Observer o) {
        observer = o;
        if (o != null) o.onServerState(state, message);
    }

    private static void publish(State s, String m) {
        state = s;
        message = m;
        MAIN.post(() -> {
            Observer o = observer;
            if (o != null) o.onServerState(s, m);
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Kaappi Biller server",
            NotificationManager.IMPORTANCE_LOW));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopServer();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(NOTIFICATION_ID, notification("Starting…"));
        if (worker == null || !worker.isAlive()) {
            if (supervisor != null && supervisor.isRunning()) return START_STICKY;
            supervisor = new Supervisor(this, msg -> {
                publish(State.STARTING, msg);
                updateNotification(msg);
            });
            publish(State.STARTING, "Starting…");
            worker = new Thread(() -> {
                try {
                    supervisor.start();
                    publish(State.READY, "Ready");
                    updateNotification("Running: this phone is the shop's main device");
                } catch (Exception e) {
                    Log.e("KaappiServer", "start failed", e);
                    publish(State.FAILED, e.getMessage() == null ? e.toString() : e.getMessage());
                    updateNotification("Could not start. Open the app for details.");
                }
            }, "kaappi-supervisor");
            worker.start();
        }
        return START_STICKY;
    }

    private void stopServer() {
        if (supervisor != null) supervisor.stop();
        supervisor = null;
        publish(State.STOPPED, "Stopped");
    }

    @Override
    public void onDestroy() {
        stopServer();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification notification(String text) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setContentTitle("Kaappi Biller is running")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .build();
    }

    private void updateNotification(String text) {
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(text));
    }
}
