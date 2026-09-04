import os
import json
import time
import requests
import sys

from scanners.static.llm_prompt import LLM_SYSTEM_PROMPT, build_llm_prompt


class LLMVerifier:
    MAX_REQUESTS_CAP = 20
    MAX_TIMEOUT_SECONDS = 30

    def __init__(self, provider: str = "groq", max_requests: int = 10, timeout: int = 10):
        self.provider = provider
        self.max_requests = max(1, min(max_requests, self.MAX_REQUESTS_CAP))
        self.timeout = max(1, min(timeout, self.MAX_TIMEOUT_SECONDS))
        self.api_key = os.environ.get("GROQ_API_KEY", "")
        self.model = os.environ.get("ECDAT_LLM_MODEL", "llama3-8b-8192")
        self.request_count = 0

        # Override defaults if env vars are present
        try:
            env_max = os.environ.get("ECDAT_LLM_MAX_REQUESTS")
            if env_max:
                self.max_requests = max(1, min(int(env_max), self.MAX_REQUESTS_CAP))
            env_timeout = os.environ.get("ECDAT_LLM_TIMEOUT_SECONDS")
            if env_timeout:
                self.timeout = max(1, min(int(env_timeout), self.MAX_TIMEOUT_SECONDS))
        except ValueError:
            pass

    def can_verify(self) -> bool:
        return bool(self.api_key and self.request_count < self.max_requests)

    def verify_finding(self, snippet: str, algorithm: str, rule_id: str) -> dict:
        if not self.can_verify():
            return None

        # Check for our strict omit token
        if "[CODE OMITTED - CONTAINS KEY MATERIAL]" in snippet:
            return None

        prompt = build_llm_prompt(snippet, algorithm, rule_id)

        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        data = {
            "model": self.model,
            "messages": [{"role": "system", "content": LLM_SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
        }

        retries = 3
        backoff = 2
        for attempt in range(retries):
            try:
                if self.request_count >= self.max_requests:
                    return None
                self.request_count += 1
                response = requests.post(
                    "https://api.groq.com/openai/v1/chat/completions", headers=headers, json=data, timeout=self.timeout
                )

                if response.status_code == 429:  # Rate limit
                    time.sleep(backoff)
                    backoff *= 2
                    continue

                response.raise_for_status()

                result_json = response.json()
                content = result_json["choices"][0]["message"]["content"]

                parsed_content = json.loads(content)

                # Strict schema validation
                if not isinstance(parsed_content, dict):
                    return None

                if "is_cryptographic_operation" not in parsed_content:
                    return None

                return parsed_content

            except (requests.RequestException, json.JSONDecodeError, KeyError) as e:
                # Log to stderr if we want, but gracefully fail so we don't crash the scanner
                if attempt == retries - 1:
                    print(
                        "[LLMVerifier] Verification failed; retaining the static finding without LLM confirmation.",
                        file=sys.stderr,
                    )
                    return None
                time.sleep(backoff)
                backoff *= 2

        return None
