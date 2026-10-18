# Product feedback draft

## Feedback for Amazon/AWS tools used

- **Amazon Bedrock Converse:** A low-temperature, bounded JSON proposal path
  works well for rule compilation. The product needs strong structured-output
  validation and an explicit deterministic preflight for empty or policy-changing
  text because a model can otherwise turn obvious rejection into a vague question.
- **AWS SDK for Python / boto3:** Profile-based credentials and a regional model
  catalog made the real path easy to verify. Adaptive retries and explicit
  `maxTokens` are important for a demo that can issue repeated proposals.
- **MCP Python SDK:** Streamable HTTP and structured tool output made the
  add-on boundary easy to expose. The negotiated `2025-11-25` handshake is
  sufficient for the hackathon while the installed SDK advertises a newer path.
- **AWS CLI login / Agent Toolkit:** Short-lived profile-based access and the
  installed skill catalog are useful for local builder workflows without placing
  key material in the project.

## Product feedback

The strongest product opportunity is a standard action envelope that every
Alexa+ add-on submits before acting. The most important platform requirement is
that add-ons cannot silently bypass that gateway. The prototype makes the
approval, privacy, budget, and receipt boundaries visible without claiming
production Alexa+ access.
