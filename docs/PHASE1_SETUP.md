# Phase 1 Setup Guide

## 1. Create a Virtual Environment

It is recommended to run the scanners and risk engine within an isolated Python virtual environment.

```bash
# From the repository root, create the virtual environment
python -m venv venv

# Activate the virtual environment
# On Linux/macOS:
source venv/bin/activate
# On Windows:
venv\Scripts\activate
```

## 2. Install Dependencies

Once activated, install the required dependencies:

```bash
pip install -r requirements.txt
```

## 3. Verify Installation

To confirm that the official CycloneDX SDK was installed correctly, you can run a simple import test:

```bash
python -c "import cyclonedx; print(f'CycloneDX lib loaded successfully (v{cyclonedx.__version__})')"
```
