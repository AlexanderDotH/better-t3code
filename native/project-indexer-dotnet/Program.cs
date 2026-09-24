using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace T3.ProjectIndexer;

internal sealed record SourceInput(string FilePath, string? Source, string? ContentHash = null, string[]? ConfigDependencies = null);
internal sealed record StreamHeader(string Root);
internal sealed record IndexInput(string Root, SourceInput[] Sources, string[] ConfigPaths);
internal sealed record SourceTarget(string FilePath, int StartOffset, int EndOffset);
internal sealed record CallResult(string FilePath, int StartOffset, int EndOffset, SourceTarget[] Targets, bool Exact, string? Reason);
internal sealed record Gap(string Message, string? FilePath = null);
internal sealed record IndexResult(List<CallResult> Calls, List<Gap> Gaps);
internal sealed record Project(string Path, SourceInput[] Sources, XElement? Xml);

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    private static int Main(string[] args)
    {
        try
        {
            if (args.Contains("--stream"))
            {
                var header = JsonSerializer.Deserialize<StreamHeader>(Console.In.ReadLine() ?? "", JsonOptions) ?? throw new InvalidDataException("Missing stream header.");
                var sources = new List<SourceInput>();
                var configurations = new HashSet<string>();
                string? line;
                while ((line = Console.In.ReadLine()) is not null)
                {
                    var source = JsonSerializer.Deserialize<SourceInput>(line, JsonOptions) ?? throw new InvalidDataException("Invalid source descriptor.");
                    sources.Add(source);
                    configurations.UnionWith(source.ConfigDependencies ?? []);
                }
                Analyze(new IndexInput(header.Root, sources.ToArray(), configurations.ToArray()),
                    call => Console.Out.WriteLine(JsonSerializer.Serialize(new { type = "call", call }, JsonOptions)),
                    gap => Console.Out.WriteLine(JsonSerializer.Serialize(new { type = "gap", gap }, JsonOptions)));
                return 0;
            }
            var request = JsonSerializer.Deserialize<IndexInput>(Console.In.ReadToEnd(), JsonOptions) ?? throw new InvalidDataException("Missing indexing request." );
            var result = Analyze(request);
            Console.Out.Write(JsonSerializer.Serialize(result, JsonOptions));
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static IndexResult Analyze(IndexInput input, Action<CallResult>? emitCall = null, Action<Gap>? emitGap = null)
    {
        var result = new IndexResult([], []);
        Action<CallResult> addCall = emitCall ?? (call => result.Calls.Add(call));
        Action<Gap> addGap = emitGap ?? (gap => result.Gaps.Add(gap));
        var root = Path.GetFullPath(input.Root);
        var projects = LoadProjects(input, root, addGap);
        var compilations = new Dictionary<string, CSharpCompilation>();
        var building = new HashSet<string>();
        var runtimeDirectory = Path.GetDirectoryName(typeof(object).Assembly.Location)!;
        var platformReferences = ((string?)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") ?? "")
            .Split(Path.PathSeparator).Where(file => file.StartsWith(runtimeDirectory + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            .Select(file => MetadataReference.CreateFromFile(file)).ToArray();

        CSharpCompilation Compile(Project project)
        {
            if (compilations.TryGetValue(project.Path, out var cached)) return cached;
            building.Add(project.Path);
            var directory = Path.GetDirectoryName(project.Path)!;
            var defines = Property(project.Xml, "DefineConstants").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(value => SyntaxFacts.IsValidIdentifier(value)).ToArray();
            var languageVersion = LanguageVersion.Latest;
            if (Property(project.Xml, "LangVersion") is { Length: > 0 } configuredVersion && !LanguageVersionFacts.TryParse(configuredVersion, out languageVersion))
                addGap(new Gap("Configured C# language version could not be interpreted; syntax was parsed with the available Roslyn version.", Relative(root, project.Path)));
            var parseOptions = new CSharpParseOptions(languageVersion, preprocessorSymbols: defines);
            var trees = project.Sources.Select(source => CSharpSyntaxTree.ParseText(ReadSource(source, root), parseOptions, Path.Combine(root, source.FilePath))).ToList();
            if (Property(project.Xml, "ImplicitUsings") is "enable" or "true")
                trees.Add(CSharpSyntaxTree.ParseText("global using System; global using System.Collections.Generic; global using System.IO; global using System.Linq; global using System.Net.Http; global using System.Threading; global using System.Threading.Tasks;", parseOptions, "<implicit-usings>"));
            var references = new List<MetadataReference>(platformReferences);
            AddExistingReferences(project, root, references, addGap);
            foreach (var reference in project.Xml?.Descendants().Where(node => node.Name.LocalName == "ProjectReference") ?? [])
            {
                var include = reference.Attribute("Include")?.Value;
                if (string.IsNullOrWhiteSpace(include)) continue;
                var referencePath = Path.GetFullPath(Path.Combine(directory, include.Replace('\\', Path.DirectorySeparatorChar)));
                var dependency = projects.Find(candidate => candidate.Path == referencePath);
                if (dependency is null || building.Contains(referencePath))
                {
                    addGap(new Gap("A project reference is unavailable or cyclic; no project build was attempted.", Relative(root, project.Path)));
                    continue;
                }
                references.Add(Compile(dependency).ToMetadataReference());
            }
            var options = new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary,
                allowUnsafe: Property(project.Xml, "AllowUnsafeBlocks") == "true",
                nullableContextOptions: Property(project.Xml, "Nullable") == "enable" ? NullableContextOptions.Enable : NullableContextOptions.Disable);
            var compilation = CSharpCompilation.Create($"Index_{compilations.Count}", trees, references, options);
            building.Remove(project.Path);
            compilations[project.Path] = compilation;
            return compilation;
        }

        foreach (var project in projects)
        {
            var compilation = Compile(project);
            foreach (var tree in compilation.SyntaxTrees.Where(tree => tree.FilePath != "<implicit-usings>"))
            {
                var filePath = Relative(root, tree.FilePath);
                var model = compilation.GetSemanticModel(tree, ignoreAccessibility: false);
                var errors = model.GetDiagnostics().Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error).ToArray();
                if (errors.Length > 0) addGap(new Gap($"Roslyn reported {errors.Length} diagnostics; existing references may be incomplete. No restore, build, analyzer or source generator was run.", filePath));
                foreach (var node in tree.GetRoot().DescendantNodesAndSelf())
                {
                    if (node is not InvocationExpressionSyntax and not ObjectCreationExpressionSyntax and not ImplicitObjectCreationExpressionSyntax and not ConstructorInitializerSyntax) continue;
                    var symbolInfo = model.GetSymbolInfo(node);
                    var symbols = symbolInfo.Symbol is IMethodSymbol selected ? new[] { selected } : symbolInfo.CandidateSymbols.OfType<IMethodSymbol>().ToArray();
                    var targets = symbols.SelectMany(symbol => (symbol.ReducedFrom ?? symbol).OriginalDefinition.DeclaringSyntaxReferences)
                        .Select(reference => reference.GetSyntax())
                        .Where(declaration => declaration.SyntaxTree.FilePath != "<implicit-usings>" && IsInside(root, declaration.SyntaxTree.FilePath))
                        .Select(declaration => new SourceTarget(Relative(root, declaration.SyntaxTree.FilePath), declaration.Span.Start, declaration.Span.End))
                        .Distinct().ToArray();
                    var exact = symbolInfo.Symbol is IMethodSymbol && targets.Length == 1 && !errors.Any(error => error.Location.SourceSpan.OverlapsWith(node.Span));
                    var reason = symbolInfo.CandidateReason == CandidateReason.None ? null : symbolInfo.CandidateReason.ToString();
                    addCall(new CallResult(filePath, node.Span.Start, node.Span.End, targets, exact, reason));
                }
            }
        }
        return result;
    }

    private static List<Project> LoadProjects(IndexInput input, string root, Action<Gap> addGap)
    {
        var configurations = new Dictionary<string, XElement?>();
        foreach (var config in input.ConfigPaths.Where(config => config.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase)))
        {
            var absolute = Path.GetFullPath(Path.Combine(root, config));
            if (!IsInside(root, absolute)) continue;
            try
            {
                var xml = XDocument.Load(absolute).Root;
                configurations[absolute] = xml;
                if (xml?.DescendantsAndSelf().Any(node => node.Attribute("Condition") is not null || node.Name.LocalName is "Import" or "Compile" || node.Value.Contains("$(")) == true)
                    addGap(new Gap("MSBuild conditions, imports or compile-item transforms were not executed. All inventoried C# files remain represented; configuration-dependent bindings may be incomplete.", config));
                var target = Property(xml, "TargetFramework");
                if (target.Length > 0 && target != "net10.0") addGap(new Gap($"Target framework {target} differs from the helper runtime; existing project/package references are used and framework fidelity may be incomplete.", config));
                if (Property(xml, "TargetFrameworks").Length > 0) addGap(new Gap("Multi-target framework configurations are analyzed with available references, not separate project builds.", config));
            }
            catch (Exception error) { addGap(new Gap($"Project configuration could not be read: {error.Message}", config)); }
        }
        var groups = new Dictionary<string, List<SourceInput>>();
        foreach (var source in input.Sources)
        {
            var absolute = Path.GetFullPath(Path.Combine(root, source.FilePath));
            if (!IsInside(root, absolute)) continue;
            var config = configurations.Keys.Where(config => IsInside(Path.GetDirectoryName(config)!, absolute)).OrderByDescending(config => config.Length).FirstOrDefault()
                ?? Path.Combine(root, "<inferred>.csproj");
            if (!groups.TryGetValue(config, out var sources)) groups[config] = sources = [];
            sources.Add(source);
        }
        return groups.Select(group => {
            configurations.TryGetValue(group.Key, out var xml);
            if (xml is null) addGap(new Gap("No usable .csproj configuration; C# semantic analysis uses available runtime references and inventoried sources."));
            return new Project(group.Key, group.Value.ToArray(), xml);
        }).ToList();
    }

    private static void AddExistingReferences(Project project, string root, List<MetadataReference> references, Action<Gap> addGap)
    {
        var directory = Path.GetDirectoryName(project.Path)!;
        var paths = new HashSet<string>();
        foreach (var reference in project.Xml?.Descendants().Where(node => node.Name.LocalName == "HintPath") ?? [])
        {
            if (reference.Value.Contains("$(")) { addGap(new Gap("A reference path needs MSBuild property evaluation; it was not executed.", Relative(root, project.Path))); continue; }
            paths.Add(Path.GetFullPath(Path.Combine(directory, reference.Value.Replace('\\', Path.DirectorySeparatorChar))));
        }
        var assetsPath = Path.Combine(directory, "obj", "project.assets.json");
        if (File.Exists(assetsPath))
        {
            try
            {
                using var assets = JsonDocument.Parse(File.ReadAllText(assetsPath));
                var packageFolders = assets.RootElement.GetProperty("packageFolders").EnumerateObject().Select(folder => folder.Name).ToArray();
                var libraries = assets.RootElement.GetProperty("libraries");
                var targetFramework = Property(project.Xml, "TargetFramework");
                var targets = assets.RootElement.GetProperty("targets");
                var target = targets.TryGetProperty(targetFramework, out var configuredTarget) ? configuredTarget : targets.EnumerateObject().First().Value;
                foreach (var library in target.EnumerateObject())
                {
                    if (!library.Value.TryGetProperty("compile", out var compile) || !libraries.TryGetProperty(library.Name, out var metadata) || !metadata.TryGetProperty("path", out var libraryPath)) continue;
                    foreach (var file in compile.EnumerateObject().Where(file => file.Name.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)))
                    {
                        var candidate = packageFolders.Select(folder => Path.Combine(folder, libraryPath.GetString()!, file.Name)).FirstOrDefault(File.Exists);
                        if (candidate is not null) paths.Add(candidate);
                        else addGap(new Gap($"An existing restored compile reference is missing: {library.Name}. No package restore was attempted.", Relative(root, project.Path)));
                    }
                }
            }
            catch (Exception error) { addGap(new Gap($"Existing project.assets.json could not be read: {error.Message}", Relative(root, project.Path))); }
        }
        else if (project.Xml?.Descendants().Any(node => node.Name.LocalName == "PackageReference") == true)
            addGap(new Gap("NuGet compile references are unavailable (no existing project.assets.json). No restore was attempted.", Relative(root, project.Path)));
        foreach (var file in paths)
        {
            try { references.Add(MetadataReference.CreateFromFile(file)); }
            catch (Exception error) { addGap(new Gap($"Metadata reference could not be read: {error.Message}", Relative(root, project.Path))); }
        }
    }

    private static string ReadSource(SourceInput source, string root)
    {
        if (source.Source is not null) return source.Source;
        var file = Path.GetFullPath(Path.Combine(root, source.FilePath));
        if (!IsInside(root, file)) throw new InvalidDataException("Source descriptor leaves the project root.");
        var bytes = File.ReadAllBytes(file);
        if (source.ContentHash is null || Convert.ToHexStringLower(SHA256.HashData(bytes)) != source.ContentHash)
            throw new InvalidDataException($"Source changed before compiler analysis: {source.FilePath}");
        return Encoding.UTF8.GetString(bytes);
    }

    private static string Property(XElement? xml, string name) => xml?.Descendants().LastOrDefault(node => node.Name.LocalName == name)?.Value.Trim() ?? "";
    private static string Relative(string root, string file) => Path.GetRelativePath(root, file).Replace(Path.DirectorySeparatorChar, '/');
    private static bool IsInside(string root, string candidate) => candidate == root || candidate.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal);
}
