import re
content = open('backend/scanners/filesystem/detectors.py').read()
start_crypto = content.find('def _detect_crypto_config')
start_library = content.find('def _detect_library_installation')
if start_crypto != -1 and start_library != -1:
    new_method = '''def _detect_crypto_config(
        self,
        file_name: str,
        rel_path: str,
        abs_path: str,
        content: bytes,
        file_size: int,
        sha256_hash: str,
    ) -> Optional[FilesystemCryptoAsset]:
        config_findings = {}

        try:
            content_str = content.decode("utf-8")
        except UnicodeDecodeError:
            # We don't parse configs from binary blobs
            return None
            
        parsed_findings = self.config_registry.route_and_parse(abs_path, content_str)
        
        for finding in parsed_findings:
            key = f"{finding.scope_id}:{finding.setting}"
            config_findings[key] = finding.effective_value

        if config_findings:
            return FilesystemCryptoAsset(
                asset_id=f"crypto_cfg:{rel_path}",
                asset_type=FilesystemAssetType.CONFIGURATION,
                file_path=rel_path,
                absolute_path=abs_path,
                file_size_bytes=file_size,
                sha256_hash=sha256_hash,
                confidence="high",
                description="Structured parsed configuration file",
                metadata={"config_settings": config_findings},
            )
        return None

    '''
    content = content[:start_crypto] + new_method + content[start_library:]
    open('backend/scanners/filesystem/detectors.py', 'w').write(content)
