import re


def sanitize_for_llm(source_code: str, line_number: int, context_lines: int = 15) -> str:
    """
    Sanitizes source code specifically for LLM inference.
    Limits context size and heavily redacts any literals that could be secrets.
    """
    if not source_code:
        return ""

    # Check for PEMs and aggressively reject or redact
    if re.search(r"-----BEGIN [A-Z ]+-----", source_code):
        # We don't send anything with PEM headers to the LLM just to be safe.
        return "[CODE OMITTED - CONTAINS KEY MATERIAL]"

    # Split by lines to get a minimal window
    lines = source_code.split("\n")
    start_line = max(0, line_number - 1 - context_lines)
    end_line = min(len(lines), line_number + context_lines)

    snippet_lines = lines[start_line:end_line]
    snippet = "\n".join(snippet_lines)

    # Limit max bytes to around 8KB just in case
    if len(snippet) > 8000:
        snippet = snippet[:8000] + "\n...[TRUNCATED]"

    # Redact long literals or potential secrets
    # Replaces strings longer than 20 chars with [REDACTED_LITERAL]
    snippet = re.sub(r'["\']([a-zA-Z0-9+/=_-]{20,})["\']', '"[REDACTED_LITERAL]"', snippet)

    # Redact likely API keys / secrets (naive regex)
    snippet = re.sub(
        r'([A-Za-z0-9_]*key[A-Za-z0-9_]*\s*[:=]\s*["\'])([^"\']{8,})(["\'])',
        r"\1[REDACTED_SECRET]\3",
        snippet,
        flags=re.IGNORECASE,
    )
    snippet = re.sub(
        r'([A-Za-z0-9_]*secret[A-Za-z0-9_]*\s*[:=]\s*["\'])([^"\']{8,})(["\'])',
        r"\1[REDACTED_SECRET]\3",
        snippet,
        flags=re.IGNORECASE,
    )
    snippet = re.sub(
        r'([A-Za-z0-9_]*token[A-Za-z0-9_]*\s*[:=]\s*["\'])([^"\']{8,})(["\'])',
        r"\1[REDACTED_SECRET]\3",
        snippet,
        flags=re.IGNORECASE,
    )
    snippet = re.sub(
        r'([A-Za-z0-9_]*password[A-Za-z0-9_]*\s*[:=]\s*["\'])([^"\']{4,})(["\'])',
        r"\1[REDACTED_SECRET]\3",
        snippet,
        flags=re.IGNORECASE,
    )

    return snippet
