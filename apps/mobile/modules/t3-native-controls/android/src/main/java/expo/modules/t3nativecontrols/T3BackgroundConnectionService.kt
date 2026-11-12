package expo.modules.t3nativecontrols

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

class T3BackgroundConnectionService : Service() {
  private val sessionId = UUID.randomUUID().toString()
  private var taskContext: ReactContext? = null
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val context = (application as ReactApplication).reactHost?.currentReactContext
    if (intent == null || context == null || !canNotify(this)) {
      stopSelf()
      return START_NOT_STICKY
    }

    try {
      val notification = notification(
        checkNotNull(intent.getStringExtra(EXTRA_TITLE)),
        checkNotNull(intent.getStringExtra(EXTRA_BODY)),
        checkNotNull(intent.getStringExtra(EXTRA_CHANNEL_NAME)),
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      runningInstance = this
      if (taskContext == null) {
        taskContext = context
        holdWakeLock()
        // An active Headless JS task keeps React Native's heartbeat and reconnect timers running.
        HeadlessJsTaskContext.getInstance(context).startTask(
          HeadlessJsTaskConfig(
            TASK_NAME,
            Arguments.createMap().apply { putString("sessionId", sessionId) },
            0,
            true,
          ),
        )
      }
    } catch (error: IllegalStateException) {
      stopAfterStartFailure(error)
    } catch (error: SecurityException) {
      stopAfterStartFailure(error)
    }
    // Restore from the saved preference on app launch, never resurrect an unmounted JS runtime.
    return START_NOT_STICKY
  }

  private fun stopAfterStartFailure(error: RuntimeException) {
    Log.w(TASK_NAME, "Could not keep server connections active", error)
    stopSelf()
  }

  @Synchronized
  fun updateNotification(title: String, body: String, channelName: String): Boolean {
    if (runningInstance !== this) return false
    getSystemService(NotificationManager::class.java).notify(
      NOTIFICATION_ID,
      notification(title, body, channelName),
    )
    return true
  }

  @Suppress("DEPRECATION")
  private fun notification(title: String, body: String, channelName: String): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_LOW).apply {
          setShowBadge(false)
          setSound(null, null)
          enableVibration(false)
        },
      )
    }
    val launchIntent = checkNotNull(packageManager.getLaunchIntentForPackage(packageName)).apply {
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      NOTIFICATION_ID,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    return builder
      .setSmallIcon(R.drawable.t3_background_connection)
      .setContentTitle(title)
      .setContentText(body)
      .setContentIntent(pendingIntent)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .build()
  }

  @SuppressLint("WakelockTimeout")
  private fun holdWakeLock() {
    // The explicit opt-in lasts until this service stops; a fixed timeout would silently drop it.
    wakeLock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:background-connection")
      .apply {
        setReferenceCounted(false)
        acquire()
      }
  }

  @Synchronized
  override fun onDestroy() {
    if (runningInstance === this) runningInstance = null
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    taskContext?.let { context ->
      if (context.hasActiveReactInstance()) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(STOPPED_EVENT, sessionId)
      }
    }
    taskContext = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private const val TASK_NAME = "T3BackgroundConnection"
    private const val STOPPED_EVENT = "T3BackgroundConnectionStopped"
    private const val CHANNEL_ID = "background-connection"
    private const val NOTIFICATION_ID = 7302
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_CHANNEL_NAME = "channelName"

    @Volatile
    var runningInstance: T3BackgroundConnectionService? = null
      private set

    fun canNotify(context: Context): Boolean {
      val manager = context.getSystemService(NotificationManager::class.java)
      val permitted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
      val channelOpen = Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
        manager.getNotificationChannel(CHANNEL_ID)?.importance !=
        NotificationManager.IMPORTANCE_NONE
      return manager.areNotificationsEnabled() && permitted && channelOpen
    }

    fun start(context: Context, title: String, body: String, channelName: String) {
      val intent = Intent(context, T3BackgroundConnectionService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
        .putExtra(EXTRA_CHANNEL_NAME, channelName)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      runningInstance = null
      context.stopService(Intent(context, T3BackgroundConnectionService::class.java))
    }
  }
}
