# Optional Alexa Custom Skill adapter

This directory is an isolated, un-deployed adapter for a future Alexa Custom
Skill. It is not Alexa+ integration and it does not contain a policy engine.
The adapter accepts only an account-link access token and delegates intent
work to a PACT client boundary. It never treats a spoken member name or slot
as identity.

Current status: adapter contract and handler tests are implemented; account
link token exchange, Alexa developer-console configuration, Lambda deployment,
and live invocation are **not verified**.

Run the adapter unit tests with:

```bash
.venv/bin/python -m pytest -q alexa/tests
```
