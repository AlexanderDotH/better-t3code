package expo.modules.t3nativecontrols

import android.content.Context
import android.view.KeyEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class T3KeyboardCommandsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3KeyboardCommands")

    View(T3KeyboardCommandsView::class) {
      Prop("enabledCommands") { view: T3KeyboardCommandsView, commands: List<String> ->
        view.enabledCommands = commands.toSet()
      }
      Events("onCommand")
    }
  }
}

class T3KeyboardCommandsView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  private val onCommand by EventDispatcher()
  var enabledCommands = emptySet<String>()

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val command =
      when {
        event.action != KeyEvent.ACTION_DOWN || event.repeatCount != 0 -> null
        event.keyCode == KeyEvent.KEYCODE_TAB &&
          hasComposerModeModifiers(event) -> "cycleComposerMode"
        event.keyCode == KeyEvent.KEYCODE_C &&
          event.isCtrlPressed &&
          event.isShiftPressed &&
          !event.isAltPressed -> "copyThreadReference"
        else -> null
      }
    return if (command != null && enabledCommands.contains(command)) {
      onCommand(mapOf("command" to command))
      true
    } else {
      super.dispatchKeyEvent(event)
    }
  }

  private fun hasComposerModeModifiers(event: KeyEvent): Boolean =
    event.isShiftPressed && !event.isCtrlPressed && !event.isAltPressed && !event.isMetaPressed
}
