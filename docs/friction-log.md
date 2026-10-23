# Friction log

Real problems hit while building PACT, with the task, steps, expected versus actual result, severity, workaround and a suggestion. All entries are from 2026-10-17 to 2026-10-22.

## 1. Amazon Polly was denied by three different layers, one after another

- **Task:** speak PACT's replies with an Amazon Polly neural voice instead of the browser voice.
- **Steps:** called `SynthesizeSpeech` (neural, `us-west-2`) with the project's IAM user.
  1. `AccessDenied`: the user had no Polly permission. Added an identity policy.
  2. `AccessDenied` again: "no permissions boundary allows polly:SynthesizeSpeech". Edited the boundary.
  3. `AccessDenied` a third time: "explicit deny in a service control policy". The project is on the Free plan, and the policy is AWS-managed, so the user cannot change it.
- **Expected:** either Polly works, or one clear message that the service is not available on this plan.
- **Actual:** three separate denials: two needed IAM console changes, and the last one cannot be fixed by the user.
- **Severity:** Medium. A natural voice was blocked after several rounds of IAM changes.
- **Workaround:** the browser's speech synthesis (Edge's "Natural" voices sound best). PACT falls back to it automatically.
- **Suggestion:** say in the error, or in AWS Settings, which services are unavailable on the current plan, before a user starts building on them. If an SCP is the denying layer, name the plan restriction in the message.

## 2. Editing the permissions boundary for Polly silently removed Bedrock access

- **Task:** add `polly:SynthesizeSpeech` to the user's permissions boundary.
- **Steps:** switched the boundary to a new policy that listed the Polly action. Bedrock calls then failed with "no permissions boundary allows bedrock:InvokeModel". Bedrock had worked earlier the same day.
- **Expected:** the new boundary adds an action.
- **Actual:** the boundary is a replacement, not an addition, so every action it did not list was lost.
- **Severity:** Medium. A working feature broke without any warning.
- **Workaround:** set the boundary to a policy that lists both Bedrock and Polly actions.
- **Suggestion:** when a boundary is changed, show which recently used actions (from last-accessed data) would stop being allowed.

## 3. The recommended plan check is itself blocked by the boundary

- **Task:** find out whether the project is on the Free or Paid plan, as the AWS guidance suggests (`freetier get-account-plan-state`).
- **Steps:** ran `GetAccountPlanState` with the project's profile.
- **Expected:** the plan type.
- **Actual:** `AccessDenied` because the permissions boundary does not allow `freetier:GetAccountPlanState`.
- **Severity:** Low.
- **Workaround:** read the plan in AWS Settings > Billing in the browser.
- **Suggestion:** include `freetier:GetAccountPlanState` in the default boundary for project users, since the guidance tells them to run it.

## 4. AWS MCP server tools returned "Unknown tool"

- **Task:** read-only AWS checks through the AWS MCP server from the coding assistant.
- **Steps:** called `aws___run_script` and `aws___search_documentation`.
- **Expected:** the calls run.
- **Actual:** both failed with "Unknown tool", although the tool list had advertised them.
- **Severity:** Low to Medium (an assistant could not do AWS checks).
- **Workaround:** ran the same read-only calls locally with `boto3` and the project's profile.
- **Suggestion:** keep the advertised tool list and the callable tools in sync, or report a connection problem instead of "Unknown tool".

## 5. Bedrock (Nova Lite) copied a literal example value from the prompt into its output

- **Task:** have Bedrock compile "Ask me before anyone buys something over a hundred dollars." into a structured candidate rule.
- **Steps:** the prompt contained an example rule with `approver: "siva"`. The model returned a correct rule except that the approver was the literal `"siva"`, not the signed-in user.
- **Expected:** the approver is the signed-in adult.
- **Actual:** the literal from the example. In a real household no member has that name, so an approval would never reach the adult. A person still has to confirm every candidate, which is why this is caught, but it is a real correctness bug.
- **Severity:** High for correctness, mitigated by the confirmation step. **Not yet fixed**; the demo uses the built-in parser for this rule. It is also listed in `reports/submission-readiness-final.md`.
- **Workaround:** use the deterministic compiler. The fix is to set the approver in code, not by the model.
- **Suggestion:** for structured output, use a JSON schema or tool-use with typed fields, and keep concrete example values out of prompts; or document that models can copy example literals verbatim.

## 6. Stitch MCP connector would not connect

- **Task:** use the Stitch MCP server to generate TV, phone and tablet screens.
- **Steps:** `claude mcp add stitch ...` with an HTTP transport and API key header.
- **Expected:** the server connects and its tools appear.
- **Actual:** the connector failed to connect.
- **Severity:** Low.
- **Workaround:** called the Stitch HTTP API directly.- **Suggestion:** show the underlying connection error (status code, header name expected) in the add-server output.

## 7. MCP Python SDK 2.x: result field naming

- **Task:** write a small client that calls a tool and checks for errors.
- **Steps:** read `result.isError` as the protocol spells it.
- **Expected:** the flag exists.
- **Actual:** the Python SDK exposes `is_error`; the camelCase name did not work and the check script failed.
- **Severity:** Low.
- **Workaround:** use `is_error`.
- **Suggestion:** note the snake_case mapping for result fields in the client quickstart.
