package expo.modules.t3nativecontrols

import androidx.activity.ComponentActivity
import androidx.lifecycle.Lifecycle
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3BackgroundConnectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3BackgroundConnection")

    Function("setConnection") { enabled: Boolean, title: String, body: String, channelName: String ->
      val context = appContext.reactContext ?: return@Function false
      if (!enabled || !T3BackgroundConnectionService.canNotify(context)) {
        T3BackgroundConnectionService.stop(context)
        return@Function false
      }

      val service = T3BackgroundConnectionService.runningInstance
      if (service != null) {
        return@Function service.updateNotification(title, body, channelName)
      }

      // Android 12+ forbids starting a foreground service after the activity is backgrounded.
      val activity = appContext.currentActivity as? ComponentActivity ?: return@Function false
      if (!activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return@Function false
      T3BackgroundConnectionService.start(context, title, body, channelName)
      true
    }
  }
}
