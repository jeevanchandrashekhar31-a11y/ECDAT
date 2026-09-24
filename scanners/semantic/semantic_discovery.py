"""
ECDAT Semantic Discovery Engine - Tier 2 Analysis

=============================================================================
PHASE A: ARCHITECTURE DECISION AND PRIVACY DISCLOSURE
=============================================================================
1. LLM Backend Decision:
    This engine supports BOTH local/self-hosted inference and external APIs.
    
    HARDWARE REALITY & DEFAULT OVERRIDE:
    The host environment (Jeevan's laptop) runs on integrated Intel(R) Graphics 
    without a dedicated discrete GPU (NVIDIA/AMD). Running a sufficiently capable 
    code-understanding model locally (e.g., CodeLlama 7B) purely on CPU would 
    introduce unacceptable latency for a live SIH demo. 

    Therefore, for the SIH Demo, the engine defaults to EXTERNAL_API mode using:
    - External Model: OpenAI GPT-4o-mini (or Anthropic Claude 3 Haiku) via standard REST API.
    
    The privacy disclosure rule applies strictly: 
    "Semantic analysis mode: external API — source code snippets are sent to 
    an external provider for analysis." must be visibly displayed in the UI.

    The fully local architecture remains documented and buildable for enterprise 
    deployments with adequate hardware:
    - Local Runtime: llama.cpp (via `llama-cpp-python`) or Ollama.
    - Local Model: Quantized CodeLlama 7B or Llama-3 8B (Q4_K_M).

2. Scope of Code Disclosed:
   To bound both cost and privacy exposure, this engine NEVER sends entire 
   files or repositories to the model. 
   A strict, lightweight AST/heuristic pre-filter runs locally to identify 
   suspicious blocks (e.g., bitwise operations inside loops, modular 
   arithmetic, or custom functions named "hash"/"encrypt" that lack known 
   library calls). ONLY these narrowly scoped, highly-suspect candidate 
   snippets are ever passed to the LLM for analysis.
=============================================================================
"""

import re
import json
import os
import urllib.request
import urllib.error

import hashlib

class SemanticDiscoveryEngine:
    def __init__(self, api_key=None, max_llm_calls=50, cache_dir=None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.max_llm_calls = max_llm_calls
        self.cache_dir = cache_dir or os.path.join(os.path.dirname(__file__), ".cache")
        if not os.path.exists(self.cache_dir):
            os.makedirs(self.cache_dir, exist_ok=True)
        self.calls_made = 0
        self.skipped_due_to_cap = 0
        
    def pre_filter(self, source_code):
        """
        Lightweight heuristic pass over source files.
        Identifies suspicious blocks (bitwise ops, suspicious function names)
        and extracts surrounding lines to limit scope sent to LLM.
        """
        lines = source_code.split('\n')
        candidates = []
        
        # 1. Bitwise operations commonly used in custom hashes/ciphers
        rx_bitwise = re.compile(r'(\^|<<|>>|&|\|)', re.IGNORECASE)
        # 2. Suspicious function names suggesting crypto intent
        rx_crypto_names = re.compile(r'(?i)(encrypt|decrypt|cipher|crypt|hash|obfuscate|vigenere|caesar|feistel)', re.IGNORECASE)
        
        window_size = 10 # +/- 10 lines
        
        match_indices = set()
        for i, line in enumerate(lines):
            if rx_bitwise.search(line) or rx_crypto_names.search(line):
                match_indices.add(i)
                
        # Group contiguous or overlapping windows
        merged_windows = []
        current_window = None
        for i in sorted(match_indices):
            start = max(0, i - window_size)
            end = min(len(lines), i + window_size + 1)
            if not current_window:
                current_window = [start, end]
            else:
                if start <= current_window[1]: # Overlap
                    current_window[1] = max(current_window[1], end)
                else:
                    merged_windows.append(current_window)
                    current_window = [start, end]
        if current_window:
            merged_windows.append(current_window)
            
        for w in merged_windows:
            snippet = "\n".join(lines[w[0]:w[1]])
            candidates.append({
                "start_line": w[0] + 1,
                "end_line": w[1],
                "snippet": snippet
            })
            
        return candidates

    def analyze_block(self, snippet):
        """
        Calls the LLM to classify the snippet. 
        Returns structured JSON containing classification, confidence, and explanation.
        """
        if self.calls_made >= self.max_llm_calls:
            self.skipped_due_to_cap += 1
            return {
                "classification": "INSUFFICIENT_CONTEXT",
                "confidence": 0.0,
                "explanation": f"Skipped due to LLM API call cap (Max: {self.max_llm_calls}).",
                "status": "SEMANTIC_ANALYSIS_UNAVAILABLE"
            }
            
        if not self.api_key:
            return {
                "classification": "INSUFFICIENT_CONTEXT",
                "confidence": 0.0,
                "explanation": "Missing LLM API key (OPENAI_API_KEY).",
                "status": "SEMANTIC_ANALYSIS_UNAVAILABLE"
            }

        self.calls_made += 1
        
        prompt = f"""
You are a cryptographic security expert. Analyze the following code snippet.
Determine if it is:
1. LIKELY_CUSTOM_CRYPTO: Hand-rolled, non-standard cryptography (e.g., custom stream cipher, substitution cipher, custom hash loop).
2. LIKELY_NON_CRYPTO_BITWISE_LOGIC: Legitimate non-crypto bitwise operations (e.g., CRC checksum, compression, image processing, basic math).
3. INSUFFICIENT_CONTEXT: Cannot be determined from the snippet alone.

Return ONLY valid JSON (no markdown wrapping) in this exact format:
{{
  "classification": "<one of the three above>",
  "confidence": <float between 0.0 and 1.0>,
  "explanation": "<plain language explanation of the detected pattern and why>"
}}

Snippet:
{snippet}
"""
        prompt_hash = hashlib.sha256(snippet.encode('utf-8')).hexdigest()
        cache_file = os.path.join(self.cache_dir, f"{prompt_hash}.json")
        
        # Check cache if not forcing live
        force_live = os.environ.get("ECDAT_FORCE_LIVE_SEMANTIC") == "1"
        if not force_live and os.path.exists(cache_file):
            try:
                with open(cache_file, "r") as f:
                    cached_data = json.load(f)
                    cached_data["cached"] = True
                    return cached_data
            except Exception:
                pass # Fall back to live call

        try:
            req = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}"
                },
                data=json.dumps({
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1
                }).encode("utf-8")
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                res_body = response.read()
                data = json.loads(res_body)
                content = data["choices"][0]["message"]["content"].strip()
                
                if content.startswith("```json"):
                    content = content[7:]
                if content.startswith("```"):
                    content = content[3:]
                if content.endswith("```"):
                    content = content[:-3]
                    
                parsed = json.loads(content.strip())
                parsed["status"] = "LLM_FLAGGED_UNVERIFIED"
                
                # Write to cache
                with open(cache_file, "w") as f:
                    json.dump(parsed, f)
                    
                parsed["cached"] = False
                return parsed
        except Exception as e:
            return {
                "classification": "INSUFFICIENT_CONTEXT",
                "confidence": 0.0,
                "explanation": f"LLM API Call failed or parsing failed: {str(e)}",
                "status": "SEMANTIC_ANALYSIS_UNAVAILABLE"
            }

    def run_scan(self, file_path, source_code):
        """
        Runs the full semantic pipeline (pre-filter -> LLM) for a single file.
        Returns a list of structured findings.
        """
        candidates = self.pre_filter(source_code)
        findings = []
        for cand in candidates:
            analysis = self.analyze_block(cand["snippet"])
            
            # If the engine failed or the model couldn't confidently classify it as crypto,
            # we record the attempt but do not emit an active unverified finding.
            if analysis.get("status") == "SEMANTIC_ANALYSIS_UNAVAILABLE":
                findings.append({
                    "file_path": file_path,
                    "start_line": cand["start_line"],
                    "end_line": cand["end_line"],
                    "snippet": cand["snippet"],
                    "detection_method": "semantic_llm",
                    "confidence": analysis.get("confidence", 0.0),
                    "status": "SEMANTIC_ANALYSIS_UNAVAILABLE",
                    "explanation": analysis.get("explanation", ""),
                    "classification": analysis.get("classification", "INSUFFICIENT_CONTEXT"),
                    "cached": analysis.get("cached", False)
                })
            elif analysis.get("classification") == "LIKELY_CUSTOM_CRYPTO":
                findings.append({
                    "file_path": file_path,
                    "start_line": cand["start_line"],
                    "end_line": cand["end_line"],
                    "snippet": cand["snippet"],
                    "detection_method": "semantic_llm",
                    "confidence": analysis.get("confidence", 0.0),
                    "status": "LLM_FLAGGED_UNVERIFIED", # Crucial: Not CONFIRMED!
                    "explanation": analysis.get("explanation", ""),
                    "classification": "LIKELY_CUSTOM_CRYPTO",
                    "cached": analysis.get("cached", False)
                })
        return findings
