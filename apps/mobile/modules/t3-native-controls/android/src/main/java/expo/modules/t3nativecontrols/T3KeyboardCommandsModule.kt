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
    val command = commandFor(event)
    return if (command != null && enabledCommands.contains(command)) {
      onCommand(mapOf("command" to command))
      true
    } else {
      super.dispatchKeyEvent(event)
    }
  }

  private fun commandFor(event: KeyEvent): String? = when {
    event.action != KeyEvent.ACTION_DOWN || event.repeatCount != 0 -> null
    !event.isCtrlPressed && !event.isMetaPressed && !event.isAltPressed && !event.isShiftPressed && event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN -> "paletteNext"
    !event.isCtrlPressed && !event.isMetaPressed && !event.isAltPressed && !event.isShiftPressed && event.keyCode == KeyEvent.KEYCODE_DPAD_UP -> "palettePrevious"
    !event.isCtrlPressed && !event.isMetaPressed && !event.isAltPressed && !event.isShiftPressed && event.keyCode == KeyEvent.KEYCODE_ESCAPE -> "paletteDismiss"
    event.keyCode == KeyEvent.KEYCODE_TAB && hasComposerModeModifiers(event) -> "cycleComposerMode"
    !(event.isCtrlPressed || event.isMetaPressed) || event.isAltPressed -> null
    !event.isShiftPressed -> when (event.keyCode) {
      KeyEvent.KEYCODE_K -> "commandPalette"
      KeyEvent.KEYCODE_F -> "focusSearch"
      KeyEvent.KEYCODE_N -> "newTask"
      KeyEvent.KEYCODE_LEFT_BRACKET -> "back"
      KeyEvent.KEYCODE_RIGHT_BRACKET -> "forward"
      KeyEvent.KEYCODE_BACKSLASH -> "toggleSidebar"
      KeyEvent.KEYCODE_1 -> "thread.jump.1"
      KeyEvent.KEYCODE_2 -> "thread.jump.2"
      KeyEvent.KEYCODE_3 -> "thread.jump.3"
      KeyEvent.KEYCODE_4 -> "thread.jump.4"
      KeyEvent.KEYCODE_5 -> "thread.jump.5"
      KeyEvent.KEYCODE_6 -> "thread.jump.6"
      KeyEvent.KEYCODE_7 -> "thread.jump.7"
      KeyEvent.KEYCODE_8 -> "thread.jump.8"
      KeyEvent.KEYCODE_9 -> "thread.jump.9"
      else -> null
    }
    else -> when (event.keyCode) {
      KeyEvent.KEYCODE_C -> "copyThreadReference"
      KeyEvent.KEYCODE_H -> "cycleHost"
      KeyEvent.KEYCODE_F -> "files"
      KeyEvent.KEYCODE_T -> "terminal"
      KeyEvent.KEYCODE_R -> "review"
      else -> null
    }
  }

  private fun hasComposerModeModifiers(event: KeyEvent): Boolean =
    event.isShiftPressed && !event.isCtrlPressed && !event.isAltPressed && !event.isMetaPressed
}
