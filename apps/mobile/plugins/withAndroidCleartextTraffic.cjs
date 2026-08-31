const { withAndroidManifest } = require("expo/config-plugins");

function configureCleartextTraffic(androidManifest) {
  const application = androidManifest.manifest.application?.[0];

  if (application == null) {
    throw new Error(
      "AndroidManifest.xml is missing the application element required for cleartext traffic configuration.",
    );
  }

  application.$ ??= {};
  application.$["android:usesCleartextTraffic"] = "true";

  return androidManifest;
}

module.exports = function withAndroidCleartextTraffic(config) {
  return withAndroidManifest(config, (nextConfig) => {
    nextConfig.modResults = configureCleartextTraffic(nextConfig.modResults);
    return nextConfig;
  });
};

module.exports.configureCleartextTraffic = configureCleartextTraffic;
