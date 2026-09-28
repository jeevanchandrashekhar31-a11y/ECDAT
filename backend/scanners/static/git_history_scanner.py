import os
from typing import List, Optional, Set
try:
    import pygit2
except ImportError:
    pygit2 = None

from .secret_detector import SecretSafeDetector, SecretCandidate

class GitHistoryScanner:
    def __init__(self, repo_path: str, max_commits: int = 1000, max_size_bytes: int = 1024 * 1024 * 10):
        self.repo_path = repo_path
        self.max_commits = max_commits
        self.max_size_bytes = max_size_bytes
        self.repo = None
        if pygit2 and os.path.exists(os.path.join(repo_path, ".git")):
            try:
                self.repo = pygit2.Repository(repo_path)
            except Exception:
                pass

    def scan_incremental(self, baseline_commit: Optional[str] = None, allowlist_files: Optional[Set[str]] = None) -> List[SecretCandidate]:
        if not self.repo:
            return []
            
        allowlist = allowlist_files or set()
        candidates = []
        commits_scanned = 0
        
        try:
            head = self.repo.head
            walker = self.repo.walk(head.target, pygit2.GIT_SORT_TIME)
        except Exception:
            return []
            
        for commit in walker:
            if commits_scanned >= self.max_commits:
                break
                
            if baseline_commit and str(commit.id) == baseline_commit:
                break
                
            if len(commit.parents) == 0:
                diff = commit.tree.diff_to_tree(swap=True)
            else:
                diff = self.repo.diff(commit.parents[0], commit)
                
            for patch in diff:
                delta = patch.delta
                file_path = delta.new_file.path
                if file_path in allowlist:
                    continue
                    
                # Limit size
                if delta.new_file.size > self.max_size_bytes:
                    continue
                    
                # Scan hunks
                for hunk in patch.hunks:
                    for line in hunk.lines:
                        if line.origin in ['+', '>']:
                            # Scan line
                            content = line.content.decode('utf-8', errors='ignore')
                            sanitized, new_cands = SecretSafeDetector.detect_and_redact(
                                content, 
                                file_path=f"{commit.id[:8]}:{file_path}",
                                test_mode=False
                            )
                            candidates.extend(new_cands)
                            
            commits_scanned += 1
            
        return candidates
