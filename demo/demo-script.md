# PACT demo script — under three minutes

**0:00–0:20 — Frame the boundary**

Open the local web app and point to “AI proposes → code decides.” Say: “PACT
is a simulated Alexa+ add-on. No real purchases, bookings, devices, or voice
identity are involved.”

**0:20–0:45 — Speak a rule**

Press **Push to talk** or type: `Ask me before booking anything over $100.`
Show the Bedrock candidate, read-back, synthetic Policy Preview, and
`confirmed: false`. Click **Correct — activate**.

**0:45–1:35 — Run Maya Demo**

Click **Run Maya Demo**. Four synchronized turns move across the simulated
Living Room, Maya's tablet, and Dad's private phone:

1. Plan Maya's birthday under $150.
2. Book Funzone: VenueBook receives `ask` for $120.
3. Dad approves the exact request; it is held against the plan.
4. Add decorations: GiftCart receives `deny` because exposure would be $160.

**1:35–2:05 — Show surfaces and receipts**

Show Dad's complete approval details, Maya's simple explanation, and the
shared screen's safe “That’s private.” Open the receipt timeline and point out
the decision, exact add-on parameters, approval, and integrity hash.

**2:05–2:35 — Show enforcement**

Use the manual add-on check. Try execution without approval, alter the price,
forge a token, or replay it. Each attempt creates a rejected receipt; no
denied or unapproved action reaches the mock executor.

**2:35–2:45 — Close with evidence**

Open the developer panel: `check_action → approval if required → execute exact
token`. Finish: “PACT is a prototype of a common policy gateway that Alexa+
add-ons could call before they act. The model proposes. The household
confirms. The policy engine decides. The executor verifies. The receipt
remembers.”
