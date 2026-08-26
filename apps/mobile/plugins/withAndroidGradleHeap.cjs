const { withGradleProperties } = require("expo/config-plugins");

// The Expo template's 2GB heap is too small for D8 dex merging in this app,
// causing OutOfMemoryError in :app:mergeExtDexDebug.
const JVM_ARGS = "-Xmx4096m -XX:MaxMetaspaceSize=1024m";

function configureGradleProperties(gradleProperties) {
  const properties = gradleProperties.filter(
    (item) => !(item.type === "property" && item.key === "org.gradle.jvmargs"),
  );

  properties.push({
    type: "property",
    key: "org.gradle.jvmargs",
    value: JVM_ARGS,
  });

  return properties;
}

module.exports = function withAndroidGradleHeap(config) {
  return withGradleProperties(config, (nextConfig) => {
    nextConfig.modResults = configureGradleProperties(nextConfig.modResults);
    return nextConfig;
  });
};

module.exports.configureGradleProperties = configureGradleProperties;
