# Friction log

Only observed problems are recorded here:

1. Bedrock model output for an empty or policy-injection sentence was initially
   a clarification rather than an explicit rejection. A deterministic input
   guard was added before valid model compilation.
2. Bedrock asked for clarification on one phrasing of a daily deny limit. The
   demo uses clearer supported phrasing and keeps ambiguity fail-safe.
3. The local Docker CLI was initially installed while the daemon was stopped.
   Starting Docker Desktop resolved the issue; the final image, container
   health, UI markers, and MCP smoke all passed.
4. The AWS account permissions boundary denies App Runner and ECR read access,
   so no public HTTPS deployment was attempted and no endpoint is claimed.
5. Strands and AgentCore runtimes were not installed locally; both are marked
   NOT RUN rather than represented as successful integrations.
6. Browser speech recognition can be unavailable outside Chrome. The UI keeps
   typed input available and displays the exact compatibility message.
