# ECDAT - Future Scope & Architectural Roadmap

This document outlines the advanced architectural capabilities planned for future major releases (ECDAT Enterprise 2.0), specifically addressing limitations in the current lightweight cloud-native environment.

## 1. Advanced Static Analysis: Semantic Data-Flow & Taint Tracking
**Goal:** Transition from Abstract Syntax Tree (AST) parsing to full-graph semantic data-flow analysis to trace variable origins across multiple files, modules, and dynamically loaded configurations.

### Architecture Requirements:
*   **Engine Integration:** Integrate a compiler-based static analysis framework (e.g., **CodeQL** or **Joern**).
*   **Dynamic Build Environments:** Implement a DevSecOps pipeline capable of dynamically instantiating isolated build containers (Docker/Kubernetes). CodeQL requires intercepting the actual compilation process (Make, CMake, Gradle, Maven) to build its relational code property graphs.
*   **Resource Allocation:** Requires heavy CPU/RAM provisioning, as relational graph queries across large codebases are computationally intensive.

## 2. Advanced Binary Analysis: Headless Decompilation
**Goal:** Transition from string/symbol extraction and constant hunting to full Intermediate Representation (IR) decompilation and symbolic execution to reverse-engineer heavily obfuscated or stripped binaries.

### Architecture Requirements:
*   **Engine Integration:** Deploy headless instances of **Ghidra** or **IDA Pro**, combined with symbolic execution frameworks like **cwe_checker** or **angr**.
*   **Asynchronous Processing:** Shift from synchronous HTTP request/response models to an asynchronous Message Queue (e.g., RabbitMQ, Celery). Decompilation and IR lifting can take several minutes to hours per binary.
*   **Memory Provisioning:** Ghidra operates on the JVM and requires a minimum of 4GB-8GB RAM per concurrent worker just to initialize the decompilation engine.

## Summary
The current iteration of ECDAT prioritizes **speed, scalability, and lightweight deployment** (scanning in seconds via AST and byte-hunting heuristics). 
Implementing the features above will transition ECDAT into a heavy-duty Enterprise CI/CD platform, requiring dedicated infrastructure clusters and asynchronous orchestration.
