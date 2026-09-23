---
name: virustotal
description: >-
  Use VirusTotal to analyze and investigate URLs, IP addresses, domains, and file hashes for malware, phishing, and threat intelligence.
---

# VirusTotal Threat Intelligence Skill

This skill guides the use of the VirusTotal integration to analyze potential security threats, inspect suspicious files or hashes, scan URLs, and gather domain/IP intelligence.

## Setup Requirements

1. The VirusTotal MCP server is configured in `~/.gemini/config/mcp_config.json`.
2. A free or premium API key from VirusTotal (https://www.virustotal.com/gui/my-apikey) must be set in the `VIRUSTOTAL_API_KEY` environment variable in `mcp_config.json`.

## Capabilities

- **File / Hash Analysis**: Query MD5, SHA-1, or SHA-256 hashes to check malware detection ratios and vendor verdicts.
- **URL Scanning**: Check URLs for phishing, malware distribution, or malicious redirects.
- **Domain & IP Intelligence**: Inspect WHOIS, DNS records, resolved IPs, and reputation scores.
- **Threat Hunting**: Map relations (communicating files, execution parents, contacted domains).
