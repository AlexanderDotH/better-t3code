const { withMainActivity } = require("expo/config-plugins");

// RN 0.85 registers back dispatch only on Android 16 with targetSdk 36; Android 13-15 otherwise bypass JS.

const CALLBACK_PROPERTY = `
  // Routes predictive-back gestures to JS on Android 13-15, where react-native
  // registers no OnBackPressedDispatcher callback of its own (it only does on
  // Android 16+). Registered in onCreate; added by withAndroidPredictiveBackCompat.
  private val predictiveBackCompatCallback = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      isEnabled = false
      onBackPressed()
      isEnabled = true
    }
  }
`;

const CALLBACK_REGISTRATION = `
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && Build.VERSION.SDK_INT < Build.VERSION_CODES.BAKLAVA) {
      onBackPressedDispatcher.addCallback(this, predictiveBackCompatCallback)
    }`;

// Disable the compat callback during default back handling to prevent dispatcher recursion.
const INVOKE_DEFAULT_WRAPPER = `override fun invokeDefaultOnBackPressed() {
    predictiveBackCompatCallback.isEnabled = false
    try {
      invokeDefaultOnBackPressedLegacy()
    } finally {
      predictiveBackCompatCallback.isEnabled = true
    }
  }

  private fun invokeDefaultOnBackPressedLegacy() {`;

function insertAfter(contents, anchor, insertion, description) {
  const index = contents.indexOf(anchor);
  if (index === -1) {
    throw new Error(
      `withAndroidPredictiveBackCompat: could not find ${description} in MainActivity — the Expo template changed; update the plugin anchors.`,
    );
  }
  const end = index + anchor.length;
  return contents.slice(0, end) + insertion + contents.slice(end);
}

function patchMainActivity(contents, language = "kt") {
  if (language !== "kt") {
    throw new Error("withAndroidPredictiveBackCompat: MainActivity must be Kotlin.");
  }
  if (contents.includes("predictiveBackCompatCallback")) {
    return contents;
  }

  let patched = insertAfter(
    contents,
    "import android.os.Bundle",
    "\nimport androidx.activity.OnBackPressedCallback",
    "the android.os.Bundle import",
  );
  patched = insertAfter(
    patched,
    "class MainActivity : ReactActivity() {",
    CALLBACK_PROPERTY,
    "the MainActivity class declaration",
  );
  patched = insertAfter(
    patched,
    "super.onCreate(null)",
    CALLBACK_REGISTRATION,
    "the super.onCreate call",
  );

  if (!patched.includes("override fun invokeDefaultOnBackPressed() {")) {
    throw new Error(
      "withAndroidPredictiveBackCompat: could not find invokeDefaultOnBackPressed in MainActivity — the Expo template changed; update the plugin anchors.",
    );
  }

  return patched.replace("override fun invokeDefaultOnBackPressed() {", INVOKE_DEFAULT_WRAPPER);
}

module.exports = function withAndroidPredictiveBackCompat(config) {
  if (config.android?.predictiveBackGestureEnabled !== true) {
    return config;
  }

  return withMainActivity(config, (nextConfig) => {
    nextConfig.modResults.contents = patchMainActivity(
      nextConfig.modResults.contents,
      nextConfig.modResults.language,
    );
    return nextConfig;
  });
};

module.exports.patchMainActivity = patchMainActivity;
