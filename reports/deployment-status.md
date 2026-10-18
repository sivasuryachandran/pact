# Deployment status

## Local container artifact

`Dockerfile` and `.dockerignore` are present. Docker Desktop was installed and
started locally. Docker 29.8.0 built and ran the image successfully:

```text
docker build -t pact-simulated:submission .: PASS
container /health: PASS
container web UI markers: PASS
container MCP smoke: PASS; SDK 2.3.0; protocol 2025-11-25; 8 tools; structured output true
```

No AWS resources, IAM policies, public endpoints, or expensive services were
created. A local run is:

```bash
docker build -t pact-simulated:local .
docker run --rm -p 8787:8787 \
  -e PACT_BEDROCK_ENABLED=0 \
  -v "$PWD/pact-data:/data" \
  pact-simulated:local
```

For real Bedrock, provide the AWS profile and region through the normal SDK
chain. The Docker origin guard has an explicit `PACT_ALLOW_DOCKER_CLIENTS=1`
local-container setting and supports `PACT_ALLOWED_ORIGINS` for the published
local port.

## Public HTTPS deployment

Status: **NOT RUN**. No public endpoint is claimed. Read-only checks with the
existing `pact` profile succeeded for STS but were blocked by the account
permissions boundary:

```text
apprunner:ListServices — AccessDeniedException; no permissions boundary allows it
ecr:DescribeRepositories — AccessDeniedException; no permissions boundary allows it
servicequotas:GetServiceQuota — AccessDeniedException; no permissions boundary allows it
```

The simplest compatible path would be a private ECR image plus AWS App Runner
with HTTPS, but it requires narrowly scoped existing permission for ECR push,
App Runner service creation/management, and the required service role. No IAM
policy was changed, no ECR repository was created, and no AWS service was
created. Required operator-supplied actions are:

```bash
aws ecr create-repository --repository-name pact-simulated --region us-west-2
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-west-2.amazonaws.com
docker tag pact-simulated:submission <account>.dkr.ecr.us-west-2.amazonaws.com/pact-simulated:submission
docker push <account>.dkr.ecr.us-west-2.amazonaws.com/pact-simulated:submission
```

Then provision App Runner with a least-privilege service role and expose the
container port 8787. After deployment, run `/health`, the web UI, and an
external MCP initialize/tools/list/get_rules smoke test before claiming a URL.

## Optional integrations

```text
Strands: NOT RUN — `ModuleNotFoundError: No module named 'strands'`.
AgentCore: NOT RUN — `agentcore: command not found`; no AgentCore resource was
created.
```

The deterministic planner and policy engine remain the working fallback. No
unexecuted optional integration is described as successful.
