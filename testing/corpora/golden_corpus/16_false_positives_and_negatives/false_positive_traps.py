# @ecdat-synthetic-corpus
"""
Golden Corpus Fixture: 16_false_positives_and_negatives/false_positive_traps.py
Category: 16_false_positives_and_negatives
Negative Fixture (is_negative: true)
Must produce strictly ZERO cryptographic findings (100% True Negative rate).
Tests non-cryptographic trap tokens that often trigger crude pattern scanners:
- Substrings: "des_description", "design_system", "blowfish_taxa"
- Built-in Python hash() on dictionary buckets
- Web styling / CSS color hexes containing "md5"
- Graphics keyframe sizes: key_size_pixels = 256
"""

class UserInterfaceTheme:
    def __init__(self):
        # Substring traps
        self.design_description = "Material Design UI Token"
        self.des_descriptor_tag = "des_v2_component"
        self.fish_taxonomy = ["blowfish_taxa", "goldfish", "starfish"]
        self.md5_canvas_color = "#md5a00"
        self.key_size_pixels = 512

    def calculate_dict_bucket(self, key_name: str) -> int:
        # Python non-cryptographic object hash
        return hash(key_name) % 1024

    def verify_design_tokens(self, tokens: list) -> bool:
        # Benign check without cryptographic relevance
        return len(tokens) > 0 and all(isinstance(t, str) for t in tokens)
