param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$docs = @(Get-ChildItem -LiteralPath $rootPath -Filter '*.md' -Recurse)
$errorsFound = [System.Collections.Generic.List[string]]::new()
$linksChecked = 0
$textByPath = @{}
foreach ($doc in $docs) {
    $content = Get-Content -LiteralPath $doc.FullName -Raw -Encoding utf8
    $textByPath[$doc.FullName] = $content
    if ([string]::IsNullOrWhiteSpace($content)) { $errorsFound.Add("Empty document: $($doc.Name)") }
    foreach ($match in [regex]::Matches($content, '\[[^\]]+\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value.Trim('<','>')
        if ($target -match '^[a-z]+:' -or $target.StartsWith('#')) { continue }
        $target = $target.Split('#')[0]
        if (!$target) { continue }
        $resolved = [IO.Path]::GetFullPath((Join-Path $doc.DirectoryName $target))
        $linksChecked++
        if (!$resolved.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            $errorsFound.Add("Link escapes package: $($doc.Name) -> $target")
        } elseif (!(Test-Path -LiteralPath $resolved -PathType Leaf)) {
            $errorsFound.Add("Broken link: $($doc.Name) -> $target")
        }
    }
}
$requirements = Get-Content -LiteralPath (Join-Path $rootPath 'docs/requirements.md') -Raw -Encoding utf8
$acceptance = Get-Content -LiteralPath (Join-Path $rootPath 'docs/delivery/acceptance-criteria.md') -Raw -Encoding utf8
$todo = Get-Content -LiteralPath (Join-Path $rootPath 'to-do.md') -Raw -Encoding utf8
$reqMatches = [regex]::Matches($requirements, '(?m)^\| (REQ-\d{3}) \|(.+)$')
$reqIds = @($reqMatches | ForEach-Object { $_.Groups[1].Value })
$acIds = @([regex]::Matches($acceptance, '(?m)^\| (AC-\d{3}) \|') | ForEach-Object { $_.Groups[1].Value })
$taskBlocks = [regex]::Matches($todo, '(?ms)^## (T\d{2}) .*?(?=^## |\z)')
$taskMap = @{}
foreach ($block in $taskBlocks) {
    $id = $block.Groups[1].Value
    if ($taskMap.ContainsKey($id)) { $errorsFound.Add("Duplicate task: $id") }
    $taskMap[$id] = $block.Value
    foreach ($field in @('Requirements:', 'Owner:', 'Estimated effort:', 'Dependencies:', 'Parallel safety:', 'Files/modules:', 'Inputs ', 'Acceptance:', 'Verification:', 'Completion evidence:')) {
        if (!$block.Value.Contains($field)) { $errorsFound.Add("Task $id missing $field") }
    }
}
foreach ($entry in $reqMatches) {
    $id = $entry.Groups[1].Value
    $ac = $id.Replace('REQ-', 'AC-')
    if ($ac -notin $acIds) { $errorsFound.Add("No acceptance: $id") }
    $mapped = @([regex]::Matches($entry.Value, '\bT\d{2}\b') | ForEach-Object { $_.Value })
    if (!$mapped.Count) { $errorsFound.Add("No task: $id") }
    foreach ($taskId in $mapped) {
        if (!$taskMap.ContainsKey($taskId)) { $errorsFound.Add("Unknown mapped task $taskId") }
    }
    foreach ($taskId in $taskMap.Keys) {
        $taskReqLine = [regex]::Match($taskMap[$taskId], '(?m)^- Requirements:.*$').Value
        if ($taskReqLine.Contains($id) -and $taskId -notin $mapped) { $errorsFound.Add("Missing trace $id -> $taskId") }
    }
}
$deps = @{}
foreach ($id in $taskMap.Keys) {
    $line = [regex]::Match($taskMap[$id], '(?m)^- Dependencies: (.*?)\. Parallel safety:').Groups[1].Value
    $deps[$id] = @([regex]::Matches($line, '\bT\d{2}\b') | ForEach-Object { $_.Value })
    foreach ($dependency in $deps[$id]) {
        if (!$taskMap.ContainsKey($dependency)) { $errorsFound.Add("Unknown dependency $id -> $dependency") }
    }
}
$visited = @{}
function Visit-Task([string]$TaskId) {
    if ($visited[$TaskId] -eq 1) { $errorsFound.Add("Dependency cycle at $TaskId"); return }
    if ($visited[$TaskId] -eq 2) { return }
    $visited[$TaskId] = 1
    foreach ($dependency in $deps[$TaskId]) { Visit-Task $dependency }
    $visited[$TaskId] = 2
}
foreach ($id in $taskMap.Keys) { Visit-Task $id }
foreach ($entry in $textByPath.GetEnumerator()) {
    foreach ($match in [regex]::Matches($entry.Value, '\b(?:REQ-\d{3}|AC-\d{3}|T\d{2})\b')) {
        $id = $match.Value
        if (($id.StartsWith('REQ-') -and $id -notin $reqIds) -or
            ($id.StartsWith('AC-') -and $id -notin $acIds) -or
            ($id -match '^T\d' -and !$taskMap.ContainsKey($id))) { $errorsFound.Add("Undefined ID: $id") }
    }
}
$checked = [regex]::Matches($todo, '(?im)^- \[x\]').Count
if ($checked) { $errorsFound.Add("Unexpected completed implementation checkboxes: $checked") }
$paperCount = [regex]::Matches((Get-Content -LiteralPath (Join-Path $rootPath 'docs/research/source-register.md') -Raw -Encoding utf8), '(?m)^### P\d{2} ').Count
$result = [ordered]@{
    markdown_files = $docs.Count
    local_links_checked = $linksChecked
    requirements = $reqIds.Count
    acceptance_checks = $acIds.Count
    task_cards = $taskMap.Count
    research_papers = $paperCount
    completed_implementation_checkboxes = $checked
    dependency_graph = 'acyclic if no errors'
    errors = @($errorsFound.ToArray())
}
$result | ConvertTo-Json -Depth 4
if ($errorsFound.Count) { exit 1 }
