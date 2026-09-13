import re
import os
from pathlib import Path


def validate_target(target: str, target_type: str) -> bool:
    """
    Validates the target strictly to prevent shell injection and ensure safety.
    target_type must be one of: 'directory', 'file', 'archive', 'image'
    """
    if target_type not in ["directory", "file", "archive", "image"]:
        raise ValueError(f"Invalid target type: {target_type}")

    if not target or len(target) > 255:
        raise ValueError("Target string is empty or too long.")

    # Prevent common shell injection characters
    if any(char in target for char in [";", "|", "&", "$", "`", "\n", "\r", "<", ">"]):
        raise ValueError("Target contains illegal shell characters.")

    if target_type in ["directory", "file", "archive"]:
        # Must be a valid local path
        p = Path(target).resolve()

        if not p.exists():
            raise FileNotFoundError(f"Target path does not exist: {target}")

        if target_type == "directory" and not p.is_dir():
            raise ValueError(f"Target is not a directory: {target}")

        if target_type in ["file", "archive"] and not p.is_file():
            raise ValueError(f"Target is not a file: {target}")

        return True

    elif target_type == "image":
        # Check conservative docker image name regex
        # e.g. nginx, nginx:latest, user/nginx:1.2.3, registry.com:5000/user/repo:tag
        image_regex = r"^([a-zA-Z0-9_.-]+(:[0-9]+)?/)?[a-zA-Z0-9_.-]+(/[a-zA-Z0-9_.-]+)*(:[a-zA-Z0-9_.-]+)?(@sha256:[a-f0-9]{64})?$"
        if not re.match(image_regex, target):
            raise ValueError(f"Invalid image name format: {target}")

        from scanners.binary_container.security_guards import validate_registry_security
        validate_registry_security(target)

        return True

    return False
