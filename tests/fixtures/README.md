# Golden Corpora & Fixtures

These datasets (including `golden_corpus`, `binary_golden_corpus`, `network_golden_corpus`, and `semantic_golden_corpus`) are strictly maintained as our **internal regression set**.

**IMPORTANT:** These are used for unit testing, integration testing, and local regression checking. They must **never** be used for headline benchmark numbers, accuracy claims, or external reporting, as they do not represent real-world diversity and are susceptible to overfitting.

For external headline numbers, F1 scores, precision, and recall metrics, use the `benchmarks/external/` infrastructure, which evaluates against independently maintained sets like OWASP CryptoAPI-Bench, CamBench, Juliet, and pinned real-world repositories with adjudicated labeling.
