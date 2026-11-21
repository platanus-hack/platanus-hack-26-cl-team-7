"""R3 signatures: sensitive files and attack payload families.

The sensitive-file list follows the SecLists discovery lists (dotfiles, VCS metadata, cloud and
SSH credentials, config backups, database dumps). The payload families follow the SecLists fuzzing
lists (traversal/LFI, SQLi, XSS, command injection, SSTI, log4shell, CRLF). Every input here is
already percent-decoded and lowercased, so the patterns are lowercase. Each pattern needs syntax
that ordinary searches do not contain, because the target is 100% critical-flag precision.
The text is attacker-controlled and can be long, so no pattern may backtrack more than linearly:
repeats stop at the next delimiter ("<", "{", "*") or have a fixed upper bound.
"""

from __future__ import annotations

import re

Signature = tuple[str, re.Pattern[str]]

_SEGMENT_END = r"(?:/|$)"
_BACKUP_EXT = r"(?:bak|backup|old|orig|save|swp|swo|tmp|dist)"
_CONFIG_EXT = r"(?:php|asp|aspx|jsp|ini|conf|cfg|config|ya?ml|json|xml|env|py|rb|properties|sql)"
_SHELL_COMMANDS = (
    r"(?:cat|ls|id|whoami|uname|wget|curl|nc|ncat|bash|sh|zsh|ping|nslookup|sleep|echo|rm"
    r"|chmod|python3?|perl|php|powershell|cmd)"
)
# "$(" and "`" start a command anywhere. A bare ";" or "|" starts one only right after a value
# boundary, a quote or a digit ("127.0.0.1;id", "q=|id"), so "sort|id" in a search stays quiet.
_COMMAND_START = r"(?:\$\(|`|(?:^|[=&'\"\d])\s*(?:;|\|\|?))"


def _compile(entries: list[tuple[str, str]]) -> tuple[Signature, ...]:
    return tuple((name, re.compile(regex)) for name, regex in entries)


SENSITIVE_PATHS: tuple[Signature, ...] = _compile(
    [
        ("dotenv file", r"(?:^|/)\.env(?:\.[\w.-]+)?" + _SEGMENT_END),
        ("git metadata", r"(?:^|/)\.git(?:/|$|ignore$|-credentials$)"),
        ("vcs metadata", r"(?:^|/)(?:\.svn|\.hg|\.bzr)/|(?:^|/)cvs/(?:entries|root)$"),
        ("aws credentials", r"(?:^|/)\.aws/(?:credentials|config)$"),
        ("ssh key", r"(?:^|/)(?:\.ssh/|)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.pub)?$"),
        ("ssh directory", r"(?:^|/)\.ssh/(?:authorized_keys|known_hosts|config)$"),
        ("docker or kube config", r"(?:^|/)(?:\.docker/config\.json|\.kube/config)$"),
        ("package registry token", r"(?:^|/)(?:\.npmrc|\.pypirc|\.netrc|\.git-credentials)$"),
        ("shell history", r"(?:^|/)\.(?:bash|zsh|sh|mysql|psql)_history$"),
        ("apache access file", r"(?:^|/)\.ht(?:access|passwd)$"),
        ("macos metadata", r"(?:^|/)\.ds_store$"),
        ("editor project file", r"(?:^|/)\.(?:vscode/sftp\.json|idea/workspace\.xml)$"),
        ("wordpress config", r"(?:^|/)wp-config\.php"),
        ("iis web config", r"(?:^|/)web\.config$"),
        ("php info page", r"(?:^|/)phpinfo\.php$"),
        ("database admin", r"(?:^|/)(?:phpmyadmin|pma|adminer|myadmin)(?:[\w.-]*\.php|/|$)"),
        ("server status", r"(?:^|/)server-(?:status|info)$"),
        ("spring actuator", r"(?:^|/)actuator/(?:env|heapdump|mappings|configprops|beans)$"),
        ("config backup", r"\." + _CONFIG_EXT + r"(?:\." + _BACKUP_EXT + r"|~|\.save\.\d+)$"),
        (
            "backup archive",
            r"(?:^|/)(?:backup|backups|site|www|db|database|dump)\.(?:zip|tar"
            r"|tar\.gz|tgz|rar|7z|gz)$",
        ),
        ("sql dump", r"\.sql(?:\.gz|\.zip|\.bz2|\.tar\.gz)?$"),
        ("private key file", r"(?:^|/)(?:server|private|privkey|ssl|tls)\.(?:key|pem)$"),
        ("keystore file", r"\.(?:p12|pfx|jks|keystore)$"),
    ]
)

PAYLOAD_PATTERNS: tuple[Signature, ...] = _compile(
    [
        ("path traversal", r"(?:\.\.[/\\]){2,}"),
        ("path traversal to secret", r"\.\.[/\\](?:\.env|\.git/|\.ssh/|\.aws/|wp-config)"),
        ("unix system file", r"/etc/(?:passwd|shadow|group|hosts|issue|sudoers)\b"),
        ("proc filesystem", r"/proc/self/(?:environ|cmdline|maps|fd/|status)"),
        ("windows system file", r"\b(?:win|boot|system)\.ini\b|\bc:[/\\]windows[/\\]"),
        ("stream wrapper", r"\b(?:php|expect|phar|zip|data|gopher|dict)://|\bfile:///"),
        ("cloud metadata", r"\b169\.254\.169\.254\b|metadata\.google\.internal"),
        ("sql union select", r"\bunion(?:\s|/\*[^*]*\*/)+(?:all\s+|distinct\s+)?select\b"),
        ("sql tautology", r"['\"]\s*(?:or|and)\s+['\"]?(\w+)['\"]?\s*=\s*['\"]?\1\b"),
        ("sql numeric tautology", r"\b(?:or|and)\s+(\d+)\s*=\s*\1\b"),
        ("sql comment break", r"'\s*(?:--|#)[\s-]*(?:&|$)"),
        (
            "sql time delay",
            r"\b(?:sleep|pg_sleep)\s*\(\s*\d+(?:\.\d+)?\s*\)|\bbenchmark\s*\(\s*\d+\s*,"
            r"|\bwaitfor\s+delay\b",
        ),
        ("sql metadata", r"\binformation_schema\b|@@version\b|\bsysobjects\b|\bpg_catalog\b"),
        ("sql file access", r"\bload_file\s*\(|\binto\s+(?:out|dump)file\b"),
        ("sql error function", r"\b(?:extractvalue|updatexml)\s*\("),
        ("sql stacked query", r";\s*(?:drop|truncate|alter|shutdown|exec)\s+\w"),
        ("xss script tag", r"<\s*(?:/\s*)?script\b"),
        ("xss event handler", r"<[a-z!][^<>]*[\s/\"']on[a-z]+\s*="),
        ("xss dangerous tag", r"<\s*(?:iframe|object|embed|svg|math)\b[^<>]*[>=]"),
        ("xss javascript url", r"\bjavascript\s*:[^\s(]{0,256}\("),
        ("log4shell", r"\$\{\s*(?:jndi|\$\{|::-|lower:|upper:|env:|sys:)"),
        ("template injection", r"\{\{\s*\d+\s*[*+]\s*\d+\s*\}\}|\$\{\s*\d+\s*\*\s*\d+\s*\}"),
        ("template object access", r"\{\{[^{}]*__(?:class|globals|builtins|mro|subclasses)__"),
        ("erb or jsp expression", r"<%=?\s*\d+\s*\*\s*\d+\s*%>|#\{\s*\d+\s*\*\s*\d+\s*\}"),
        ("command injection", _COMMAND_START + r"\s*" + _SHELL_COMMANDS + r"(?:\s|$|[;|`)&])"),
        ("shell path", r"/bin/(?:ba|z|da)?sh\b|\bcmd(?:\.exe)?\s+/c\b"),
        (
            "crlf header injection",
            r"[\r\n][ \t]*(?:set-cookie|location|content-(?:type|length)"
            r"|refresh|x-[a-z-]+|access-control-[a-z-]+)[ \t]*:",
        ),
    ]
)


def match_sensitive(path: str) -> str | None:
    return _first_match(SENSITIVE_PATHS, path)


def match_payload(text: str) -> str | None:
    return _first_match(PAYLOAD_PATTERNS, text)


def _first_match(signatures: tuple[Signature, ...], text: str) -> str | None:
    for name, pattern in signatures:
        if pattern.search(text):
            return name
    return None
