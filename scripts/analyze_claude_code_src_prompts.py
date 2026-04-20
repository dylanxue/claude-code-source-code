#!/usr/bin/env python3
from __future__ import annotations

import re
import zipfile
from bisect import bisect_right
from dataclasses import dataclass, asdict
from html import escape as xml_escape
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
OUTPUT_PATH = REPO_ROOT / "output" / "spreadsheet" / "claude-code-src-prompt-analysis.xlsx"

KEYWORDS = (
    "prompt",
    "instruction",
    "instructions",
    "hint",
    "addendum",
    "prefix",
    "header",
    "guide",
    "template",
)

FUNCTION_KEYWORDS = (
    "prompt",
    "instruction",
    "instructions",
    "hint",
    "addendum",
    "guide",
    "template",
)

FUNCTION_NAME_ALLOWLIST = {
    "getPrompt",
    "getSystemPrompt",
    "getCoordinatorSystemPrompt",
    "buildSessionMemoryUpdatePrompt",
    "buildMagicDocsUpdatePrompt",
    "buildExtractAutoOnlyPrompt",
    "buildExtractCombinedPrompt",
    "buildSummaryPrompt",
    "buildAwaySummaryPrompt",
    "getUpdatePromptTemplate",
    "getDefaultUpdatePrompt",
    "buildUltraplanPrompt",
    "getPromptContent",
}

LLM_CALL_PATTERNS = (
    "queryModelWithStreaming(",
    "queryModelWithoutStreaming(",
    "queryHaiku(",
    "queryWithModel(",
    "runForkedAgent(",
    "toolToAPISchema(",
    "buildEffectiveSystemPrompt(",
)


@dataclass
class DefinitionRow:
    id: str
    kind: str
    capture_reason: str
    file: str
    line: int
    symbol: str
    request_part: str
    injection_summary: str
    confidence: str
    content_status: str
    prompt_text: str
    source_excerpt: str
    notes: str


@dataclass
class MissingResourceRow:
    file: str
    line: int
    symbol: str
    import_path: str
    resolved_path: str
    exists: str
    inferred_request_part: str
    inferred_injection_summary: str
    notes: str


@dataclass
class CallsitesRow:
    file: str
    line: int
    sink: str
    request_part: str
    details: str


def main() -> None:
    all_files = sorted(
        path
        for path in SRC_ROOT.rglob("*")
        if path.is_file() and path.suffix in {".ts", ".tsx", ".js", ".jsx"}
    )
    all_texts = {path: path.read_text(encoding="utf-8", errors="replace") for path in all_files}
    candidate_paths = [path for path, text in all_texts.items() if is_candidate_file(path, text)]
    texts = {path: all_texts[path] for path in candidate_paths}

    definitions: list[DefinitionRow] = []
    missing: list[MissingResourceRow] = []
    callsites: list[CallsitesRow] = collect_injection_callsites(texts)

    seen_def_keys: set[tuple[str, str, int]] = set()

    for path, text in texts.items():
        definitions.extend(collect_named_definitions(path, text, seen_def_keys))
        definitions.extend(collect_function_definitions(path, text, seen_def_keys))
        definitions.extend(collect_inline_system_prompts(path, text, seen_def_keys))
        missing.extend(collect_missing_resource_rows(path, text))

    definitions = dedupe_definitions(definitions)
    definitions.sort(key=lambda row: (row.file, row.line, row.symbol))
    missing.sort(key=lambda row: (row.file, row.line, row.import_path))
    callsites.sort(key=lambda row: (row.file, row.line, row.sink))

    summary_rows = build_summary_rows(definitions, missing, callsites, all_texts, texts)
    definition_rows = [asdict(row) for row in definitions]
    missing_rows = [asdict(row) for row in missing]
    callsite_rows = [asdict(row) for row in callsites]

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    write_xlsx(
        OUTPUT_PATH,
        [
            ("Summary", summary_rows),
            ("Definitions", definition_rows),
            ("Callsites", callsite_rows),
            ("MissingRefs", missing_rows),
        ],
    )

    print(f"Wrote {OUTPUT_PATH}")
    print(f"Definitions: {len(definitions)}")
    print(f"Callsites: {len(callsites)}")
    print(f"Missing refs: {len(missing)}")


def dedupe_definitions(rows: list[DefinitionRow]) -> list[DefinitionRow]:
    out: list[DefinitionRow] = []
    seen: set[tuple[str, str, int, str]] = set()
    for row in rows:
        key = (row.file, row.symbol, row.line, row.kind)
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def build_summary_rows(
    definitions: list[DefinitionRow],
    missing: list[MissingResourceRow],
    callsites: list[CallsitesRow],
    all_texts: dict[Path, str],
    texts: dict[Path, str],
) -> list[dict[str, str]]:
    scanned_files = len([path for path in all_texts if path.is_file()])
    candidate_files = len([path for path in texts if path.is_file()])
    part_counts: dict[str, int] = {}
    for row in definitions:
        part_counts[row.request_part] = part_counts.get(row.request_part, 0) + 1
    summary = [
        {
            "item": "Scope",
            "value": "Only src/ in the Claude Code source tree; dclaw excluded completely.",
        },
        {
            "item": "Scanned files",
            "value": str(scanned_files),
        },
        {
            "item": "Deep-scanned candidate files",
            "value": str(candidate_files),
        },
        {
            "item": "Captured definitions",
            "value": str(len(definitions)),
        },
        {
            "item": "Injection callsites",
            "value": str(len(callsites)),
        },
        {
            "item": "Referenced prompt resources missing from workspace",
            "value": str(len(missing)),
        },
        {
            "item": "Heuristic policy",
            "value": (
                "Capture anything prompt-like from src/: prompt/prompts files, identifiers containing "
                "Prompt/Instruction/Hint/Addendum/Prefix/Header/Guide/Template, inline asSystemPrompt(...) blocks, "
                "and imported .md/.txt prompt resources."
            ),
        },
        {
            "item": "Request parts used in workbook",
            "value": " | ".join(f"{part}: {count}" for part, count in sorted(part_counts.items())),
        },
        {
            "item": "Important caveat",
            "value": (
                "If the source references a prompt file that is absent in this workspace, the workbook keeps the reference "
                "and callsite but marks the real prompt content as unavailable here rather than silently dropping it."
            ),
        },
    ]
    return summary


def is_candidate_file(path: Path, text: str) -> bool:
    rel = relpath(path).lower()
    if any(token in rel for token in ("prompt", "coordinatormode", "claudeinchrome", "sessionmemory", "magicdocs", "extractmemories", "review.ts", "init.ts", "insights.ts", "commit.ts", "commit-push-pr.ts", "teleport.tsx", "sessiontitle.ts", "sidequestion.ts", "awaysummary.ts", "agentsummary", "feedback.tsx", "queryengine.ts", "yoloclassifier.ts", "shell/prefix.ts", "dateTimeParser.ts", "generateagent.ts")):
        return True
    lowered = text.lower()
    if "type: 'prompt'" in text or 'type: "prompt"' in text:
        return True
    if "assystemprompt(" in lowered:
        return True
    if "systemprompt:" in lowered:
        return True
    if "createusermessage({" in lowered:
        return True
    if any(pattern.lower() in lowered for pattern in LLM_CALL_PATTERNS):
        return True
    if re.search(r"\b[A-Za-z_$][\w$]*(Prompt|Instruction|Instructions|Hint|Addendum|Template|SystemPrompt)\b", text):
        return True
    if re.search(r"""['"]\.[^'"]+\.(?:md|txt)['"]""", text):
        return True
    return False


def collect_named_definitions(
    path: Path,
    text: str,
    seen_keys: set[tuple[str, str, int]],
) -> list[DefinitionRow]:
    rows: list[DefinitionRow] = []
    path_l = relpath(path).lower()
    is_prompt_file = "prompt.ts" in path_l or "prompts.ts" in path_l
    pattern = re.compile(
        r"(?m)^(?P<indent>\s*)(?:export\s+)?(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\b"
    )
    for match in pattern.finditer(text):
        name = match.group("name")
        if not is_prompt_file and not is_prompt_like_symbol_name(name):
            continue
        line = line_number(text, match.start())
        eq_pos = find_assignment_equals(text, match.end())
        if eq_pos is None:
            continue
        initial_probe = text[skip_space_and_comments(text, eq_pos + 1) : skip_space_and_comments(text, eq_pos + 1) + 24]
        if not is_prompt_file and not starts_like_prompt_definition(initial_probe):
            continue
        expr, end_pos = capture_expression(text, eq_pos + 1)
        if not expr.strip():
            continue
        if not is_prompt_file and not is_definition_like_expression(expr):
            continue
        reason = capture_reason_for_symbol(path, name, expr)
        if reason is None:
            continue
        key = (str(path), name, line)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        request_part, injection_summary, confidence, notes = infer_injection(path, name, expr)
        prompt_text, content_status = extract_prompt_text(expr, path, name)
        if not is_prompt_file and content_status == "dynamic-no-literal":
            continue
        rows.append(
            DefinitionRow(
                id=make_id(path, name, line),
                kind="const",
                capture_reason=reason,
                file=relpath(path),
                line=line,
                symbol=name,
                request_part=request_part,
                injection_summary=injection_summary,
                confidence=confidence,
                content_status=content_status,
                prompt_text=trim_cell(prompt_text),
                source_excerpt=trim_cell(expr.strip()),
                notes=notes,
            )
        )
    return rows


def collect_function_definitions(
    path: Path,
    text: str,
    seen_keys: set[tuple[str, str, int]],
) -> list[DefinitionRow]:
    rows: list[DefinitionRow] = []
    pattern = re.compile(
        r"(?m)^(?P<indent>\s*)(?:export\s+)?(?:async\s+)?function\s+(?P<name>[A-Za-z_$][\w$]*)\s*\("
    )
    for match in pattern.finditer(text):
        name = match.group("name")
        line = line_number(text, match.start())
        if not should_capture_function(path, name, text, match.start()):
            continue
        open_brace = text.find("{", match.end())
        if open_brace == -1:
            continue
        body, _ = capture_brace_block(text, open_brace)
        body_strings = extract_string_literals(body)
        if (
            "prompt.ts" not in relpath(path).lower()
            and "prompts.ts" not in relpath(path).lower()
            and name not in FUNCTION_NAME_ALLOWLIST
            and not body_strings
        ):
            continue
        key = (str(path), name, line)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        request_part, injection_summary, confidence, notes = infer_injection(path, name, body)
        prompt_text, content_status = extract_prompt_text(body, path, name)
        rows.append(
            DefinitionRow(
                id=make_id(path, name, line),
                kind="function",
                capture_reason=function_capture_reason(path, name),
                file=relpath(path),
                line=line,
                symbol=name,
                request_part=request_part,
                injection_summary=injection_summary,
                confidence=confidence,
                content_status=content_status,
                prompt_text=trim_cell(prompt_text),
                source_excerpt=trim_cell(body.strip()),
                notes=notes,
            )
        )
    return rows


def collect_inline_system_prompts(
    path: Path,
    text: str,
    seen_keys: set[tuple[str, str, int]],
) -> list[DefinitionRow]:
    rows: list[DefinitionRow] = []
    needle = "asSystemPrompt("
    start = 0
    counter = 0
    while True:
        idx = text.find(needle, start)
        if idx == -1:
            break
        line = line_number(text, idx)
        arg_start = idx + len(needle)
        arg_expr, end_pos = capture_parenthesized_argument(text, arg_start)
        start = end_pos
        if not any(ch in arg_expr for ch in ("`", "'", '"')):
            continue
        if re.fullmatch(r"\s*[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*", arg_expr.strip()):
            continue
        counter += 1
        symbol = f"<inline_system_prompt_{counter}>"
        key = (str(path), symbol, line)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        prompt_text, content_status = extract_prompt_text(arg_expr, path, symbol)
        rows.append(
            DefinitionRow(
                id=make_id(path, symbol, line),
                kind="inline_system",
                capture_reason="Inline asSystemPrompt(...) literal block",
                file=relpath(path),
                line=line,
                symbol=symbol,
                request_part="system",
                injection_summary=(
                    "Inline literal passed through asSystemPrompt(...); the resulting array is serialized "
                    "into the top-level API system prompt."
                ),
                confidence="high",
                content_status=content_status,
                prompt_text=trim_cell(prompt_text),
                source_excerpt=trim_cell(arg_expr.strip()),
                notes="Captured separately so anonymous system-prompt literals are not lost.",
            )
        )
    return rows


def collect_missing_resource_rows(path: Path, text: str) -> list[MissingResourceRow]:
    rows: list[MissingResourceRow] = []
    import_pattern = re.compile(
        r"""(?mx)
        ^
        \s*import\s+(?P<symbol>[A-Za-z_$][\w$]*)\s+from\s+['"](?P<target>\.[^'"]+\.(?:md|txt))['"]
        |
        require\(\s*['"](?P<target2>\.[^'"]+\.(?:md|txt))['"]\s*\)
        """
    )
    for match in import_pattern.finditer(text):
        target = match.group("target") or match.group("target2")
        symbol = match.group("symbol") or Path(target).name
        resolved = (path.parent / target).resolve()
        exists = resolved.exists()
        if exists:
            continue
        line = line_number(text, match.start())
        request_part, injection_summary, _, notes = infer_injection(path, symbol, target)
        rows.append(
            MissingResourceRow(
                file=relpath(path),
                line=line,
                symbol=symbol,
                import_path=target,
                resolved_path=str(resolved),
                exists="no",
                inferred_request_part=request_part,
                inferred_injection_summary=injection_summary,
                notes=notes
                or "Referenced prompt resource is absent from this workspace, so its real content cannot be recovered locally.",
            )
        )
    return rows


def collect_injection_callsites(texts: dict[Path, str]) -> list[CallsitesRow]:
    rows: list[CallsitesRow] = []
    for path, text in texts.items():
        rel = relpath(path)
        if rel == "src/services/api/claude.ts":
            for needle, sink, part, details in [
                (
                    "toolToAPISchema(tool, {",
                    "toolToAPISchema",
                    "tools[].description",
                    "Each tool's prompt() return value becomes the description field in the API tools array.",
                ),
                (
                    "systemPrompt = asSystemPrompt(",
                    "systemPrompt assembly",
                    "system",
                    "Request-time prefix/header append: attribution header, CLI identity prefix, existing systemPrompt sections, advisor instructions, and optional Chrome tool-search instructions.",
                ),
                (
                    "systemPrompt: systemPrompt.join('\\n\\n')",
                    "newContext.systemPrompt",
                    "telemetry mirror of system",
                    "Tracing/debug payload mirrors the effective system prompt bytes sent to the model.",
                ),
            ]:
                idx = text.find(needle)
                if idx != -1:
                    rows.append(
                        CallsitesRow(
                            file=rel,
                            line=line_number(text, idx),
                            sink=sink,
                            request_part=part,
                            details=details,
                        )
                    )
        if rel == "src/utils/api.ts":
            idx = text.find("description: await tool.prompt(")
            if idx != -1:
                rows.append(
                    CallsitesRow(
                        file=rel,
                        line=line_number(text, idx),
                        sink="tool.prompt()",
                        request_part="tools[].description",
                        details="Tool prompt text is awaited and injected into each tool schema's description field.",
                    )
                )
        if rel == "src/utils/systemPrompt.ts":
            idx = text.find("export function buildEffectiveSystemPrompt(")
            if idx != -1:
                rows.append(
                    CallsitesRow(
                        file=rel,
                        line=line_number(text, idx),
                        sink="buildEffectiveSystemPrompt",
                        request_part="system",
                        details="Chooses override/coordinator/agent/custom/default prompt stack and optional appendSystemPrompt suffix before query().",
                    )
                )
        if rel == "src/utils/forkedAgent.ts":
            idx = text.find("const initialMessages: Message[] = [...forkContextMessages, ...promptMessages]")
            if idx != -1:
                rows.append(
                    CallsitesRow(
                        file=rel,
                        line=line_number(text, idx),
                        sink="runForkedAgent promptMessages",
                        request_part="messages[]",
                        details="Forked-agent promptMessages are appended after inherited conversation context and sent as ordinary chat messages.",
                    )
                )
        if rel == "src/tools/AgentTool/runAgent.ts":
            for needle, sink, part, details in [
                (
                    "const agentSystemPrompt = override?.systemPrompt",
                    "agentSystemPrompt",
                    "system",
                    "Subagent system prompt resolved here and then passed to query() for the child agent.",
                ),
                (
                    "initialMessages.push(\n        createUserMessage({",
                    "preloaded skill prompt",
                    "messages.user",
                    "Preloaded skill content is wrapped as a meta user message before the child agent runs.",
                ),
            ]:
                idx = text.find(needle)
                if idx != -1:
                    rows.append(
                        CallsitesRow(
                            file=rel,
                            line=line_number(text, idx),
                            sink=sink,
                            request_part=part,
                            details=details,
                        )
                    )
        for llm_needle in (
            "queryModelWithStreaming({",
            "queryModelWithoutStreaming({",
            "queryHaiku({",
            "queryWithModel({",
            "runForkedAgent({",
        ):
            start = 0
            while True:
                idx = text.find(llm_needle, start)
                if idx == -1:
                    break
                start = idx + len(llm_needle)
                rows.append(
                    CallsitesRow(
                        file=rel,
                        line=line_number(text, idx),
                        sink=llm_needle[:-1],
                        request_part=infer_callsite_part(rel, text[idx : idx + 800]),
                        details=build_callsite_details(rel, text[idx : idx + 800]),
                    )
                )
    return dedupe_callsites(rows)


def dedupe_callsites(rows: list[CallsitesRow]) -> list[CallsitesRow]:
    out: list[CallsitesRow] = []
    seen: set[tuple[str, int, str]] = set()
    for row in rows:
        key = (row.file, row.line, row.sink)
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def infer_callsite_part(file: str, snippet: str) -> str:
    parts: list[str] = []
    if "systemPrompt:" in snippet:
        parts.append("system")
    if "promptMessages:" in snippet or "createUserMessage({" in snippet or "userPrompt:" in snippet or "text:" in snippet:
        parts.append("messages.user")
    if not parts:
        return "mixed/see details"
    return " + ".join(parts)


def build_callsite_details(file: str, snippet: str) -> str:
    parts: list[str] = []
    if "systemPrompt:" in snippet:
        parts.append("Includes a systemPrompt field.")
    if "promptMessages:" in snippet:
        parts.append("Includes promptMessages for a forked agent.")
    if "createUserMessage({" in snippet or "userPrompt:" in snippet:
        parts.append("Builds user-role prompt text before the model call.")
    if "asSystemPrompt([" in snippet:
        parts.append("Contains an inline asSystemPrompt literal.")
    if not parts:
        parts.append("LLM sink detected; inspect nearby source in the workbook for the exact prompt wiring.")
    return " ".join(parts)


def capture_reason_for_symbol(path: Path, name: str, expr: str) -> str | None:
    path_l = relpath(path).lower()
    name_l = name.lower()
    if "prompt.ts" in path_l or "prompts.ts" in path_l:
        return "Defined in a dedicated prompt/prompts source file"
    if any(keyword in name_l for keyword in KEYWORDS):
        return "Identifier name matches prompt-like keywords"
    if any(pattern in expr for pattern in LLM_CALL_PATTERNS):
        return "Initializer contains an LLM prompt/call wiring path"
    string_bits = extract_string_literals(expr)
    if string_bits and any(len(bit.strip()) >= 80 for bit in string_bits):
        if any(token in path_l for token in ("commands/", "services/", "memdir/", "coordinator/", "skills/")):
            return "Long textual block in a source area that feeds models"
    return None


def is_prompt_like_symbol_name(name: str) -> bool:
    if re.search(
        r"(?:_PROMPT|_INSTRUCTION|_INSTRUCTIONS|_HINT|_ADDENDUM|_TEMPLATE|_PREFIX|_HEADER|_SYSTEM_PROMPT)\b",
        name,
    ):
        return True
    if re.search(
        r"(?:Prompt|Instruction|Instructions|Hint|Addendum|Template|SystemPrompt)$",
        name,
    ):
        return True
    return False


def is_definition_like_expression(expr: str) -> bool:
    stripped = expr.strip()
    if not stripped:
        return False
    if stripped[0] in ("`", "'", '"', "["):
        return True
    if stripped[0] == "(" or stripped.startswith("async "):
        return True
    if stripped.startswith("asSystemPrompt("):
        return True
    if ".join(" in stripped and any(ch in stripped for ch in ("`", "'", '"')):
        return True
    if "createUserMessage({" in stripped and any(ch in stripped for ch in ("`", "'", '"')):
        return True
    return False


def starts_like_prompt_definition(probe: str) -> bool:
    stripped = probe.lstrip()
    if not stripped:
        return False
    if stripped[0] in ("`", "'", '"', "["):
        return True
    if stripped[0] == "(" or stripped.startswith("async "):
        return True
    if stripped.startswith("asSystemPrompt("):
        return True
    return False


def should_capture_function(path: Path, name: str, text: str, pos: int) -> bool:
    path_l = relpath(path).lower()
    name_l = name.lower()
    if "prompt.ts" in path_l or "prompts.ts" in path_l:
        return True
    if name in FUNCTION_NAME_ALLOWLIST:
        return True
    if any(keyword in name_l for keyword in FUNCTION_KEYWORDS):
        return True
    return False


def function_capture_reason(path: Path, name: str) -> str:
    path_l = relpath(path).lower()
    if "prompt.ts" in path_l or "prompts.ts" in path_l:
        return "Function defined in a dedicated prompt/prompts source file"
    if name in FUNCTION_NAME_ALLOWLIST:
        return "Function name is on the prompt-builder allowlist"
    return "Function name or body indicates prompt construction"


def infer_injection(path: Path, name: str, source: str) -> tuple[str, str, str, str]:
    rel = relpath(path)
    rel_l = rel.lower()
    name_l = name.lower()
    source_l = source.lower()

    if rel.startswith("src/tools/") and rel.endswith("/prompt.ts"):
        return (
            "tools[].description",
            "Tool prompt text is returned by tool.prompt() and serialized by utils/api.ts::toolToAPISchema into the API tools array.",
            "high",
            "Applies to built-in tool descriptions, including AgentTool/SkillTool/ToolSearch and other tool instructions.",
        )

    if rel == "src/constants/system.ts":
        return (
            "system",
            "services/api/claude.ts prepends these identity/header strings when assembling the final request system prompt.",
            "high",
            "These are request-prefix/system-header blocks rather than user messages.",
        )

    if rel == "src/constants/prompts.ts":
        return (
            "system",
            "These sections feed the default main-thread system prompt, which buildEffectiveSystemPrompt() passes to query()/queryModel().",
            "high",
            "This is the default Claude Code system prompt source file.",
        )

    if rel == "src/coordinator/coordinatorMode.ts":
        return (
            "system",
            "Coordinator mode swaps in this system prompt through buildEffectiveSystemPrompt() before the main query loop.",
            "high",
            "",
        )

    if rel.startswith("src/tools/AgentTool/built-in/"):
        return (
            "system",
            "Built-in agent definitions expose getSystemPrompt(); runAgent.ts resolves that prompt and sends it as the child agent's system prompt.",
            "high",
            "This sheet keeps these child-agent prompts separate from the main-thread default system prompt.",
        )

    if rel == "src/utils/claudeInChrome/prompt.ts":
        if "hint" in name_l:
            return (
                "system",
                "main.tsx appends the Claude-in-Chrome hint into appendSystemPrompt, so it lands in the final system prompt.",
                "high",
                "",
            )
        return (
            "system",
            "Chrome automation instructions are appended to systemPrompt either by setup.ts or request-time injection in services/api/claude.ts.",
            "high",
            "",
        )

    if rel.startswith("src/services/compact/"):
        return (
            "messages.user",
            "compact.ts builds a summary request user message from these prompt builders and sends it through queryModelWithStreaming().",
            "high",
            "The compaction flow also uses a small separate system prompt literal in compact.ts.",
        )

    if rel.startswith("src/services/SessionMemory/"):
        return (
            "messages.user",
            "sessionMemory.ts builds a userPrompt from this template and passes it to runForkedAgent() as createUserMessage({ content: userPrompt }).",
            "high",
            "The fork inherits the parent system prompt separately; this template is the extra user-role instruction.",
        )

    if rel.startswith("src/services/MagicDocs/"):
        return (
            "messages.user",
            "magicDocs.ts builds a userPrompt from this template and sends it to a forked agent as a user message.",
            "high",
            "",
        )

    if rel.startswith("src/services/extractMemories/"):
        return (
            "messages.user",
            "extractMemories.ts builds a user prompt from these functions and injects it via runForkedAgent(promptMessages=[createUserMessage(...)]).",
            "high",
            "",
        )

    if rel == "src/services/toolUseSummary/toolUseSummaryGenerator.ts":
        return (
            "system",
            "queryHaiku() receives this value as systemPrompt for generating short tool-use summary labels.",
            "high",
            "",
        )

    if rel == "src/memdir/findRelevantMemories.ts":
        return (
            "system",
            "The memory selector call sends this as the model's system field for choosing relevant memory files.",
            "high",
            "",
        )

    if rel.startswith("src/commands/"):
        if "type: 'prompt'" in source or "getPromptForCommand" in source or "return [{ type: 'text', text:" in source:
            return (
                "messages.user",
                "Slash-command prompt content is returned as prompt text and then inserted into the conversation as a user message.",
                "medium",
                "",
            )
        if any(token in name_l for token in ("prompt", "instructions")):
            return (
                "messages.user",
                "Command-scoped prompt/instruction text is used to build the user message for that command flow.",
                "medium",
                "",
            )

    if rel.startswith("src/utils/") or rel.startswith("src/services/") or rel.startswith("src/components/"):
        if "systemprompt" in name_l or "asSystemPrompt(" in source or "systemprompt:" in source_l:
            return (
                "system",
                "This source is wired into a systemPrompt field before the model call.",
                "medium",
                "",
            )
        if "userprompt" in name_l or "createusermessage" in source_l or "promptmessages" in source_l:
            return (
                "messages.user",
                "This source becomes user-role message content before the model call.",
                "medium",
                "",
            )

    if rel.startswith("src/skills/"):
        return (
            "messages.user",
            "Skill content is typically loaded into the conversation as a meta user message when the skill is invoked or preloaded.",
            "medium",
            "Several bundled skill markdown resources are missing from this workspace, so only the reference sites are available.",
        )

    if "systemprompt" in name_l or "systemprompt:" in source_l or "assystemprompt(" in source_l:
        return (
            "system",
            "Heuristic match: prompt is associated with systemPrompt/asSystemPrompt wiring.",
            "low",
            "",
        )

    if "promptmessages" in source_l or "createusermessage" in source_l or "userprompt" in name_l:
        return (
            "messages.user",
            "Heuristic match: prompt is associated with a user-message construction path.",
            "low",
            "",
        )

    return (
        "mixed/unknown",
        "Prompt-like definition captured, but the exact sink should be checked against nearby source and the Callsites sheet.",
        "low",
        "",
    )


def extract_prompt_text(source: str, path: Path, name: str) -> tuple[str, str]:
    strings = extract_string_literals(source)
    if not strings:
        return ("", "dynamic-no-literal")
    status = "literal"
    if any("${" in s for s in strings):
        status = "template-with-placeholders"
    if len(strings) == 1:
        return strings[0], status
    joined = []
    for idx, bit in enumerate(strings, start=1):
        joined.append(f"[fragment {idx}]\n{bit}")
    return "\n\n".join(joined), status


def extract_string_literals(source: str) -> list[str]:
    out: list[str] = []
    i = 0
    length = len(source)
    while i < length:
        ch = source[i]
        if ch in ("'", '"'):
            literal, i = consume_quoted_string(source, i)
            value = decode_js_quoted_literal(literal)
            if include_string_fragment(value):
                out.append(value)
            continue
        if ch == "`":
            literal, i = consume_template_literal(source, i)
            value = decode_template_literal(literal)
            if include_string_fragment(value):
                out.append(value)
            continue
        if source.startswith("//", i):
            i = source.find("\n", i)
            if i == -1:
                break
            continue
        if source.startswith("/*", i):
            end = source.find("*/", i + 2)
            if end == -1:
                break
            i = end + 2
            continue
        i += 1
    return out


def include_string_fragment(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return False
    if len(stripped) >= 12:
        return True
    return "\n" in value


def decode_js_quoted_literal(literal: str) -> str:
    quote = literal[0]
    body = literal[1:-1]
    return decode_js_escapes(body, quote)


def decode_template_literal(literal: str) -> str:
    body = literal[1:-1]
    out: list[str] = []
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            mapping = {"n": "\n", "r": "\r", "t": "\t", "`": "`", "\\": "\\"}
            out.append(mapping.get(nxt, nxt))
            i += 2
            continue
        if ch == "$" and i + 1 < len(body) and body[i + 1] == "{":
            end = find_matching_brace_in_template(body, i + 1)
            if end == -1:
                out.append(body[i:])
                break
            out.append(body[i : end + 1])
            i = end + 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def decode_js_escapes(body: str, quote: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(body):
        ch = body[i]
        if ch != "\\":
            out.append(ch)
            i += 1
            continue
        if i + 1 >= len(body):
            out.append("\\")
            break
        nxt = body[i + 1]
        mapping = {
            "n": "\n",
            "r": "\r",
            "t": "\t",
            "\\": "\\",
            "'": "'",
            '"': '"',
            "`": "`",
            "b": "\b",
            "f": "\f",
            "v": "\v",
        }
        if nxt in mapping:
            out.append(mapping[nxt])
            i += 2
            continue
        if nxt == "x" and i + 3 < len(body):
            try:
                out.append(chr(int(body[i + 2 : i + 4], 16)))
                i += 4
                continue
            except ValueError:
                pass
        if nxt == "u":
            if i + 2 < len(body) and body[i + 2] == "{" and "}" in body[i + 3 :]:
                end = body.find("}", i + 3)
                try:
                    out.append(chr(int(body[i + 3 : end], 16)))
                    i = end + 1
                    continue
                except ValueError:
                    pass
            elif i + 5 < len(body):
                try:
                    out.append(chr(int(body[i + 2 : i + 6], 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
        out.append(nxt)
        i += 2
    return "".join(out)


def consume_quoted_string(text: str, start: int) -> tuple[str, int]:
    quote = text[start]
    i = start + 1
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == quote:
            return text[start : i + 1], i + 1
        i += 1
    return text[start:], len(text)


def consume_template_literal(text: str, start: int) -> tuple[str, int]:
    i = start + 1
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "`":
            return text[start : i + 1], i + 1
        if ch == "$" and i + 1 < len(text) and text[i + 1] == "{":
            end = find_matching_brace(text, i + 1)
            if end == -1:
                return text[start:], len(text)
            i = end + 1
            continue
        i += 1
    return text[start:], len(text)


def find_matching_brace_in_template(text: str, brace_pos: int) -> int:
    return find_matching_brace(text, brace_pos)


def capture_parenthesized_argument(text: str, start: int) -> tuple[str, int]:
    i = skip_space_and_comments(text, start)
    if i >= len(text):
        return "", len(text)
    if text[i] == "(":
        inner, end = capture_bracket_block(text, i, "(", ")")
        return inner[1:-1], end
    depth = 0
    arg_start = i
    while i < len(text):
        ch = text[i]
        if ch in ("'", '"'):
            _, i = consume_quoted_string(text, i)
            continue
        if ch == "`":
            _, i = consume_template_literal(text, i)
            continue
        if text.startswith("//", i):
            i = text.find("\n", i)
            if i == -1:
                break
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end == -1:
                break
            i = end + 2
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif ch == "," and depth == 0:
            break
        i += 1
    return text[arg_start:i], i


def find_assignment_equals(text: str, start: int) -> int | None:
    i = start
    while i < len(text):
        ch = text[i]
        if ch in ("'", '"'):
            _, i = consume_quoted_string(text, i)
            continue
        if ch == "`":
            _, i = consume_template_literal(text, i)
            continue
        if text.startswith("//", i):
            i = text.find("\n", i)
            if i == -1:
                return None
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end == -1:
                return None
            i = end + 2
            continue
        if ch == "=":
            return i
        if ch == ";":
            return None
        i += 1
    return None


def capture_expression(text: str, start: int) -> tuple[str, int]:
    i = skip_space_and_comments(text, start)
    expr_start = i
    depth_paren = depth_brace = depth_bracket = 0
    while i < len(text):
        ch = text[i]
        if ch in ("'", '"'):
            _, i = consume_quoted_string(text, i)
            continue
        if ch == "`":
            _, i = consume_template_literal(text, i)
            continue
        if text.startswith("//", i):
            i = text.find("\n", i)
            if i == -1:
                return text[expr_start:], len(text)
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end == -1:
                return text[expr_start:], len(text)
            i = end + 2
            continue
        if ch == "(":
            depth_paren += 1
        elif ch == ")":
            if depth_paren > 0:
                depth_paren -= 1
        elif ch == "{":
            depth_brace += 1
        elif ch == "}":
            if depth_brace > 0:
                depth_brace -= 1
        elif ch == "[":
            depth_bracket += 1
        elif ch == "]":
            if depth_bracket > 0:
                depth_bracket -= 1
        elif ch == ";" and depth_paren == depth_brace == depth_bracket == 0:
            return text[expr_start:i], i + 1
        i += 1
    return text[expr_start:], len(text)


def capture_brace_block(text: str, open_brace_pos: int) -> tuple[str, int]:
    return capture_bracket_block(text, open_brace_pos, "{", "}")


def capture_bracket_block(text: str, open_pos: int, open_ch: str, close_ch: str) -> tuple[str, int]:
    assert text[open_pos] == open_ch
    depth = 1
    i = open_pos + 1
    while i < len(text):
        ch = text[i]
        if ch in ("'", '"'):
            _, i = consume_quoted_string(text, i)
            continue
        if ch == "`":
            _, i = consume_template_literal(text, i)
            continue
        if text.startswith("//", i):
            i = text.find("\n", i)
            if i == -1:
                return text[open_pos:], len(text)
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end == -1:
                return text[open_pos:], len(text)
            i = end + 2
            continue
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[open_pos : i + 1], i + 1
        i += 1
    return text[open_pos:], len(text)


def find_matching_brace(text: str, brace_pos: int) -> int:
    block, end = capture_bracket_block(text, brace_pos, "{", "}")
    if end <= brace_pos:
        return -1
    return end - 1


def skip_space_and_comments(text: str, start: int) -> int:
    i = start
    while i < len(text):
        if text[i].isspace():
            i += 1
            continue
        if text.startswith("//", i):
            i = text.find("\n", i)
            if i == -1:
                return len(text)
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end == -1:
                return len(text)
            i = end + 2
            continue
        break
    return i


def line_number(text: str, pos: int) -> int:
    key = id(text)
    starts = _LINE_STARTS_CACHE.get(key)
    if starts is None:
        starts = [0]
        starts.extend(match.end() for match in re.finditer("\n", text))
        _LINE_STARTS_CACHE[key] = starts
    return bisect_right(starts, pos)


def make_id(path: Path, symbol: str, line: int) -> str:
    safe_symbol = re.sub(r"[^A-Za-z0-9_]+", "_", symbol).strip("_") or "anon"
    safe_path = relpath(path).replace("/", "__").replace(".", "_")
    return f"{safe_path}__L{line}__{safe_symbol}"


def relpath(path: Path) -> str:
    abs_path = path.resolve()
    try:
        return abs_path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def trim_cell(text: str, limit: int = 32000) -> str:
    if len(text) <= limit:
        return text
    extra = len(text) - limit
    return text[: limit - 64] + f"\n\n[TRUNCATED IN WORKBOOK: {extra} more chars omitted from this cell]"


def write_xlsx(output_path: Path, sheets: list[tuple[str, list[dict[str, object]]]]) -> None:
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", build_content_types_xml(len(sheets)))
        zf.writestr("_rels/.rels", ROOT_RELS_XML)
        zf.writestr("xl/workbook.xml", build_workbook_xml(sheets))
        zf.writestr("xl/_rels/workbook.xml.rels", build_workbook_rels_xml(len(sheets)))
        zf.writestr("xl/styles.xml", STYLES_XML)
        for idx, (_, rows) in enumerate(sheets, start=1):
            zf.writestr(f"xl/worksheets/sheet{idx}.xml", build_sheet_xml(rows))


def build_content_types_xml(sheet_count: int) -> str:
    overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ]
    for idx in range(1, sheet_count + 1):
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        + "".join(overrides)
        + "</Types>"
    )


ROOT_RELS_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
"""


STYLES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1">
    <font><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">
      <alignment wrapText="1" vertical="top"/>
    </xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>
"""


def build_workbook_xml(sheets: list[tuple[str, list[dict[str, object]]]]) -> str:
    sheet_xml = []
    for idx, (name, _) in enumerate(sheets, start=1):
        sheet_xml.append(
            f'<sheet name="{xml_attr(safe_sheet_name(name))}" sheetId="{idx}" r:id="rId{idx}"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        "<sheets>"
        + "".join(sheet_xml)
        + "</sheets></workbook>"
    )


def build_workbook_rels_xml(sheet_count: int) -> str:
    rels = []
    for idx in range(1, sheet_count + 1):
        rels.append(
            f'<Relationship Id="rId{idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{idx}.xml"/>'
        )
    rels.append(
        f'<Relationship Id="rId{sheet_count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(rels)
        + "</Relationships>"
    )


def build_sheet_xml(rows: list[dict[str, object]]) -> str:
    headers: list[str]
    if rows:
        headers = list(rows[0].keys())
    else:
        headers = ["empty"]
        rows = [{"empty": ""}]

    xml_rows: list[str] = []
    all_rows: list[list[object]] = [headers] + [[row.get(header, "") for header in headers] for row in rows]
    for row_idx, values in enumerate(all_rows, start=1):
        cells: list[str] = []
        for col_idx, value in enumerate(values, start=1):
            ref = f"{excel_col(col_idx)}{row_idx}"
            cell_value = "" if value is None else str(value)
            cells.append(
                f'<c r="{ref}" t="inlineStr" s="0"><is><t xml:space="preserve">{xml_text(cell_value)}</t></is></c>'
            )
        xml_rows.append(f"<row r=\"{row_idx}\">{''.join(cells)}</row>")
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        "<sheetData>"
        + "".join(xml_rows)
        + "</sheetData></worksheet>"
    )


def excel_col(index: int) -> str:
    letters = []
    while index > 0:
        index, rem = divmod(index - 1, 26)
        letters.append(chr(65 + rem))
    return "".join(reversed(letters))


def safe_sheet_name(name: str) -> str:
    cleaned = re.sub(r"[:\\/?*\[\]]", "_", name)
    return cleaned[:31] or "Sheet"


def xml_text(value: str) -> str:
    return xml_escape(value, quote=False)


def xml_attr(value: str) -> str:
    return xml_escape(value, quote=True)


_LINE_STARTS_CACHE: dict[int, list[int]] = {}


if __name__ == "__main__":
    main()
