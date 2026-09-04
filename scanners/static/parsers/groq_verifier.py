import os
import logging
from pathlib import Path
from typing import List, Dict, Any
from groq import Groq

from scanners.models import CodeCryptoFinding
from scanners.static.privacy_filter import sanitize_for_llm

MAX_LLM_REQUESTS = 20

logger = logging.getLogger(__name__)

# Very strict prompt designed to only return JSON list of confident findings, ignoring non-cryptographic usages (e.g. variables named md5)
GROQ_PROMPT = """
You are a strict cryptography auditor. Analyze the following code snippet and identify any active usage of cryptographic algorithms or hardcoded secrets. 
DO NOT flag variable names or strings that merely mention algorithms unless they are actively invoking cryptographic functions or containing actual keys.
Return a JSON array of objects with keys: "algorithm", "confidence" (high/medium/low), "reason".
If no true cryptographic usage is found, return [].

Code snippet:
```
{code}
```
"""


def verify_findings(findings: List[CodeCryptoFinding], root: Path) -> List[CodeCryptoFinding]:
    """
    Takes a list of findings, particularly those marked as 'medium' or 'low' confidence,
    and uses an LLM to verify them. High confidence findings (like from AST or explicit keys) are preserved.
    """
    api_key = os.environ.get("GROQ_API_KEY")
    if os.environ.get("ECDAT_LLM_VERIFY", "false").lower() != "true":
        logger.info("LLM verification is disabled; retaining static findings.")
        return findings
    if not api_key:
        logger.warning("LLM verification requested but GROQ_API_KEY is unavailable; retaining static findings.")
        return findings

    client = Groq(api_key=api_key)
    verified = []

    requests_sent = 0
    for f in findings:
        if f.confidence == "high":
            verified.append(f)
            continue

        try:
            # Get a snippet (e.g., +/- 5 lines)
            path = root / f.file_path
            if requests_sent >= MAX_LLM_REQUESTS:
                verified.append(f)
                continue
            snippet = sanitize_for_llm(path.read_text(errors="ignore"), f.line, context_lines=5)
            if snippet == "[CODE OMITTED - CONTAINS KEY MATERIAL]":
                verified.append(f)
                continue

            prompt = GROQ_PROMPT.replace("{code}", snippet)

            requests_sent += 1
            response = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="llama3-8b-8192",
                temperature=0.0,
                response_format={"type": "json_object"},  # ensure valid JSON
            )

            content = response.choices[0].message.content
            if "algorithm" in content.lower():
                # If the LLM returns any items, we upgrade confidence or keep it
                f.confidence = "high"
                verified.append(f)
            else:
                # LLM says it's a false positive, drop it
                logger.debug(f"LLM dropped ambiguous finding at {f.file_path}:{f.line}")
        except Exception:
            logger.warning("LLM verification failed; retaining the static finding without LLM confirmation.")
            verified.append(f)  # Default to keeping it on error

    return verified
