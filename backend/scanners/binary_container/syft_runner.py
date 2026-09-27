import subprocess
import json
import logging
import sys


def check_syft_installed() -> bool:
    try:
        subprocess.run(["syft", "version"], capture_output=True, text=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def run_syft_scan(target: str, timeout_seconds: int = 300) -> dict:
    """
    Runs syft on the given target and returns the parsed CycloneDX JSON.
    """
    if not check_syft_installed():
        logging.error("Syft executable not found in PATH.")
        logging.error("Actionable Guidance: Please install Syft from https://github.com/anchore/syft")
        logging.error(
            "On Windows (PowerShell): curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin"
        )
        logging.error("Or use equivalent package manager. Exiting gracefully.")
        sys.exit(0)  # Non-crashing graceful exit per requirements

    cmd = ["syft", target, "-o", "cyclonedx-json"]
    logging.info("Running Syft scan with a validated target.")

    try:
        result = subprocess.run(cmd, shell=False, capture_output=True, text=True, timeout=timeout_seconds, check=False)

        if result.returncode != 0:
            logging.error(f"Syft execution failed with code {result.returncode}")
            # Truncate stderr if it's too long
            logging.error(
                "Syft returned an error; diagnostic output is suppressed to avoid logging sensitive target data."
            )
            sys.exit(1)

        # Parse output securely
        if not result.stdout.strip():
            logging.error("Syft returned empty output.")
            sys.exit(1)

        # Bounded output string size (e.g., max 100MB) to prevent memory exhaustion
        if len(result.stdout) > 100 * 1024 * 1024:
            logging.error("Syft output exceeded 100MB bound.")
            sys.exit(1)

        try:
            parsed = json.loads(result.stdout)
            return parsed
        except json.JSONDecodeError as e:
            logging.error(f"Syft returned malformed JSON: {e}")
            sys.exit(1)

    except subprocess.TimeoutExpired:
        logging.error(f"Syft scan timed out after {timeout_seconds} seconds.")
        sys.exit(1)
