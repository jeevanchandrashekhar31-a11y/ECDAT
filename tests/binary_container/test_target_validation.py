from pathlib import Path

import pytest
from scanners.binary_container.target_validation import validate_target


def test_valid_image_names():
    assert validate_target("nginx:latest", "image") == True
    assert validate_target("ubuntu", "image") == True
    assert validate_target("ghcr.io/user/repo:v1.0.0", "image") == True
    assert (
        validate_target(
            "registry.example.com:5000/my-app@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            "image",
        )
        == True
    )


def test_invalid_image_names():
    with pytest.raises(ValueError):
        validate_target("nginx; rm -rf /", "image")
    with pytest.raises(ValueError):
        validate_target("ubuntu|grep secret", "image")
    with pytest.raises(ValueError):
        validate_target("nginx\nlatest", "image")


def test_valid_directories():
    # Avoid a temporary filesystem dependency: the repository root is known to exist.
    assert validate_target(str(Path.cwd()), "directory") is True


def test_invalid_directories():
    with pytest.raises(FileNotFoundError):
        validate_target("/path/that/does/not/exist", "directory")
