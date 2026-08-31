package expo.modules.t3composereditor

import android.view.KeyEvent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ComposerHardwareKeyTest {
  @Test
  fun ctrlEnterSubmits() {
    assertTrue(
      isComposerSubmitShortcut(
        KeyEvent.KEYCODE_ENTER,
        ctrlPressed = true,
        metaPressed = false
      )
    )
  }

  @Test
  fun commandEnterSubmits() {
    assertTrue(
      isComposerSubmitShortcut(
        KeyEvent.KEYCODE_ENTER,
        ctrlPressed = false,
        metaPressed = true
      )
    )
  }

  @Test
  fun plainAndShiftEnterRemainEditorInput() {
    assertFalse(
      isComposerSubmitShortcut(
        KeyEvent.KEYCODE_ENTER,
        ctrlPressed = false,
        metaPressed = false
      )
    )
    assertFalse(
      isComposerSubmitShortcut(
        KeyEvent.KEYCODE_A,
        ctrlPressed = true,
        metaPressed = false
      )
    )
  }
}
