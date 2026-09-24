package com.t3tools.indexer;

import com.google.gson.Gson;
import java.io.InputStreamReader;
import java.io.BufferedReader;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.function.Consumer;
import org.eclipse.jdt.core.compiler.IProblem;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.eclipse.jdt.core.JavaCore;
import org.eclipse.jdt.core.dom.*;
import org.w3c.dom.Element;

public final class ProjectIndexer {
    private record Source(String filePath, String source, String contentHash, String[] configDependencies) {}
    private record StreamHeader(String root) {}
    private record Input(String root, Source[] sources, String[] configPaths) {}
    private record Target(String filePath, int startOffset, int endOffset) {}
    private record Call(String filePath, int startOffset, int endOffset, Target[] targets, boolean exact, String reason) {}
    private record Gap(String message, String filePath) {}
    private record Output(List<Call> calls, List<Gap> gaps) {}
    private record SourceUnit(String filePath, CompilationUnit unit, List<IProblem> errors) {}
    private record Environment(String[] classes, String[] sources, String compliance) {}

    public static void main(String[] args) {
        try {
            var gson = new Gson();
            if (Arrays.asList(args).contains("--stream")) {
                var reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
                var header = gson.fromJson(reader.readLine(), StreamHeader.class);
                var sources = new ArrayList<Source>();
                Set<String> configurations = new LinkedHashSet<>();
                String line;
                while ((line = reader.readLine()) != null) {
                    var source = gson.fromJson(line, Source.class);
                    sources.add(source);
                    if (source.configDependencies() != null) configurations.addAll(Arrays.asList(source.configDependencies()));
                }
                analyze(new Input(header.root(), sources.toArray(Source[]::new), configurations.toArray(String[]::new)),
                    call -> System.out.println(gson.toJson(Map.of("type", "call", "call", call))),
                    gap -> System.out.println(gson.toJson(Map.of("type", "gap", "gap", gap))));
            } else {
                var input = gson.fromJson(new InputStreamReader(System.in, StandardCharsets.UTF_8), Input.class);
                System.out.print(gson.toJson(analyze(input, null, null)));
            }
        } catch (Exception error) {
            System.err.println(error.getMessage());
            System.exit(1);
        }
    }

    private static Output analyze(Input input, Consumer<Call> emitCall, Consumer<Gap> emitGap) throws Exception {
        var root = Path.of(input.root()).toAbsolutePath().normalize();
        var gaps = new ArrayList<Gap>();
        var resolved = new ArrayList<Call>();
        Consumer<Gap> addGap = emitGap == null ? gaps::add : emitGap;
        Consumer<Call> addCall = emitCall == null ? resolved::add : emitCall;
        var environment = environment(root, input.configPaths(), addGap);
        var declarations = new HashMap<String, Target>();
        var types = new HashMap<String, Target>();
        var units = new ArrayList<SourceUnit>();
        for (var source : input.sources()) {
            var absolute = root.resolve(source.filePath()).normalize();
            if (!absolute.startsWith(root)) continue;
            var parser = ASTParser.newParser(AST.getJLSLatest());
            parser.setKind(ASTParser.K_COMPILATION_UNIT);
            parser.setResolveBindings(true);
            parser.setBindingsRecovery(false);
            parser.setStatementsRecovery(true);
            var options = new HashMap<String, String>();
            JavaCore.setComplianceOptions(environment.compliance(), options);
            parser.setCompilerOptions(options);
            parser.setEnvironment(environment.classes(), environment.sources(), Arrays.stream(environment.sources()).map(path -> "UTF-8").toArray(String[]::new), true);
            parser.setUnitName(absolute.toString());
            parser.setSource(readSource(source, root).toCharArray());
            // ASTParser resolves existing source/class paths; it never invokes Maven, Gradle or annotation processors.
            var unit = (CompilationUnit) parser.createAST(null);
            var errors = Arrays.stream(unit.getProblems()).filter(problem -> problem.isError()).toList();
            if (!errors.isEmpty()) addGap.accept(new Gap("JDT reported " + errors.size() + " diagnostics; existing source/class paths may be incomplete. No build or dependency acquisition was attempted.", source.filePath()));
            unit.accept(new ASTVisitor() {
                @Override public boolean visit(MethodDeclaration node) {
                    var binding = node.resolveBinding();
                    if (binding != null && !binding.isRecovered()) declarations.put(binding.getMethodDeclaration().getKey(), target(source.filePath(), node));
                    return true;
                }
                private void declaredType(ITypeBinding binding, ASTNode node) {
                    if (binding != null && !binding.isRecovered()) types.put(binding.getTypeDeclaration().getKey(), target(source.filePath(), node));
                }
                @Override public boolean visit(TypeDeclaration node) { declaredType(node.resolveBinding(), node); return true; }
                @Override public boolean visit(EnumDeclaration node) { declaredType(node.resolveBinding(), node); return true; }
                @Override public boolean visit(RecordDeclaration node) { declaredType(node.resolveBinding(), node); return true; }
                @Override public boolean visit(AnonymousClassDeclaration node) { declaredType(node.resolveBinding(), node); return true; }
            });
            units.add(new SourceUnit(source.filePath(), unit, errors));
        }
        for (int index = 0; index < units.size(); index++) {
            var source = units.get(index);
            source.unit().accept(new ASTVisitor() {
                private void call(ASTNode node, IMethodBinding binding) {
                    boolean invalid = source.errors().stream().anyMatch(error -> error.getSourceStart() < node.getStartPosition() + node.getLength() && error.getSourceEnd() >= node.getStartPosition());
                    Target declaration = null;
                    if (binding != null && !binding.isRecovered()) {
                        declaration = declarations.get(binding.getMethodDeclaration().getKey());
                        if (declaration == null && binding.isConstructor() && binding.getDeclaringClass() != null) declaration = types.get(binding.getDeclaringClass().getTypeDeclaration().getKey());
                    }
                    addCall.accept(new Call(source.filePath(), node.getStartPosition(), node.getStartPosition() + node.getLength(), declaration == null ? new Target[0] : new Target[]{declaration}, declaration != null && !invalid, declaration == null ? "No source declaration binding (external, missing dependency, recovered or dynamic target)." : null));
                }
                @Override public boolean visit(MethodInvocation node) { call(node, node.resolveMethodBinding()); return true; }
                @Override public boolean visit(SuperMethodInvocation node) { call(node, node.resolveMethodBinding()); return true; }
                @Override public boolean visit(ClassInstanceCreation node) { call(node, node.resolveConstructorBinding()); return true; }
                @Override public boolean visit(ConstructorInvocation node) { call(node, node.resolveConstructorBinding()); return true; }
                @Override public boolean visit(SuperConstructorInvocation node) { call(node, node.resolveConstructorBinding()); return true; }
            });
            units.set(index, null);
        }
        return new Output(resolved, gaps);
    }

    private static String readSource(Source source, Path root) throws Exception {
        if (source.source() != null) return source.source();
        var file = root.resolve(source.filePath()).normalize();
        if (!file.startsWith(root)) throw new IllegalArgumentException("Source descriptor leaves the project root.");
        var bytes = Files.readAllBytes(file);
        var hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        if (!hash.equals(source.contentHash())) throw new IllegalArgumentException("Source changed before compiler analysis: " + source.filePath());
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static Target target(String filePath, ASTNode node) {
        return new Target(filePath, node.getStartPosition(), node.getStartPosition() + node.getLength());
    }

    private static Environment environment(Path root, String[] configurations, Consumer<Gap> gaps) {
        Set<String> classes = new LinkedHashSet<>();
        Set<String> sources = new LinkedHashSet<>();
        String compliance = JavaCore.VERSION_21;
        sources.add(root.toString());
        for (var configPath : configurations) {
            Path config = root.resolve(configPath).normalize();
            if (!config.startsWith(root)) continue;
            Path directory = config.getParent();
            addDirectory(sources, directory.resolve("src/main/java"));
            addDirectory(sources, directory.resolve("src/test/java"));
            try {
                if (config.getFileName().toString().equals(".classpath")) {
                    var document = xml(config);
                    var entries = document.getElementsByTagName("classpathentry");
                    for (int index = 0; index < entries.getLength(); index++) {
                        var entry = (Element) entries.item(index);
                        var file = directory.resolve(entry.getAttribute("path")).normalize();
                        switch (entry.getAttribute("kind")) {
                            case "src" -> addDirectory(sources, file);
                            case "lib" -> {
                                if (Files.exists(file)) classes.add(file.toString());
                                else gaps.accept(new Gap("An Eclipse classpath library is missing: " + entry.getAttribute("path"), configPath));
                            }
                            case "con", "var" -> gaps.accept(new Gap("An Eclipse classpath container/variable was not executed or expanded; configure existing library paths for complete bindings.", configPath));
                            default -> { }
                        }
                    }
                } else if (config.getFileName().toString().equals("pom.xml")) {
                    var document = xml(config);
                    Map<String, String> properties = new LinkedHashMap<>();
                    properties.put("project.basedir", directory.toString());
                    var propertyNodes = document.getElementsByTagName("properties");
                    if (propertyNodes.getLength() > 0) {
                        var children = propertyNodes.item(0).getChildNodes();
                        for (int index = 0; index < children.getLength(); index++) if (children.item(index) instanceof Element property) properties.put(property.getTagName(), property.getTextContent().trim());
                    }
                    var configuredRelease = properties.getOrDefault("maven.compiler.release", properties.getOrDefault("maven.compiler.source", ""));
                    if (!configuredRelease.isBlank()) compliance = configuredRelease;
                    for (var tag : List.of("sourceDirectory", "testSourceDirectory")) {
                        var entries = document.getElementsByTagName(tag);
                        for (int index = 0; index < entries.getLength(); index++) addDirectory(sources, directory.resolve(expand(entries.item(index).getTextContent().trim(), properties)));
                    }
                    var dependencies = document.getElementsByTagName("dependency");
                    for (int index = 0; index < dependencies.getLength(); index++) {
                        var dependency = (Element) dependencies.item(index);
                        String group = expand(text(dependency, "groupId"), properties);
                        String artifact = expand(text(dependency, "artifactId"), properties);
                        String version = expand(text(dependency, "version"), properties);
                        String system = expand(text(dependency, "systemPath"), properties);
                        Path file = !system.isBlank() ? directory.resolve(system) : Path.of(System.getProperty("user.home"), ".m2", "repository", group.replace('.', '/'), artifact, version, artifact + "-" + version + ".jar");
                        if (!version.contains("${") && Files.isRegularFile(file)) classes.add(file.toString());
                        else gaps.accept(new Gap("A Maven dependency is not available as an existing local jar: " + group + ":" + artifact + ":" + version + ". No dependency download was attempted.", configPath));
                    }
                    if (document.getElementsByTagName("parent").getLength() > 0 || document.getElementsByTagName("profiles").getLength() > 0 || document.getElementsByTagName("plugins").getLength() > 0) gaps.accept(new Gap("Maven parent/profile/plugin transformations are not executed; effective build configuration may differ from the readable source/class paths.", configPath));
                } else if (configPath.contains("gradle")) gaps.accept(new Gap("Gradle scripts are not executed. Existing Eclipse classpath entries and conventional source paths are used.", configPath));
            } catch (Exception error) { gaps.accept(new Gap("Java configuration could not be read: " + error.getMessage(), configPath)); }
        }
        if (configurations.length == 0) gaps.accept(new Gap("No Java source/class-path configuration was inventoried; bindings use the project root and available runtime classes.", null));
        return new Environment(classes.toArray(String[]::new), sources.toArray(String[]::new), compliance);
    }

    private static void addDirectory(Set<String> directories, Path directory) {
        if (Files.isDirectory(directory)) directories.add(directory.toAbsolutePath().normalize().toString());
    }

    private static org.w3c.dom.Document xml(Path file) throws Exception {
        var factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        return factory.newDocumentBuilder().parse(file.toFile());
    }

    private static String text(Element element, String tag) {
        var nodes = element.getElementsByTagName(tag);
        return nodes.getLength() == 0 ? "" : nodes.item(0).getTextContent().trim();
    }

    private static String expand(String value, Map<String, String> properties) {
        for (var entry : properties.entrySet()) value = value.replace("${" + entry.getKey() + "}", entry.getValue());
        return value;
    }
}
