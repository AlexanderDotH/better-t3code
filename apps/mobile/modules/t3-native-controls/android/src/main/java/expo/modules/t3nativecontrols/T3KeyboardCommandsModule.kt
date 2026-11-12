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

  private fun commandFor(event: KeyEvent): String? {
    val primary = event.isCtrlPressed || event.isMetaPressed
    val commands = when {
      event.action != KeyEvent.ACTION_DOWN || event.repeatCount != 0 -> emptyMap()
      event.keyCode == KeyEvent.KEYCODE_TAB && hasComposerModeModifiers(event) ->
        COMPOSER_MODE_COMMANDS
      !primary && !event.isAltPressed && !event.isShiftPressed -> UNMODIFIED_COMMANDS
      !primary || event.isAltPressed -> emptyMap()
      event.isShiftPressed -> SHIFTED_COMMANDS
      else -> PRIMARY_COMMANDS
    }
    return commands[event.keyCode]
  }

  private fun hasComposerModeModifiers(event: KeyEvent): Boolean =
    event.isShiftPressed && !event.isCtrlPressed && !event.isAltPressed && !event.isMetaPressed
}

private val COMPOSER_MODE_COMMANDS = mapOf(KeyEvent.KEYCODE_TAB to "cycleComposerMode")

private val UNMODIFIED_COMMANDS = mapOf(
  KeyEvent.KEYCODE_DPAD_DOWN to "paletteNext",
  KeyEvent.KEYCODE_DPAD_UP to "palettePrevious",
  KeyEvent.KEYCODE_ESCAPE to "paletteDismiss",
)

private val PRIMARY_COMMANDS = mapOf(
  KeyEvent.KEYCODE_K to "commandPalette",
  KeyEvent.KEYCODE_F to "focusSearch",
  KeyEvent.KEYCODE_N to "newTask",
  KeyEvent.KEYCODE_LEFT_BRACKET to "back",
  KeyEvent.KEYCODE_RIGHT_BRACKET to "forward",
  KeyEvent.KEYCODE_BACKSLASH to "toggleSidebar",
  KeyEvent.KEYCODE_1 to "thread.jump.1",
  KeyEvent.KEYCODE_2 to "thread.jump.2",
  KeyEvent.KEYCODE_3 to "thread.jump.3",
  KeyEvent.KEYCODE_4 to "thread.jump.4",
  KeyEvent.KEYCODE_5 to "thread.jump.5",
  KeyEvent.KEYCODE_6 to "thread.jump.6",
  KeyEvent.KEYCODE_7 to "thread.jump.7",
  KeyEvent.KEYCODE_8 to "thread.jump.8",
  KeyEvent.KEYCODE_9 to "thread.jump.9",
)

private val SHIFTED_COMMANDS = mapOf(
  KeyEvent.KEYCODE_C to "copyThreadReference",
  KeyEvent.KEYCODE_H to "cycleHost",
  KeyEvent.KEYCODE_F to "files",
  KeyEvent.KEYCODE_T to "terminal",
  KeyEvent.KEYCODE_R to "review",
)
