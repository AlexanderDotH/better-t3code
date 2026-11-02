const { withGradleProperties } = require("expo/config-plugins");

// Expo's 2GB heap exhausts memory during :app:mergeExtDexDebug.
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
